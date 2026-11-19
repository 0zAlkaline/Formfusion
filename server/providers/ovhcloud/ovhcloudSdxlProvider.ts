import { createHash } from 'node:crypto';
import { normalizeGenerationRequest } from '../../../src/services/image-generation/generationNormalizer.ts';
import { errResult, okResult } from '../../../src/types/common.ts';
import type { ServiceResult } from '../../../src/types/common.ts';
import type {
  ImageGenerationExecutionOptions,
  ImageGenerationHealthCheckResult,
  ImageGenerationProvider,
  ImageGenerationProviderCapabilities,
  ImageGenerationProviderErrorCategory,
  ImageGenerationProviderPublicStatus,
  ImageGenerationProviderStatusValue,
  ImageGenerationSmokeTestResult,
  NormalizedImageGenerationRequest,
  NormalizedImageGenerationResponse,
  ProviderAuthContext,
  ProviderCapabilityDeclaration,
  ProviderNormalizedError,
  TextToImageProviderInput,
  TextToImageProviderOutput,
} from '../../../src/types/providers.ts';
import { createEntityId, nowIsoTimestamp } from '../../../src/utils/ids.ts';
import { sanitizeDiagnosticMessage } from '../../middleware/security.ts';
import {
  OVH_ACCESS_TOKEN_ENV_VAR,
  OVH_ANONYMOUS_RATE_LIMIT_RPM,
  OVH_AUTHENTICATED_RATE_LIMIT_RPM,
  OVHCLOUD_PROVIDER_ID,
  OVHCLOUD_PROVIDER_NAME,
  OVHCLOUD_SDXL_MODEL_ID,
  resolveOvhcloudAccessToken,
  resolveOvhcloudPublicConfiguration,
  type OvhcloudEnvSource,
  type OvhcloudPublicConfiguration,
} from './config.ts';
import {
  mapOvhcloudProviderError,
  OvhcloudConfigurationError,
  OvhcloudHttpError,
  parseRetryAfterSeconds,
} from './errorMapper.ts';
import {
  inspectGeneratedImageBinary,
  MAX_GENERATED_IMAGE_BYTES,
} from './imageBinaryInspector.ts';

export const OVHCLOUD_DEFAULT_SMOKE_TEST_PROMPT =
  'Minimalist ceramic vase on warm studio backdrop' as const;

export const OVHCLOUD_MAX_PROMPT_LENGTH = 2000;

export interface OvhcloudSdxlApiPayload {
  readonly prompt: string;
  readonly negative_prompt?: string;
}

export interface OvhcloudSdxlProviderOptions {
  readonly getEnv?: () => OvhcloudEnvSource;
  readonly fetchFn?: typeof fetch;
  readonly healthTimeoutMs?: number;
  readonly generationTimeoutMs?: number;
  readonly maxConcurrentGenerations?: number;
}

const DEFAULT_HEALTH_TIMEOUT_MS = 8000;
const DEFAULT_GENERATION_TIMEOUT_MS = 90000;

function fingerprintOvhConfig(
  token: string | null,
  config: OvhcloudPublicConfiguration,
): string {
  const tokenHash = token
    ? createHash('sha256').update(token).digest('hex').slice(0, 12)
    : 'none';
  return [
    tokenHash,
    config.modelId,
    config.modelValid ? '1' : '0',
    config.anonymousFreeTierEnabled ? '1' : '0',
    config.freeTierAvailable ? '1' : '0',
  ].join(':');
}

export class OvhcloudSdxlProvider implements ImageGenerationProvider {
  readonly providerId = OVHCLOUD_PROVIDER_ID;

  private readonly getEnv: () => OvhcloudEnvSource;
  private readonly fetchFn: typeof fetch;
  private readonly healthTimeoutMs: number;
  private readonly generationTimeoutMs: number;
  private readonly maxConcurrentGenerations: number;

  private cachedFingerprint: string | null = null;
  private testRequestCount = 0;
  private inFlightGenerations = 0;
  private lastHealthCheckAt: string | null = null;
  private lastSmokeTestAt: string | null = null;
  private runtimeStatus: {
    readonly connectionStatus?: ImageGenerationProviderStatusValue;
    readonly statusMessage?: string;
    readonly errorCategory?: ImageGenerationProviderErrorCategory;
    readonly retryAfterSeconds?: number;
  } = {};

  constructor(options: OvhcloudSdxlProviderOptions = {}) {
    this.getEnv = options.getEnv ?? (() => process.env);
    this.fetchFn = options.fetchFn ?? fetch;
    this.healthTimeoutMs = options.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS;
    this.generationTimeoutMs =
      options.generationTimeoutMs ?? DEFAULT_GENERATION_TIMEOUT_MS;
    this.maxConcurrentGenerations = Math.max(
      1,
      options.maxConcurrentGenerations ?? 1,
    );
  }

  getCapabilities(): ImageGenerationProviderCapabilities {
    const config = resolveOvhcloudPublicConfiguration(this.getEnv());
    return {
      providerId: OVHCLOUD_PROVIDER_ID,
      providerName: OVHCLOUD_PROVIDER_NAME,
      modelId: config.modelId,
      task: 'text-to-image',
      isFreeTierModel: true,
      supportsNegativePrompt: true,
      supportsImageToImage: false,
      supportedOutputSizes: [
        {
          width: 1024,
          height: 1024,
          aspectRatio: '1:1',
          label: '1024 × 1024 (Native SDXL Square)',
        },
      ],
      maxNumberOfImages: 1,
      maxPromptLength: OVHCLOUD_MAX_PROMPT_LENGTH,
      supportsSeed: false,
      supportsGuidanceScale: false,
      supportsInferenceSteps: false,
      supportsAnonymousFreeTier: true,
      anonymousRateLimitRpm: OVH_ANONYMOUS_RATE_LIMIT_RPM,
      authenticatedRateLimitRpm: OVH_AUTHENTICATED_RATE_LIMIT_RPM,
      requiresExplicitConfirmationForSmokeTest: true,
      hasDedicatedHealthEndpoint: false,
      warnings: [
        'OVHcloud Stable Diffusion XL generates fixed 1024 × 1024 square outputs; custom dimensions, seed, guidanceScale, inferenceSteps, and multi-image batches are omitted.',
        `Anonymous access is free-tier capped at ${OVH_ANONYMOUS_RATE_LIMIT_RPM} requests/minute per IP; token authentication increases limit to ${OVH_AUTHENTICATED_RATE_LIMIT_RPM} RPM.`,
        'Image-to-image and source-image attachments are strictly disabled.',
        ...config.warnings,
      ],
      unsupportedParameters: [
        'seed',
        'guidanceScale',
        'inferenceSteps',
        'safetyFilterLevel',
        'aspectRatio',
        'outputWidth',
        'outputHeight',
        'numberOfImages',
      ],
    };
  }

  getLegacyCapabilityDeclaration(): ProviderCapabilityDeclaration {
    const caps = this.getCapabilities();
    return {
      providerId: caps.providerId,
      kind: 'text_to_image',
      displayName: caps.providerName,
      supportedModels: [caps.modelId],
      supportsNegativePrompt: caps.supportsNegativePrompt,
      supportedAspectRatios: ['1:1'],
      maxPromptLength: caps.maxPromptLength,
      maxOutputResolution: { width: 1024, height: 1024 },
      supportsSeed: caps.supportsSeed,
    };
  }

  resolveAuthContext(): ProviderAuthContext {
    const config = resolveOvhcloudPublicConfiguration(this.getEnv());
    return {
      providerId: OVHCLOUD_PROVIDER_ID,
      credentialEnvVar: OVH_ACCESS_TOKEN_ENV_VAR,
      isConfigured: config.tokenConfigured,
    };
  }

  getPublicStatus(): ImageGenerationProviderPublicStatus {
    const env = this.getEnv();
    const config = resolveOvhcloudPublicConfiguration(env);
    const token = resolveOvhcloudAccessToken(env);
    this.syncConfigFingerprint(token, config);

    if (!config.freeTierAvailable || !config.modelValid) {
      return {
        providerId: config.providerId,
        providerName: config.providerName,
        modelId: config.modelId,
        task: 'text-to-image',
        enabled: false,
        isFreeTierModel: config.isFreeTierModel,
        accessMode: 'disabled',
        tokenConfigured: config.tokenConfigured,
        anonymousFreeTierEnabled: config.anonymousFreeTierEnabled,
        credentialEnvVar: config.credentialEnvVar,
        configurationStatus: config.configurationStatus,
        connectionStatus:
          config.errorCategory === 'UNAVAILABLE' ? 'unavailable' : 'error',
        lastHealthCheckAt: this.lastHealthCheckAt,
        lastSmokeTestAt: this.lastSmokeTestAt,
        testRequestCount: this.testRequestCount,
        statusMessage: config.configurationMessage,
        ...(config.setupInstruction
          ? { setupInstruction: config.setupInstruction }
          : {}),
        errorCategory: config.errorCategory,
        warnings: config.warnings,
      };
    }

    if (!config.tokenConfigured && !config.anonymousFreeTierEnabled) {
      const connectionStatus =
        this.runtimeStatus.connectionStatus ?? 'not_configured';
      return {
        providerId: config.providerId,
        providerName: config.providerName,
        modelId: config.modelId,
        task: 'text-to-image',
        enabled: false,
        isFreeTierModel: true,
        accessMode: 'disabled',
        tokenConfigured: false,
        anonymousFreeTierEnabled: false,
        credentialEnvVar: config.credentialEnvVar,
        configurationStatus: 'not_configured',
        connectionStatus,
        lastHealthCheckAt: this.lastHealthCheckAt,
        lastSmokeTestAt: this.lastSmokeTestAt,
        testRequestCount: this.testRequestCount,
        statusMessage:
          this.runtimeStatus.statusMessage ?? config.configurationMessage,
        ...(config.setupInstruction
          ? { setupInstruction: config.setupInstruction }
          : {}),
        ...(this.runtimeStatus.errorCategory
          ? { errorCategory: this.runtimeStatus.errorCategory }
          : { errorCategory: 'MISSING_CREDENTIAL' }),
        ...(this.runtimeStatus.retryAfterSeconds !== undefined
          ? { retryAfterSeconds: this.runtimeStatus.retryAfterSeconds }
          : {}),
        warnings: config.warnings,
      };
    }

    const connectionStatus: ImageGenerationProviderStatusValue =
      this.runtimeStatus.connectionStatus ?? 'configured';

    return {
      providerId: config.providerId,
      providerName: config.providerName,
      modelId: config.modelId,
      task: 'text-to-image',
      enabled: true,
      isFreeTierModel: true,
      accessMode: config.accessMode,
      tokenConfigured: config.tokenConfigured,
      anonymousFreeTierEnabled: config.anonymousFreeTierEnabled,
      credentialEnvVar: config.credentialEnvVar,
      configurationStatus: config.configurationStatus,
      connectionStatus,
      lastHealthCheckAt: this.lastHealthCheckAt,
      lastSmokeTestAt: this.lastSmokeTestAt,
      testRequestCount: this.testRequestCount,
      statusMessage:
        this.runtimeStatus.statusMessage ?? config.configurationMessage,
      ...(config.setupInstruction
        ? { setupInstruction: config.setupInstruction }
        : {}),
      ...(this.runtimeStatus.errorCategory
        ? { errorCategory: this.runtimeStatus.errorCategory }
        : {}),
      ...(this.runtimeStatus.retryAfterSeconds !== undefined
        ? { retryAfterSeconds: this.runtimeStatus.retryAfterSeconds }
        : {}),
      warnings: config.warnings,
    };
  }

  /**
   * Maps a NormalizedImageGenerationRequest into the exact OVHcloud SDXL
   * text2image JSON payload, omitting unsupported parameters cleanly.
   */
  mapProviderPayload(
    request: NormalizedImageGenerationRequest,
  ): OvhcloudSdxlApiPayload {
    return {
      prompt: request.approvedPrompt.trim(),
      ...(request.negativePrompt && request.negativePrompt.trim().length > 0
        ? { negative_prompt: request.negativePrompt.trim() }
        : {}),
    };
  }

  /**
   * Performs a lightweight, non-generative reachability & configuration check.
   * Must NEVER dispatch a POST generation request or consume inference quota.
   */
  async checkHealth(
    options: ImageGenerationExecutionOptions = {},
  ): Promise<ImageGenerationHealthCheckResult> {
    const env = this.getEnv();
    const config = resolveOvhcloudPublicConfiguration(env);
    const token = resolveOvhcloudAccessToken(env);
    this.syncConfigFingerprint(token, config);

    const capabilities = this.getCapabilities();
    const checkedAt = nowIsoTimestamp();
    this.lastHealthCheckAt = checkedAt;

    if (!config.freeTierAvailable || !config.modelValid) {
      this.runtimeStatus = {
        connectionStatus:
          config.errorCategory === 'UNAVAILABLE' ? 'unavailable' : 'error',
        statusMessage: config.configurationMessage,
        errorCategory: config.errorCategory,
      };
      return {
        status: this.getPublicStatus(),
        capabilities,
        reachable: false,
      };
    }

    if (
      !config.tokenConfigured &&
      !config.anonymousFreeTierEnabled &&
      options.allowAnonymousFreeTier !== true
    ) {
      this.runtimeStatus = {
        connectionStatus: 'not_configured',
        statusMessage: config.configurationMessage,
        errorCategory: 'MISSING_CREDENTIAL',
      };
      return {
        status: this.getPublicStatus(),
        capabilities,
        reachable: false,
      };
    }

    const timeoutMs = options.timeoutMs ?? this.healthTimeoutMs;
    const controller = new AbortController();
    let timedOut = false;
    let clientCancelled = false;

    const onExternalAbort = () => {
      clientCancelled = true;
      controller.abort(
        options.abortSignal?.reason ?? new Error('Health check cancelled.'),
      );
    };
    if (options.abortSignal) {
      if (options.abortSignal.aborted) {
        this.runtimeStatus = {
          connectionStatus: 'error',
          statusMessage: 'Provider connection check was cancelled.',
          errorCategory: 'CANCELLED',
        };
        return {
          status: this.getPublicStatus(),
          capabilities,
          reachable: false,
        };
      }
      options.abortSignal.addEventListener('abort', onExternalAbort, {
        once: true,
      });
    }

    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(
        new Error(`OVHcloud health probe timed out after ${timeoutMs}ms.`),
      );
    }, timeoutMs);

    try {
      const headers: Record<string, string> = {
        Accept: 'application/json, application/octet-stream',
      };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const response = await this.fetchFn(config.endpointUrl, {
        method: 'HEAD',
        headers,
        signal: controller.signal,
      });

      // OVHcloud text2image is POST-only, so HTTP 405 on HEAD proves TLS + route
      // availability without sending a text-to-image inference request.
      if (response.ok || response.status === 405) {
        const modeLabel = token
          ? 'token-authenticated mode'
          : 'anonymous free-tier mode (2 RPM)';
        this.runtimeStatus = {
          connectionStatus: 'connected',
          statusMessage: `OVHcloud SDXL endpoint reachable (${modeLabel}, non-generative probe HTTP ${response.status}).`,
        };
        return {
          status: this.getPublicStatus(),
          capabilities,
          reachable: true,
        };
      }

      const retryAfterSeconds = parseRetryAfterSeconds(
        response.headers.get('retry-after'),
      );
      throw new OvhcloudHttpError(
        response.status,
        `OVHcloud health check received HTTP ${response.status}.`,
        retryAfterSeconds,
      );
    } catch (error: unknown) {
      const mapped = mapOvhcloudProviderError(error, {
        extraSecrets: token ? [token] : [],
        timedOut,
        cancelled: clientCancelled,
      });

      let connectionStatus: ImageGenerationProviderStatusValue = 'error';
      if (mapped.category === 'RATE_LIMITED') {
        connectionStatus = 'rate_limited';
      } else if (
        mapped.category === 'UNAVAILABLE' ||
        mapped.category === 'PROVIDER_UNAVAILABLE'
      ) {
        connectionStatus = 'unavailable';
      }

      this.runtimeStatus = {
        connectionStatus,
        statusMessage: mapped.message,
        errorCategory: mapped.category,
        ...(mapped.retryAfterSeconds !== undefined
          ? { retryAfterSeconds: mapped.retryAfterSeconds }
          : {}),
      };

      return {
        status: this.getPublicStatus(),
        capabilities,
        reachable: false,
      };
    } finally {
      clearTimeout(timer);
      if (options.abortSignal) {
        options.abortSignal.removeEventListener('abort', onExternalAbort);
      }
    }
  }

  async generate(
    request: NormalizedImageGenerationRequest,
    options: ImageGenerationExecutionOptions = {},
  ): Promise<NormalizedImageGenerationResponse> {
    const startedAtMs = Date.now();
    const generationId = createEntityId('job');
    const createdAt = nowIsoTimestamp();

    const env = this.getEnv();
    const config = resolveOvhcloudPublicConfiguration(env);
    const token = resolveOvhcloudAccessToken(env);
    this.syncConfigFingerprint(token, config);
    const capabilities = this.getCapabilities();

    const failResponse = (params: {
      readonly category: ImageGenerationProviderErrorCategory;
      readonly code:
        | 'VALIDATION_ERROR'
        | 'PROVIDER_UNAVAILABLE'
        | 'PROVIDER_ERROR'
        | 'SECURITY_BOUNDARY_VIOLATION';
      readonly message: string;
      readonly retryable: boolean;
      readonly upstreamStatus?: number;
      readonly retryAfterSeconds?: number;
    }): NormalizedImageGenerationResponse => {
      const durationMs = Math.max(0, Date.now() - startedAtMs);
      if (params.category === 'RATE_LIMITED') {
        this.runtimeStatus = {
          connectionStatus: 'rate_limited',
          statusMessage: params.message,
          errorCategory: params.category,
          ...(params.retryAfterSeconds !== undefined
            ? { retryAfterSeconds: params.retryAfterSeconds }
            : {}),
        };
      } else if (
        params.category === 'UNAVAILABLE' ||
        params.category === 'PROVIDER_UNAVAILABLE'
      ) {
        this.runtimeStatus = {
          connectionStatus: 'unavailable',
          statusMessage: params.message,
          errorCategory: params.category,
        };
      } else if (params.category !== 'CANCELLED') {
        this.runtimeStatus = {
          connectionStatus: 'error',
          statusMessage: params.message,
          errorCategory: params.category,
        };
      }

      return {
        generationId,
        providerId: OVHCLOUD_PROVIDER_ID,
        modelId: config.modelId,
        status: 'failed',
        createdAt,
        durationMs,
        error: {
          code: params.code,
          category: params.category,
          message: params.message,
          retryable: params.retryable,
          ...(params.upstreamStatus !== undefined
            ? { upstreamStatus: params.upstreamStatus }
            : {}),
        },
      };
    };

    const normalizationResult = normalizeGenerationRequest(request, capabilities);
    if (!normalizationResult.ok) {
      return failResponse({
        category: 'INVALID_CONFIGURATION',
        code:
          normalizationResult.error.code === 'SECURITY_BOUNDARY_VIOLATION'
            ? 'SECURITY_BOUNDARY_VIOLATION'
            : 'VALIDATION_ERROR',
        message: normalizationResult.error.message,
        retryable: false,
      });
    }

    if (!config.freeTierAvailable || !config.modelValid) {
      const mapped = mapOvhcloudProviderError(
        new OvhcloudConfigurationError(
          config.errorCategory ?? 'UNAVAILABLE',
          config.configurationMessage,
        ),
        { extraSecrets: token ? [token] : [] },
      );
      return failResponse({
        category: mapped.category,
        code:
          mapped.serviceErrorCode === 'PROVIDER_UNAVAILABLE'
            ? 'PROVIDER_UNAVAILABLE'
            : 'VALIDATION_ERROR',
        message: mapped.message,
        retryable: mapped.retryable,
      });
    }

    const anonymousPermitted =
      config.anonymousFreeTierEnabled || options.allowAnonymousFreeTier === true;

    if (!token && !anonymousPermitted) {
      const mapped = mapOvhcloudProviderError(
        new OvhcloudConfigurationError(
          'MISSING_CREDENTIAL',
          `${OVH_ACCESS_TOKEN_ENV_VAR} is not configured and anonymous free-tier access was not confirmed.`,
        ),
      );
      return failResponse({
        category: mapped.category,
        code: 'VALIDATION_ERROR',
        message: mapped.message,
        retryable: false,
      });
    }

    if (this.inFlightGenerations >= this.maxConcurrentGenerations) {
      return failResponse({
        category: 'RATE_LIMITED',
        code: 'PROVIDER_UNAVAILABLE',
        message:
          'Another free-tier OVHcloud generation request is already in progress. Wait for completion before sending another request.',
        retryable: true,
        retryAfterSeconds: 5,
      });
    }

    if (options.abortSignal?.aborted) {
      return failResponse({
        category: 'CANCELLED',
        code: 'PROVIDER_UNAVAILABLE',
        message: 'OVHcloud image generation request was cancelled before dispatch.',
        retryable: true,
      });
    }

    const { normalizedRequest, omittedParameters } = normalizationResult.data;
    const apiPayload = this.mapProviderPayload(normalizedRequest);
    const accessMode: 'authenticated' | 'anonymous_free_tier' = token
      ? 'authenticated'
      : 'anonymous_free_tier';

    const timeoutMs = options.timeoutMs ?? this.generationTimeoutMs;
    const controller = new AbortController();
    let timedOut = false;
    let clientCancelled = false;

    const onExternalAbort = () => {
      clientCancelled = true;
      controller.abort(
        options.abortSignal?.reason ?? new Error('Generation cancelled by client.'),
      );
    };
    if (options.abortSignal) {
      options.abortSignal.addEventListener('abort', onExternalAbort, {
        once: true,
      });
    }

    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(
        new Error(`OVHcloud SDXL generation timed out after ${timeoutMs}ms.`),
      );
    }, timeoutMs);

    this.inFlightGenerations += 1;
    this.testRequestCount += 1;
    const currentRequestNumber = this.testRequestCount;

    try {
      const headers: Record<string, string> = {
        Accept: 'application/octet-stream',
        'Content-Type': 'application/json',
      };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const response = await this.fetchFn(config.endpointUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(apiPayload),
        signal: controller.signal,
      });

      if (!response.ok) {
        const retryAfterSeconds = parseRetryAfterSeconds(
          response.headers.get('retry-after'),
        );
        let upstreamDetail = '';
        try {
          const errorText = await response.text();
          if (errorText) {
            upstreamDetail = sanitizeDiagnosticMessage(
              errorText.slice(0, 240),
              token ? [token] : [],
            );
          }
        } catch {
          // Ignore unreadable error bodies.
        }
        throw new OvhcloudHttpError(
          response.status,
          upstreamDetail ||
            `OVHcloud AI Endpoints returned HTTP ${response.status}.`,
          retryAfterSeconds,
        );
      }

      const declaredLengthHeader = response.headers.get('content-length');
      if (declaredLengthHeader) {
        const parsedLength = Number(declaredLengthHeader);
        if (
          Number.isFinite(parsedLength) &&
          parsedLength > MAX_GENERATED_IMAGE_BYTES
        ) {
          throw new OvhcloudHttpError(
            502,
            `Declared image byte length (${parsedLength}) exceeds safety ceiling.`,
          );
        }
      }

      const arrayBuffer = await response.arrayBuffer();
      const rawBytes = new Uint8Array(arrayBuffer);
      const inspected = inspectGeneratedImageBinary({
        bytes: rawBytes,
        contentTypeHeader: response.headers.get('content-type'),
      });

      const durationMs = Math.max(0, Date.now() - startedAtMs);
      this.runtimeStatus = {
        connectionStatus: 'connected',
        statusMessage: `Last free-tier SDXL generation succeeded (${inspected.width} × ${inspected.height} ${inspected.outputFormat.toUpperCase()}, ${durationMs}ms).`,
      };

      return {
        generationId,
        providerId: OVHCLOUD_PROVIDER_ID,
        modelId: config.modelId,
        status: 'succeeded',
        outputFormat: inspected.outputFormat,
        mimeType: inspected.mimeType,
        outputDimensions: {
          width: inspected.width,
          height: inspected.height,
        },
        imageBytes: inspected.bytes,
        createdAt,
        durationMs,
        usageMetadata: {
          isFreeTier: true,
          accessMode,
          testRequestCount: currentRequestNumber,
          anonymousRateLimitRpm: token ? null : OVH_ANONYMOUS_RATE_LIMIT_RPM,
          byteSize: inspected.byteSize,
          omittedParameters,
        },
      };
    } catch (error: unknown) {
      const mapped = mapOvhcloudProviderError(error, {
        extraSecrets: token ? [token] : [],
        timedOut,
        cancelled: clientCancelled,
      });

      console.error(
        '[FormFusion OVHcloud SDXL]',
        sanitizeDiagnosticMessage(
          `Generation failed (${mapped.category}): ${mapped.message}`,
          token ? [token] : [],
        ),
      );

      return failResponse({
        category: mapped.category,
        code:
          mapped.serviceErrorCode === 'PROVIDER_UNAVAILABLE'
            ? 'PROVIDER_UNAVAILABLE'
            : mapped.serviceErrorCode === 'VALIDATION_ERROR'
              ? 'VALIDATION_ERROR'
              : 'PROVIDER_ERROR',
        message: mapped.message,
        retryable: mapped.retryable,
        upstreamStatus: mapped.upstreamStatus,
        retryAfterSeconds: mapped.retryAfterSeconds,
      });
    } finally {
      clearTimeout(timer);
      this.inFlightGenerations = Math.max(0, this.inFlightGenerations - 1);
      if (options.abortSignal) {
        options.abortSignal.removeEventListener('abort', onExternalAbort);
      }
    }
  }

  async runSmokeTest(options: {
    readonly confirmed: boolean;
    readonly prompt?: string;
    readonly allowAnonymousFreeTier?: boolean;
    readonly abortSignal?: AbortSignal;
    readonly timeoutMs?: number;
  }): Promise<ServiceResult<ImageGenerationSmokeTestResult>> {
    if (options.confirmed !== true) {
      return errResult(
        'VALIDATION_ERROR',
        'Explicit user confirmation (confirmed: true) is required before triggering a provider smoke test.',
      );
    }

    const smokePrompt =
      typeof options.prompt === 'string' && options.prompt.trim().length > 0
        ? options.prompt.trim()
        : OVHCLOUD_DEFAULT_SMOKE_TEST_PROMPT;

    const capabilities = this.getCapabilities();
    const normalization = normalizeGenerationRequest(
      {
        projectId: 'prj_smoketest01',
        promptId: 'prm_smoketest01',
        approvalStatus: 'approved',
        approvedPrompt: smokePrompt,
        modelId: capabilities.modelId,
        aspectRatio: '1:1',
        outputWidth: 1024,
        outputHeight: 1024,
        numberOfImages: 1,
        providerParameters: {},
        isSmokeTest: true,
      },
      capabilities,
    );

    if (!normalization.ok) {
      return errResult(
        normalization.error.code,
        normalization.error.message,
        normalization.error.details,
      );
    }

    const response = await this.generate(normalization.data.normalizedRequest, {
      allowAnonymousFreeTier: options.allowAnonymousFreeTier,
      abortSignal: options.abortSignal,
      timeoutMs: options.timeoutMs,
    });

    if (response.status !== 'succeeded' || !response.imageBytes) {
      return errResult(
        response.error?.code ?? 'PROVIDER_ERROR',
        response.error?.message ?? 'OVHcloud SDXL smoke test failed.',
        {
          ...(response.error?.category
            ? { category: response.error.category }
            : {}),
          ...(response.error?.retryable !== undefined
            ? { retryable: response.error.retryable }
            : {}),
          ...(response.error?.upstreamStatus !== undefined
            ? { upstreamStatus: response.error.upstreamStatus }
            : {}),
        },
      );
    }

    this.lastSmokeTestAt = response.createdAt;
    const base64 = Buffer.from(
      response.imageBytes.buffer,
      response.imageBytes.byteOffset,
      response.imageBytes.byteLength,
    ).toString('base64');
    const mimeType = response.mimeType ?? 'image/png';

    return okResult({
      generationId: response.generationId,
      providerId: response.providerId,
      modelId: response.modelId,
      status: 'succeeded',
      promptUsed: smokePrompt,
      outputFormat: response.outputFormat ?? 'png',
      mimeType,
      width: response.outputDimensions?.width ?? 1024,
      height: response.outputDimensions?.height ?? 1024,
      byteSize: response.usageMetadata?.byteSize ?? response.imageBytes.byteLength,
      durationMs: response.durationMs,
      createdAt: response.createdAt,
      accessMode: response.usageMetadata?.accessMode ?? 'anonymous_free_tier',
      isFreeTierModel: true,
      testRequestCount:
        response.usageMetadata?.testRequestCount ?? this.testRequestCount,
      omittedParameters: response.usageMetadata?.omittedParameters ?? [],
      previewImageDataUrl: `data:${mimeType};base64,${base64}`,
    });
  }

  /**
   * Compatibility helper bridging legacy Phase 01.1 ImageGenerationProviderAdapter
   * signature if invoked internally by adapter consumers.
   */
  normalizeLegacyInput(input: TextToImageProviderInput): NormalizedImageGenerationRequest {
    return {
      projectId: 'prj_legacy0001',
      promptId: 'prm_legacy0001',
      approvalStatus: 'approved',
      approvedPrompt: input.finalApprovedPrompt,
      ...(input.negativePrompt ? { negativePrompt: input.negativePrompt } : {}),
      modelId: OVHCLOUD_SDXL_MODEL_ID,
      aspectRatio: '1:1',
      outputWidth: 1024,
      outputHeight: 1024,
      numberOfImages: 1,
      providerParameters: {
        ...(input.guidanceScale !== undefined
          ? { guidanceScale: input.guidanceScale }
          : {}),
        ...(input.inferenceSteps !== undefined
          ? { inferenceSteps: input.inferenceSteps }
          : {}),
        ...(input.seed !== undefined ? { seed: input.seed } : {}),
      },
    };
  }

  normalizeError(error: unknown): ProviderNormalizedError {
    const token = resolveOvhcloudAccessToken(this.getEnv());
    const mapped = mapOvhcloudProviderError(error, {
      extraSecrets: token ? [token] : [],
    });
    return {
      providerId: OVHCLOUD_PROVIDER_ID,
      code: mapped.serviceErrorCode,
      message: mapped.message,
      retryable: mapped.retryable,
      ...(mapped.upstreamStatus !== undefined
        ? { upstreamStatus: mapped.upstreamStatus }
        : {}),
    };
  }

  private syncConfigFingerprint(
    token: string | null,
    config: OvhcloudPublicConfiguration,
  ): void {
    const nextFingerprint = fingerprintOvhConfig(token, config);
    if (this.cachedFingerprint !== nextFingerprint) {
      this.cachedFingerprint = nextFingerprint;
      this.runtimeStatus = {};
    }
  }
}

export function createOvhcloudSdxlProvider(
  options?: OvhcloudSdxlProviderOptions,
): OvhcloudSdxlProvider {
  return new OvhcloudSdxlProvider(options);
}

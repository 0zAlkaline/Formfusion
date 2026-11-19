import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { createHash } from 'node:crypto';
import { errResult, okResult } from '../../../src/types/common.ts';
import type { ServiceResult } from '../../../src/types/common.ts';
import type {
  GeminiErrorCategory,
  GeminiProviderPublicStatus,
  ProviderAuthContext,
  ProviderCapabilityDeclaration,
  ProviderNormalizedError,
  RawVisionAnalysisResult,
  VisionAnalysisProviderAdapter,
  VisionAnalysisProviderInput,
  VisionAnalysisProviderOutput,
  VisionAnalysisTokenUsage,
  VisionRawAnalysisInput,
} from '../../../src/types/providers.ts';
import { formatFileSize } from '../../../src/services/source-asset/imageValidation.ts';
import { sanitizeDiagnosticMessage } from '../../middleware/security.ts';
import { MAX_GEMINI_INLINE_IMAGE_BYTES } from '../../services/visionImageValidation.ts';
import {
  prepareTransientVisionPayload,
  type VisionPayloadPreparer,
} from '../../services/visionPayloadOptimizer.ts';
import {
  DEFAULT_GEMINI_VISION_MODEL_ID,
  GEMINI_API_KEY_ENV_VAR,
  GEMINI_PROVIDER_ID,
  GEMINI_PROVIDER_NAME,
  resolveGeminiPublicConfiguration,
  resolveGeminiServerCredential,
  type GeminiEnvSource,
  type GeminiPublicConfiguration,
} from './config.ts';
import {
  GeminiConfigurationError,
  GeminiResponseError,
  GeminiSdkInitializationError,
  mapGeminiProviderError,
  type MappedGeminiProviderError,
} from './errorMapper.ts';

export const GEMINI_VISION_INITIAL_INSTRUCTION = `You are an image understanding assistant for a creative transformation studio.

Inspect the supplied image carefully.

Identify the main visible subject and describe only what can reasonably be observed.

Pay attention to:

- Main subject identity.
- Object or subject category.
- Overall shape and silhouette.
- Visible materials and textures.
- Dominant colors.
- Surface details.
- Distinctive visual features.
- Composition.
- Camera angle or viewing perspective.
- Visible background.
- Uncertain or ambiguous attributes.

Distinguish direct visual observations from assumptions.

Do not invent hidden features.

Do not claim certainty when the image does not support it.

If the image contains a person, describe visible appearance and clothing neutrally without attempting to identify the person's identity.

Return a concise but informative visual analysis.`;

export interface GeminiGenerateContentResponseLike {
  readonly text?: string;
  readonly modelVersion?: string;
  readonly responseId?: string;
  readonly promptFeedback?: {
    readonly blockReason?: string;
    readonly blockReasonMessage?: string;
  };
  readonly candidates?: ReadonlyArray<{
    readonly finishReason?: string;
  }>;
  readonly usageMetadata?: {
    readonly promptTokenCount?: number;
    readonly candidatesTokenCount?: number;
    readonly thoughtsTokenCount?: number;
    readonly totalTokenCount?: number;
  };
}

export interface GeminiGenerateContentParams {
  model: string;
  contents: {
    parts: Array<
      | {
          inlineData: {
            mimeType: string;
            data: string;
          };
        }
      | { text: string }
    >;
  };
  config?: {
    abortSignal?: AbortSignal;
    httpOptions?: {
      timeout?: number;
      headers?: Record<string, string>;
    };
    thinkingConfig?: {
      thinkingLevel?: ThinkingLevel;
    };
  };
}

export interface GeminiSdkClient {
  readonly models: {
    get(params: {
      model: string;
      config?: {
        abortSignal?: AbortSignal;
        httpOptions?: {
          timeout?: number;
          headers?: Record<string, string>;
        };
      };
    }): Promise<unknown>;
    generateContent(
      params: GeminiGenerateContentParams,
    ): Promise<GeminiGenerateContentResponseLike>;
  };
}

export type GeminiSdkClientFactory = (apiKey: string) => GeminiSdkClient;

export interface GeminiVisionProviderOptions {
  readonly getEnv?: () => GeminiEnvSource;
  readonly createSdkClient?: GeminiSdkClientFactory;
  readonly prepareVisionPayload?: VisionPayloadPreparer;
  readonly defaultConnectivityTimeoutMs?: number;
  readonly defaultAnalysisTimeoutMs?: number;
  readonly maxRetries?: number;
  readonly retryBaseDelayMs?: number;
}

export interface GeminiConnectivityCheckResult {
  readonly status: GeminiProviderPublicStatus;
  readonly mappedError?: MappedGeminiProviderError;
}

export interface GeminiRawAnalysisExecutionResult {
  readonly result?: RawVisionAnalysisResult;
  readonly mappedError?: MappedGeminiProviderError;
  readonly cancelled?: boolean;
}

const DEFAULT_CONNECTIVITY_TIMEOUT_MS = 8000;
const DEFAULT_ANALYSIS_TIMEOUT_MS = 60000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_DELAY_MS = 600;
const GEMINI_TELEMETRY_HEADERS = {
  'User-Agent': 'aistudio-build',
} as const;

function sleepWithAbort(delayMs: number, signal: AbortSignal): Promise<void> {
  if (delayMs <= 0 || signal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export function createDefaultGeminiSdkClient(apiKey: string): GeminiSdkClient {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        ...GEMINI_TELEMETRY_HEADERS,
      },
    },
  });
}

function fingerprintConfig(
  credential: string | null,
  modelId: string | null,
): string {
  const keyHash = credential
    ? createHash('sha256').update(credential).digest('hex').slice(0, 12)
    : 'none';
  return `${keyHash}:${modelId ?? 'none'}`;
}

export class GeminiVisionProvider implements VisionAnalysisProviderAdapter {
  readonly providerId = GEMINI_PROVIDER_ID;

  private readonly getEnv: () => GeminiEnvSource;
  private readonly createSdkClient: GeminiSdkClientFactory;
  private readonly prepareVisionPayload: VisionPayloadPreparer;
  private readonly defaultConnectivityTimeoutMs: number;
  private readonly defaultAnalysisTimeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;

  private cachedFingerprint: string | null = null;
  private cachedClient: GeminiSdkClient | null = null;
  private cachedInitError: MappedGeminiProviderError | null = null;
  private connectivityState: {
    readonly checked: boolean;
    readonly verified: boolean;
    readonly lastCheckedAt: string | null;
    readonly errorCategory?: GeminiErrorCategory;
    readonly statusMessage?: string;
  } = {
    checked: false,
    verified: false,
    lastCheckedAt: null,
  };

  constructor(options: GeminiVisionProviderOptions = {}) {
    this.getEnv = options.getEnv ?? (() => process.env);
    this.createSdkClient =
      options.createSdkClient ?? createDefaultGeminiSdkClient;
    this.prepareVisionPayload =
      options.prepareVisionPayload ?? prepareTransientVisionPayload;
    this.defaultConnectivityTimeoutMs =
      options.defaultConnectivityTimeoutMs ?? DEFAULT_CONNECTIVITY_TIMEOUT_MS;
    this.defaultAnalysisTimeoutMs =
      options.defaultAnalysisTimeoutMs ?? DEFAULT_ANALYSIS_TIMEOUT_MS;
    this.maxRetries = Math.max(0, options.maxRetries ?? DEFAULT_MAX_RETRIES);
    this.retryBaseDelayMs = Math.max(
      0,
      options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS,
    );
  }

  getCapabilities(): ProviderCapabilityDeclaration {
    const publicConfig = resolveGeminiPublicConfiguration(this.getEnv());
    const activeModel = publicConfig.modelId ?? DEFAULT_GEMINI_VISION_MODEL_ID;
    return {
      providerId: GEMINI_PROVIDER_ID,
      kind: 'vision_analysis',
      displayName: GEMINI_PROVIDER_NAME,
      supportedModels: [activeModel],
      supportsNegativePrompt: false,
      supportedAspectRatios: [],
      maxPromptLength: 0,
      maxOutputResolution: { width: 0, height: 0 },
      supportsSeed: false,
    };
  }

  resolveAuthContext(): ProviderAuthContext {
    const publicConfig = resolveGeminiPublicConfiguration(this.getEnv());
    return {
      providerId: GEMINI_PROVIDER_ID,
      credentialEnvVar: GEMINI_API_KEY_ENV_VAR,
      isConfigured: publicConfig.credentialConfigured,
    };
  }

  mapRawVisionRequest(
    input: VisionRawAnalysisInput,
    modelId: string,
  ): GeminiGenerateContentParams {
    const encodedData = Buffer.from(
      input.imageBytes.buffer,
      input.imageBytes.byteOffset,
      input.imageBytes.byteLength,
    ).toString('base64');

    return {
      model: modelId,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: input.mimeType,
              data: encodedData,
            },
          },
          {
            text: GEMINI_VISION_INITIAL_INSTRUCTION,
          },
        ],
      },
    };
  }

  /**
   * Executes a real multimodal image understanding request against the configured
   * server-side Gemini model using raw binary input from the backend endpoint.
   * Structured ObjectAnalysis normalization remains deferred to Phase 02.3.3.
   */
  async analyzeRawImage(
    input: VisionRawAnalysisInput,
  ): Promise<GeminiRawAnalysisExecutionResult> {
    const env = this.getEnv();
    const publicConfig = resolveGeminiPublicConfiguration(env);
    const credential = resolveGeminiServerCredential(env);
    this.syncFingerprint(credential, publicConfig.modelId);

    if (!publicConfig.credentialConfigured) {
      return {
        mappedError: mapGeminiProviderError(
          new GeminiConfigurationError(
            publicConfig.errorCategory ?? 'MISSING_CREDENTIAL',
            publicConfig.configurationMessage,
          ),
        ),
      };
    }

    if (!publicConfig.modelConfigured || !publicConfig.modelId) {
      return {
        mappedError: mapGeminiProviderError(
          new GeminiConfigurationError(
            publicConfig.errorCategory ?? 'INVALID_MODEL_CONFIGURATION',
            publicConfig.configurationMessage,
          ),
          credential ? [credential] : [],
        ),
      };
    }

    if (input.imageBytes.byteLength === 0) {
      return {
        mappedError: mapGeminiProviderError(
          new GeminiConfigurationError(
            'INVALID_CONFIGURATION',
            'Uploaded image binary is empty.',
          ),
          credential ? [credential] : [],
        ),
      };
    }

    if (input.imageBytes.byteLength > MAX_GEMINI_INLINE_IMAGE_BYTES) {
      return {
        mappedError: mapGeminiProviderError(
          new GeminiConfigurationError(
            'INVALID_CONFIGURATION',
            `Source image (${formatFileSize(input.imageBytes.byteLength)}) exceeds the Gemini inline Vision request limit (${formatFileSize(MAX_GEMINI_INLINE_IMAGE_BYTES)} raw before encoding). Choose a smaller image without altering the original file.`,
          ),
          credential ? [credential] : [],
        ),
      };
    }

    const clientResult = this.ensureClientInitialized(
      credential,
      publicConfig.modelId,
    );
    if (!clientResult.ok) {
      return { mappedError: clientResult.mappedError };
    }

    if (input.abortSignal?.aborted) {
      return { cancelled: true };
    }

    const timeoutMs = input.timeoutMs ?? this.defaultAnalysisTimeoutMs;
    const controller = new AbortController();
    let timedOut = false;
    let clientCancelled = false;

    const onExternalAbort = () => {
      clientCancelled = true;
      controller.abort(
        input.abortSignal?.reason ?? new Error('Client aborted Vision request.'),
      );
    };

    if (input.abortSignal) {
      input.abortSignal.addEventListener('abort', onExternalAbort, {
        once: true,
      });
    }

    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(
        new Error(`Gemini Vision analysis timed out after ${timeoutMs}ms`),
      );
    }, timeoutMs);

    const startedAt = Date.now();
    const deadlineAt = startedAt + timeoutMs;

    try {
      const prepared = await this.prepareVisionPayload({
        mimeType: input.mimeType,
        imageBytes: input.imageBytes,
      });

      const requestPayload = this.mapRawVisionRequest(
        {
          ...input,
          mimeType: prepared.mimeType,
          imageBytes: prepared.imageBytes,
        },
        publicConfig.modelId,
      );

      const supportsThinkingLevel =
        /^gemini-(3|4)/i.test(publicConfig.modelId);
      const totalAttempts = 1 + this.maxRetries;

      for (let attempt = 0; attempt < totalAttempts; attempt += 1) {
        if (clientCancelled && !timedOut) {
          return { cancelled: true };
        }

        const remainingBudgetMs = Math.max(1000, deadlineAt - Date.now());
        const perAttemptCapMs =
          this.maxRetries > 0 && timeoutMs >= 45000
            ? Math.min(remainingBudgetMs, 22000)
            : remainingBudgetMs;

        const attemptController = new AbortController();
        const forwardAbort = () => {
          attemptController.abort(controller.signal.reason);
        };
        if (controller.signal.aborted) {
          forwardAbort();
        } else {
          controller.signal.addEventListener('abort', forwardAbort, {
            once: true,
          });
        }
        const attemptTimer =
          perAttemptCapMs < remainingBudgetMs
            ? setTimeout(() => {
                attemptController.abort(
                  new Error(
                    `Gemini Vision attempt ${attempt + 1} timed out after ${perAttemptCapMs}ms`,
                  ),
                );
              }, perAttemptCapMs)
            : undefined;

        try {
          const response = await clientResult.client.models.generateContent({
            ...requestPayload,
            config: {
              abortSignal: attemptController.signal,
              httpOptions: {
                timeout: attempt === 0 ? timeoutMs : remainingBudgetMs,
                headers: { ...GEMINI_TELEMETRY_HEADERS },
              },
              ...(supportsThinkingLevel
                ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
                : {}),
            },
          });

          if (!response || typeof response !== 'object') {
            throw new GeminiResponseError(
              'INVALID_RESPONSE',
              'Gemini returned an invalid or unrecognized response structure.',
            );
          }

          if (response.promptFeedback?.blockReason) {
            throw new GeminiResponseError(
              'BLOCKED_RESPONSE',
              response.promptFeedback.blockReasonMessage ??
                `Gemini declined to analyze the image (${response.promptFeedback.blockReason}).`,
            );
          }

          const extractedText =
            typeof response.text === 'string' ? response.text.trim() : '';
          if (extractedText.length === 0) {
            throw new GeminiResponseError(
              'EMPTY_RESPONSE',
              'Gemini returned an empty response with no visual analysis text. Try running the analysis again.',
            );
          }

          const usage = extractGenuineTokenUsage(response.usageMetadata);
          const finishReason =
            typeof response.candidates?.[0]?.finishReason === 'string'
              ? response.candidates[0].finishReason
              : undefined;

          const rawResult: RawVisionAnalysisResult = {
            requestStatus: 'succeeded',
            providerId: GEMINI_PROVIDER_ID,
            modelId: publicConfig.modelId,
            ...(typeof response.modelVersion === 'string' &&
            response.modelVersion.trim().length > 0
              ? { modelVersion: response.modelVersion.trim() }
              : {}),
            ...(typeof response.responseId === 'string' &&
            response.responseId.trim().length > 0
              ? { responseId: response.responseId.trim() }
              : {}),
            analyzedAt: new Date().toISOString(),
            projectId: input.projectId,
            sourceAssetId: input.sourceAssetId,
            rawText: extractedText,
            ...(finishReason ? { finishReason } : {}),
            ...(usage ? { usageMetadata: usage } : {}),
          };

          this.connectivityState = {
            checked: true,
            verified: true,
            lastCheckedAt: rawResult.analyzedAt,
          };

          return { result: rawResult };
        } catch (attemptError: unknown) {
          if (clientCancelled && !timedOut) {
            return { cancelled: true };
          }

          const mapped = mapGeminiProviderError(
            attemptError,
            credential ? [credential] : [],
          );

          const jitterMs =
            this.retryBaseDelayMs > 0 ? Math.floor(Math.random() * 120) : 0;
          const backoffMs =
            this.retryBaseDelayMs > 0
              ? Math.min(4000, this.retryBaseDelayMs * 2 ** attempt) + jitterMs
              : 0;
          const hasNextAttempt = attempt + 1 < totalAttempts;
          const minRemainingForRetryMs = timeoutMs >= 10000 ? 11500 : 500;
          const hasBudgetForRetry =
            Date.now() + backoffMs + minRemainingForRetryMs <= deadlineAt;

          if (
            !timedOut &&
            !controller.signal.aborted &&
            mapped.retryable &&
            hasNextAttempt &&
            hasBudgetForRetry
          ) {
            const detailSuffix = mapped.diagnosticDetail
              ? ` (${mapped.diagnosticDetail})`
              : '';
            console.warn(
              '[FormFusion Gemini Vision]',
              sanitizeDiagnosticMessage(
                `Transient Vision failure on attempt ${attempt + 1}/${totalAttempts} (${mapped.category}, status=${mapped.upstreamStatus ?? 'n/a'}) for project=${input.projectId} asset=${input.sourceAssetId}${detailSuffix}; retrying in ${backoffMs}ms.`,
                credential ? [credential] : [],
              ),
            );
            await sleepWithAbort(backoffMs, controller.signal);
            continue;
          }

          throw mapped;
        } finally {
          if (attemptTimer !== undefined) {
            clearTimeout(attemptTimer);
          }
          controller.signal.removeEventListener('abort', forwardAbort);
        }
      }

      throw mapGeminiProviderError(
        new Error('Gemini Vision analysis exhausted all retry attempts.'),
        credential ? [credential] : [],
      );
    } catch (error: unknown) {
      if (clientCancelled && !timedOut) {
        return { cancelled: true };
      }

      const mapped =
        typeof error === 'object' &&
        error !== null &&
        'category' in error &&
        'httpStatus' in error &&
        'normalized' in error
          ? (error as MappedGeminiProviderError)
          : mapGeminiProviderError(error, credential ? [credential] : []);

      const detailSuffix = mapped.diagnosticDetail
        ? ` | detail: ${mapped.diagnosticDetail}`
        : '';
      console.error(
        '[FormFusion Gemini Vision]',
        sanitizeDiagnosticMessage(
          `Vision analysis failed (${mapped.category}, status=${mapped.upstreamStatus ?? 'n/a'}) for project=${input.projectId} asset=${input.sourceAssetId}: ${mapped.message}${detailSuffix}`,
          credential ? [credential] : [],
        ),
      );

      return { mappedError: mapped };
    } finally {
      clearTimeout(timer);
      if (input.abortSignal) {
        input.abortSignal.removeEventListener('abort', onExternalAbort);
      }
    }
  }

  mapRequest(_input: VisionAnalysisProviderInput): unknown {
    throw new Error(
      'Structured Gemini Vision ObjectAnalysis mapping is deferred to Phase 02.3.3.',
    );
  }

  async execute(
    _input: VisionAnalysisProviderInput,
  ): Promise<ServiceResult<VisionAnalysisProviderOutput>> {
    return errResult(
      'NOT_IMPLEMENTED',
      'Structured ObjectAnalysis normalization is deferred to Phase 02.3.3.',
    );
  }

  normalizeError(error: unknown): ProviderNormalizedError {
    const credential = resolveGeminiServerCredential(this.getEnv());
    return mapGeminiProviderError(error, credential ? [credential] : []).normalized;
  }

  /**
   * Resolves configuration state without invoking SDK initialization or external calls.
   */
  getConfigurationStatus(): GeminiProviderPublicStatus {
    const env = this.getEnv();
    const publicConfig = resolveGeminiPublicConfiguration(env);
    return this.buildUnconnectedStatus(publicConfig, 'CONFIGURED');
  }

  /**
   * Resolves configuration and initializes the server-side @google/genai client
   * when credentials and model configuration are valid. Performs zero generative inference.
   */
  getStatus(): GeminiProviderPublicStatus {
    const env = this.getEnv();
    const publicConfig = resolveGeminiPublicConfiguration(env);
    const credential = resolveGeminiServerCredential(env);
    this.syncFingerprint(credential, publicConfig.modelId);

    if (!publicConfig.credentialConfigured || !publicConfig.modelConfigured) {
      return this.buildUnconnectedStatus(publicConfig, 'NOT_CONFIGURED');
    }

    const clientResult = this.ensureClientInitialized(
      credential,
      publicConfig.modelId,
    );

    if (!clientResult.ok) {
      return {
        providerId: GEMINI_PROVIDER_ID,
        providerName: GEMINI_PROVIDER_NAME,
        kind: 'vision_analysis',
        modelId: publicConfig.modelId,
        credentialEnvVar: GEMINI_API_KEY_ENV_VAR,
        modelEnvVar: publicConfig.modelEnvVar,
        enabled: false,
        credentialConfigured: true,
        modelConfigured: true,
        initializationStatus: 'ERROR',
        connectivityChecked: this.connectivityState.checked,
        lastCheckedAt: this.connectivityState.lastCheckedAt,
        capabilitiesPendingVerification: true,
        statusMessage: clientResult.mappedError.message,
        errorCategory: clientResult.mappedError.category,
      };
    }

    if (this.connectivityState.checked && this.connectivityState.verified) {
      return {
        providerId: GEMINI_PROVIDER_ID,
        providerName: GEMINI_PROVIDER_NAME,
        kind: 'vision_analysis',
        modelId: publicConfig.modelId,
        credentialEnvVar: GEMINI_API_KEY_ENV_VAR,
        modelEnvVar: publicConfig.modelEnvVar,
        enabled: true,
        credentialConfigured: true,
        modelConfigured: true,
        initializationStatus: 'CONNECTIVITY_VERIFIED',
        connectivityChecked: true,
        lastCheckedAt: this.connectivityState.lastCheckedAt,
        capabilitiesPendingVerification: false,
        statusMessage: `Gemini SDK initialized and connectivity verified for model "${publicConfig.modelId}".`,
      };
    }

    if (this.connectivityState.checked && !this.connectivityState.verified) {
      return {
        providerId: GEMINI_PROVIDER_ID,
        providerName: GEMINI_PROVIDER_NAME,
        kind: 'vision_analysis',
        modelId: publicConfig.modelId,
        credentialEnvVar: GEMINI_API_KEY_ENV_VAR,
        modelEnvVar: publicConfig.modelEnvVar,
        enabled: true,
        credentialConfigured: true,
        modelConfigured: true,
        initializationStatus: 'ERROR',
        connectivityChecked: true,
        lastCheckedAt: this.connectivityState.lastCheckedAt,
        capabilitiesPendingVerification: true,
        statusMessage:
          this.connectivityState.statusMessage ??
          'Gemini connectivity verification failed.',
        errorCategory:
          this.connectivityState.errorCategory ?? 'UNKNOWN_PROVIDER_ERROR',
      };
    }

    return {
      providerId: GEMINI_PROVIDER_ID,
      providerName: GEMINI_PROVIDER_NAME,
      kind: 'vision_analysis',
      modelId: publicConfig.modelId,
      credentialEnvVar: GEMINI_API_KEY_ENV_VAR,
      modelEnvVar: publicConfig.modelEnvVar,
      enabled: true,
      credentialConfigured: true,
      modelConfigured: true,
      initializationStatus: 'INITIALIZED',
      connectivityChecked: false,
      lastCheckedAt: null,
      capabilitiesPendingVerification: true,
      statusMessage: `Gemini SDK initialized for model "${publicConfig.modelId}". Live connectivity has not been verified yet.`,
    };
  }

  /**
   * Executes an explicit lightweight authenticated metadata request (models.get)
   * without sending images or running generative inference.
   */
  async verifyConnectivity(options?: {
    readonly timeoutMs?: number;
  }): Promise<GeminiConnectivityCheckResult> {
    const env = this.getEnv();
    const publicConfig = resolveGeminiPublicConfiguration(env);
    const credential = resolveGeminiServerCredential(env);
    this.syncFingerprint(credential, publicConfig.modelId);

    if (!publicConfig.credentialConfigured) {
      const mapped = mapGeminiProviderError(
        new GeminiConfigurationError(
          publicConfig.errorCategory ?? 'MISSING_CREDENTIAL',
          publicConfig.configurationMessage,
        ),
      );
      return {
        status: this.buildUnconnectedStatus(publicConfig, 'NOT_CONFIGURED'),
        mappedError: mapped,
      };
    }

    if (!publicConfig.modelConfigured || !publicConfig.modelId) {
      const mapped = mapGeminiProviderError(
        new GeminiConfigurationError(
          publicConfig.errorCategory ?? 'INVALID_MODEL_CONFIGURATION',
          publicConfig.configurationMessage,
        ),
        credential ? [credential] : [],
      );
      return {
        status: this.buildUnconnectedStatus(publicConfig, 'NOT_CONFIGURED'),
        mappedError: mapped,
      };
    }

    const clientResult = this.ensureClientInitialized(
      credential,
      publicConfig.modelId,
    );
    if (!clientResult.ok) {
      return {
        status: this.getStatus(),
        mappedError: clientResult.mappedError,
      };
    }

    const timeoutMs =
      options?.timeoutMs ?? this.defaultConnectivityTimeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(new Error(`Connectivity check timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    try {
      await clientResult.client.models.get({
        model: publicConfig.modelId,
        config: {
          abortSignal: controller.signal,
          httpOptions: { headers: { ...GEMINI_TELEMETRY_HEADERS } },
        },
      });

      this.connectivityState = {
        checked: true,
        verified: true,
        lastCheckedAt: new Date().toISOString(),
      };

      return {
        status: this.getStatus(),
      };
    } catch (error: unknown) {
      const mapped = mapGeminiProviderError(
        error,
        credential ? [credential] : [],
      );
      const detailSuffix = mapped.diagnosticDetail
        ? ` | detail: ${mapped.diagnosticDetail}`
        : '';
      console.error(
        '[FormFusion Gemini Provider]',
        sanitizeDiagnosticMessage(
          `Connectivity check failed (${mapped.category}, status=${mapped.upstreamStatus ?? 'n/a'}): ${mapped.message}${detailSuffix}`,
          credential ? [credential] : [],
        ),
      );

      this.connectivityState = {
        checked: true,
        verified: false,
        lastCheckedAt: new Date().toISOString(),
        errorCategory: mapped.category,
        statusMessage: mapped.message,
      };

      return {
        status: this.getStatus(),
        mappedError: mapped,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private syncFingerprint(
    credential: string | null,
    modelId: string | null,
  ): void {
    const nextFingerprint = fingerprintConfig(credential, modelId);
    if (this.cachedFingerprint !== nextFingerprint) {
      this.cachedFingerprint = nextFingerprint;
      this.cachedClient = null;
      this.cachedInitError = null;
      this.connectivityState = {
        checked: false,
        verified: false,
        lastCheckedAt: null,
      };
    }
  }

  private ensureClientInitialized(
    credential: string | null,
    modelId: string | null,
  ):
    | { readonly ok: true; readonly client: GeminiSdkClient }
    | { readonly ok: false; readonly mappedError: MappedGeminiProviderError } {
    if (!credential) {
      const mapped = mapGeminiProviderError(
        new GeminiConfigurationError(
          'MISSING_CREDENTIAL',
          'GEMINI_API_KEY is not configured in the server runtime environment.',
        ),
      );
      return { ok: false, mappedError: mapped };
    }
    if (!modelId) {
      const mapped = mapGeminiProviderError(
        new GeminiConfigurationError(
          'INVALID_MODEL_CONFIGURATION',
          'GEMINI_MODEL_ID is missing or invalid.',
        ),
        [credential],
      );
      return { ok: false, mappedError: mapped };
    }

    if (this.cachedClient) {
      return { ok: true, client: this.cachedClient };
    }
    if (this.cachedInitError) {
      return { ok: false, mappedError: this.cachedInitError };
    }

    try {
      const client = this.createSdkClient(credential);
      if (
        !client ||
        typeof client !== 'object' ||
        !client.models ||
        typeof client.models.get !== 'function'
      ) {
        throw new GeminiSdkInitializationError(
          'Gemini SDK client did not expose the expected models API.',
        );
      }
      this.cachedClient = client;
      return { ok: true, client };
    } catch (error: unknown) {
      const wrapped =
        error instanceof GeminiSdkInitializationError
          ? error
          : new GeminiSdkInitializationError(
              sanitizeDiagnosticMessage(
                error instanceof Error ? error.message : String(error),
                [credential],
              ) || 'Failed to instantiate Gemini SDK client.',
            );
      const mapped = mapGeminiProviderError(wrapped, [credential]);
      console.error(
        '[FormFusion Gemini Provider]',
        sanitizeDiagnosticMessage(
          `SDK initialization failure: ${mapped.message}`,
          [credential],
        ),
      );
      this.cachedInitError = mapped;
      return { ok: false, mappedError: mapped };
    }
  }

  private buildUnconnectedStatus(
    publicConfig: GeminiPublicConfiguration,
    readyState: 'CONFIGURED' | 'NOT_CONFIGURED',
  ): GeminiProviderPublicStatus {
    if (!publicConfig.credentialConfigured && !publicConfig.modelConfigured) {
      return {
        providerId: GEMINI_PROVIDER_ID,
        providerName: GEMINI_PROVIDER_NAME,
        kind: 'vision_analysis',
        modelId: null,
        credentialEnvVar: GEMINI_API_KEY_ENV_VAR,
        modelEnvVar: publicConfig.modelEnvVar,
        enabled: false,
        credentialConfigured: false,
        modelConfigured: false,
        initializationStatus: 'ERROR',
        connectivityChecked: false,
        lastCheckedAt: null,
        capabilitiesPendingVerification: true,
        statusMessage: publicConfig.configurationMessage,
        setupInstruction: publicConfig.setupInstruction,
        errorCategory: publicConfig.errorCategory ?? 'INVALID_CONFIGURATION',
      };
    }

    if (!publicConfig.credentialConfigured) {
      return {
        providerId: GEMINI_PROVIDER_ID,
        providerName: GEMINI_PROVIDER_NAME,
        kind: 'vision_analysis',
        modelId: publicConfig.modelId,
        credentialEnvVar: GEMINI_API_KEY_ENV_VAR,
        modelEnvVar: publicConfig.modelEnvVar,
        enabled: false,
        credentialConfigured: false,
        modelConfigured: publicConfig.modelConfigured,
        initializationStatus: 'NOT_CONFIGURED',
        connectivityChecked: false,
        lastCheckedAt: null,
        capabilitiesPendingVerification: true,
        statusMessage: publicConfig.configurationMessage,
        setupInstruction: publicConfig.setupInstruction,
        errorCategory: 'MISSING_CREDENTIAL',
      };
    }

    if (!publicConfig.modelConfigured) {
      return {
        providerId: GEMINI_PROVIDER_ID,
        providerName: GEMINI_PROVIDER_NAME,
        kind: 'vision_analysis',
        modelId: null,
        credentialEnvVar: GEMINI_API_KEY_ENV_VAR,
        modelEnvVar: publicConfig.modelEnvVar,
        enabled: false,
        credentialConfigured: true,
        modelConfigured: false,
        initializationStatus: 'ERROR',
        connectivityChecked: false,
        lastCheckedAt: null,
        capabilitiesPendingVerification: true,
        statusMessage: publicConfig.configurationMessage,
        setupInstruction: publicConfig.setupInstruction,
        errorCategory:
          publicConfig.errorCategory ?? 'INVALID_MODEL_CONFIGURATION',
      };
    }

      return {
        providerId: GEMINI_PROVIDER_ID,
        providerName: GEMINI_PROVIDER_NAME,
        kind: 'vision_analysis',
        modelId: publicConfig.modelId,
        credentialEnvVar: GEMINI_API_KEY_ENV_VAR,
        modelEnvVar: publicConfig.modelEnvVar,
        enabled: true,
        credentialConfigured: true,
        modelConfigured: true,
        initializationStatus: readyState === 'CONFIGURED' ? 'CONFIGURED' : 'INITIALIZED',
        connectivityChecked: false,
        lastCheckedAt: null,
        capabilitiesPendingVerification: true,
        statusMessage: publicConfig.configurationMessage,
      };
  }
}

function extractGenuineTokenUsage(
  rawUsage: GeminiGenerateContentResponseLike['usageMetadata'],
): VisionAnalysisTokenUsage | undefined {
  if (!rawUsage || typeof rawUsage !== 'object') {
    return undefined;
  }

  const promptTokenCount =
    typeof rawUsage.promptTokenCount === 'number' &&
    Number.isFinite(rawUsage.promptTokenCount)
      ? rawUsage.promptTokenCount
      : undefined;
  const candidatesTokenCount =
    typeof rawUsage.candidatesTokenCount === 'number' &&
    Number.isFinite(rawUsage.candidatesTokenCount)
      ? rawUsage.candidatesTokenCount
      : undefined;
  const thoughtsTokenCount =
    typeof rawUsage.thoughtsTokenCount === 'number' &&
    Number.isFinite(rawUsage.thoughtsTokenCount)
      ? rawUsage.thoughtsTokenCount
      : undefined;
  const totalTokenCount =
    typeof rawUsage.totalTokenCount === 'number' &&
    Number.isFinite(rawUsage.totalTokenCount)
      ? rawUsage.totalTokenCount
      : undefined;

  if (
    promptTokenCount === undefined &&
    candidatesTokenCount === undefined &&
    thoughtsTokenCount === undefined &&
    totalTokenCount === undefined
  ) {
    return undefined;
  }

  return {
    ...(promptTokenCount !== undefined ? { promptTokenCount } : {}),
    ...(candidatesTokenCount !== undefined ? { candidatesTokenCount } : {}),
    ...(thoughtsTokenCount !== undefined ? { thoughtsTokenCount } : {}),
    ...(totalTokenCount !== undefined ? { totalTokenCount } : {}),
  };
}

export function createGeminiVisionProvider(
  options?: GeminiVisionProviderOptions,
): GeminiVisionProvider {
  return new GeminiVisionProvider(options);
}

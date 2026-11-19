import { errResult, okResult } from '../../types/common.ts';
import type { EntityId, ServiceResult } from '../../types/common.ts';
import type {
  AspectRatio,
  GeneratedArtwork,
  GenerationJob,
  GenerationKind,
  PromptDocument,
  SupportedSourceMimeType,
} from '../../types/domain.ts';
import type {
  ImageGenerationProviderCapabilities,
  ImageGenerationProviderErrorCategory,
  ImageGenerationProviderPublicStatus,
  NormalizedImageGenerationUsageMetadata,
  RegisteredImageGenerationProviderSummary,
} from '../../types/providers.ts';
import { createEntityId, isValidEntityId, nowIsoTimestamp } from '../../utils/ids.ts';
import { findCredentialLeakKey, isNonEmptyString } from '../../utils/validation.ts';
import { ALLOWED_ASPECT_RATIOS, findForbiddenImageInput } from './contract.ts';
import { normalizeGenerationRequest } from './generationNormalizer.ts';

export type ImageGenerationWorkflowState =
  | 'idle'
  | 'validating'
  | 'confirming'
  | 'generating'
  | 'completed'
  | 'failed'
  | 'rate_limited'
  | 'uncertain'
  | 'cancelled';

export interface TextOnlyGenerationExecutePayload {
  readonly projectId: EntityId;
  readonly promptId: EntityId;
  readonly providerId: string;
  readonly approvalStatus: 'approved';
  readonly approvedPrompt: string;
  readonly negativePrompt?: string;
  readonly modelId: string;
  readonly aspectRatio: string;
  readonly outputWidth: number;
  readonly outputHeight: number;
  readonly numberOfImages: 1;
  readonly providerParameters: Record<string, never>;
  readonly allowAnonymousFreeTier?: boolean;
  readonly confirmed: true;
}

export interface ImageGenerationExecuteApiSuccessData {
  readonly generationId: EntityId;
  readonly providerId: string;
  readonly modelId: string;
  readonly status: 'succeeded';
  readonly outputFormat?: 'png' | 'jpeg' | 'webp';
  readonly mimeType?: SupportedSourceMimeType;
  readonly outputDimensions?: {
    readonly width: number;
    readonly height: number;
  };
  readonly temporaryImageDataUrl?: string;
  readonly createdAt: string;
  readonly durationMs: number;
  readonly usageMetadata?: NormalizedImageGenerationUsageMetadata;
}

export interface ImageGenerationExecuteApiResponse {
  readonly ok: boolean;
  readonly data?: ImageGenerationExecuteApiSuccessData;
  readonly error?: {
    readonly code?: string;
    readonly category?: ImageGenerationProviderErrorCategory;
    readonly message?: string;
    readonly retryable?: boolean;
    readonly upstreamStatus?: number;
  };
  readonly normalizationWarnings?: readonly string[];
}

export interface ImageGenerationExecuteTransportParams {
  readonly endpoint: string;
  readonly payload: TextOnlyGenerationExecutePayload;
  readonly abortSignal?: AbortSignal;
  readonly timeoutMs?: number;
}

export type ImageGenerationExecuteTransport = (
  params: ImageGenerationExecuteTransportParams,
) => Promise<{
  readonly status: number;
  readonly body: ImageGenerationExecuteApiResponse;
}>;

export interface GenerationReadinessCheck {
  readonly ready: boolean;
  readonly reasonCode?:
    | 'PROMPT_NOT_APPROVED'
    | 'PROVIDER_UNAVAILABLE'
    | 'PROVIDER_NOT_CONFIGURED'
    | 'PROMPT_TOO_LONG'
    | 'IN_FLIGHT';
  readonly message?: string;
}

export interface GenerationLineageMetadataInput {
  readonly generationKind?: GenerationKind;
  readonly parentGenerationId?: EntityId | null;
  readonly parentPromptId?: EntityId | null;
  readonly variationId?: EntityId | null;
  readonly variationPromptId?: EntityId | null;
  readonly variationInstructions?: string | null;
  readonly variationLabel?: string | null;
  readonly includeNegativePrompt?: boolean;
  readonly negativePromptUsed?: string;
}

export interface ImageGenerationClientOutcome {
  readonly outcomeState: Extract<
    ImageGenerationWorkflowState,
    'completed' | 'failed' | 'rate_limited' | 'uncertain' | 'cancelled'
  >;
  readonly job: GenerationJob | null;
  readonly artwork?: GeneratedArtwork;
  readonly imageBlob?: Blob;
  readonly durationMs?: number;
  readonly accessMode?: 'authenticated' | 'anonymous_free_tier';
  readonly errorMessage?: string;
  readonly errorCode?: string;
  readonly retryAfterSeconds?: number;
  readonly normalizationWarnings?: readonly string[];
}

const DEFAULT_GENERATION_CLIENT_TIMEOUT_MS = 105_000;

export function getFreeTierAccessLabel(
  status: ImageGenerationProviderPublicStatus | null | undefined,
  allowAnonymousFreeTier: boolean,
): string {
  if (!status) {
    return 'Unavailable';
  }
  if (status.tokenConfigured) {
    return 'Free Tier (Authenticated Server Token)';
  }
  if (status.anonymousFreeTierEnabled || allowAnonymousFreeTier) {
    return 'Free Tier (Anonymous · 2 RPM Limit)';
  }
  return 'Free Tier (Token or Explicit Opt-In Required)';
}

export function isProviderReadyWithSelection(
  providerSummary: RegisteredImageGenerationProviderSummary | null | undefined,
  allowAnonymousFreeTier: boolean,
): boolean {
  if (!providerSummary) {
    return false;
  }
  const { status, capabilities } = providerSummary;
  if (
    status.connectionStatus === 'unavailable' ||
    status.errorCategory === 'UNAVAILABLE' ||
    status.errorCategory === 'INVALID_CONFIGURATION' ||
    status.errorCategory === 'INVALID_MODEL_CONFIGURATION'
  ) {
    return false;
  }
  if (status.enabled && (status.tokenConfigured || status.anonymousFreeTierEnabled)) {
    return true;
  }
  if (
    !status.tokenConfigured &&
    !status.anonymousFreeTierEnabled &&
    capabilities.isFreeTierModel &&
    capabilities.supportsAnonymousFreeTier &&
    allowAnonymousFreeTier
  ) {
    return true;
  }
  return false;
}

export function validateGenerationReadiness(params: {
  readonly projectId: EntityId;
  readonly promptDocument: PromptDocument | null;
  readonly providerSummary: RegisteredImageGenerationProviderSummary | null;
  readonly allowAnonymousFreeTier: boolean;
  readonly isGenerating: boolean;
  readonly hasUnsavedPromptDraft?: boolean;
}): GenerationReadinessCheck {
  if (params.isGenerating) {
    return {
      ready: false,
      reasonCode: 'IN_FLIGHT',
      message: 'A generation request is already in progress. Wait for completion before submitting another request.',
    };
  }

  if (
    !params.promptDocument ||
    params.promptDocument.approvalStatus !== 'approved' ||
    !isNonEmptyString(params.promptDocument.finalPrompt) ||
    params.hasUnsavedPromptDraft
  ) {
    return {
      ready: false,
      reasonCode: 'PROMPT_NOT_APPROVED',
      message: 'Approve your Final Master Prompt before generating artwork.',
    };
  }

  if (!isValidEntityId(params.projectId) || params.promptDocument.projectId !== params.projectId) {
    return {
      ready: false,
      reasonCode: 'PROMPT_NOT_APPROVED',
      message: 'Approved prompt does not match the active study project.',
    };
  }

  if (!params.providerSummary) {
    return {
      ready: false,
      reasonCode: 'PROVIDER_UNAVAILABLE',
      message: 'No registered image generation provider is currently available.',
    };
  }

  const { status, capabilities } = params.providerSummary;

  if (
    capabilities.maxPromptLength > 0 &&
    params.promptDocument.finalPrompt.trim().length > capabilities.maxPromptLength
  ) {
    return {
      ready: false,
      reasonCode: 'PROMPT_TOO_LONG',
      message: `Approved Final Master Prompt exceeds ${capabilities.providerName}'s ${capabilities.maxPromptLength}-character limit (${params.promptDocument.finalPrompt.trim().length} characters).`,
    };
  }

  if (
    status.connectionStatus === 'unavailable' ||
    status.errorCategory === 'UNAVAILABLE' ||
    status.errorCategory === 'INVALID_CONFIGURATION' ||
    status.errorCategory === 'INVALID_MODEL_CONFIGURATION'
  ) {
    return {
      ready: false,
      reasonCode: 'PROVIDER_UNAVAILABLE',
      message: status.statusMessage,
    };
  }

  if (!isProviderReadyWithSelection(params.providerSummary, params.allowAnonymousFreeTier)) {
    return {
      ready: false,
      reasonCode: 'PROVIDER_NOT_CONFIGURED',
      message: status.statusMessage,
    };
  }

  return { ready: true };
}

export function resolveSupportedOutputSpec(
  capabilities: ImageGenerationProviderCapabilities,
): {
  readonly width: number;
  readonly height: number;
  readonly aspectRatio: AspectRatio;
  readonly label: string;
} {
  const primary = capabilities.supportedOutputSizes[0];
  const width = primary?.width ?? 1024;
  const height = primary?.height ?? 1024;
  const rawAspect = primary?.aspectRatio ?? '1:1';
  const aspectRatio: AspectRatio = (ALLOWED_ASPECT_RATIOS as readonly string[]).includes(
    rawAspect,
  )
    ? (rawAspect as AspectRatio)
    : '1:1';
  const label = primary?.label ?? `${width} × ${height}`;
  return { width, height, aspectRatio, label };
}

export function buildTextOnlyExecutePayload(params: {
  readonly projectId: EntityId;
  readonly promptDocument: PromptDocument;
  readonly providerSummary: RegisteredImageGenerationProviderSummary;
  readonly includeNegativePrompt: boolean;
  readonly allowAnonymousFreeTier: boolean;
}): ServiceResult<TextOnlyGenerationExecutePayload> {
  if (params.promptDocument.approvalStatus !== 'approved') {
    return errResult(
      'VALIDATION_ERROR',
      'Approve your Final Master Prompt before generating artwork.',
    );
  }

  if (!isNonEmptyString(params.promptDocument.finalPrompt)) {
    return errResult(
      'VALIDATION_ERROR',
      'Final Master Prompt text cannot be empty.',
    );
  }

  const { capabilities, status } = params.providerSummary;
  const outputSpec = resolveSupportedOutputSpec(capabilities);
  const trimmedNegative = params.promptDocument.negativePrompt.trim();
  const shouldIncludeNegative =
    capabilities.supportsNegativePrompt &&
    params.includeNegativePrompt &&
    trimmedNegative.length > 0;

  const shouldForwardAnonymous =
    !status.tokenConfigured &&
    !status.anonymousFreeTierEnabled &&
    capabilities.supportsAnonymousFreeTier &&
    params.allowAnonymousFreeTier;

  const payload: TextOnlyGenerationExecutePayload = {
    projectId: params.projectId,
    promptId: params.promptDocument.id,
    providerId: capabilities.providerId,
    approvalStatus: 'approved',
    approvedPrompt: params.promptDocument.finalPrompt.trim(),
    ...(shouldIncludeNegative ? { negativePrompt: trimmedNegative } : {}),
    modelId: capabilities.modelId,
    aspectRatio: outputSpec.aspectRatio,
    outputWidth: outputSpec.width,
    outputHeight: outputSpec.height,
    numberOfImages: 1,
    providerParameters: {},
    ...(shouldForwardAnonymous ? { allowAnonymousFreeTier: true } : {}),
    confirmed: true,
  };

  const leakKey = findCredentialLeakKey(payload, 'generationPayload');
  if (leakKey !== null) {
    return errResult(
      'SECURITY_BOUNDARY_VIOLATION',
      `Credential-like field "${leakKey}" is prohibited in generation requests.`,
      { field: leakKey },
    );
  }

  const forbiddenImage = findForbiddenImageInput(payload, 'generationPayload');
  if (forbiddenImage !== null) {
    return errResult(
      'SECURITY_BOUNDARY_VIOLATION',
      `${forbiddenImage.reason} Source images cannot be sent to text-to-image generation.`,
      { path: forbiddenImage.path },
    );
  }

  const normalizedCheck = normalizeGenerationRequest(payload, capabilities);
  if (!normalizedCheck.ok) {
    return normalizedCheck;
  }

  return okResult(payload);
}

function decodeBase64ToBytes(base64Data: string): Uint8Array | null {
  try {
    if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
      const buf = Buffer.from(base64Data, 'base64');
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    }
    if (typeof atob === 'function') {
      const binary = atob(base64Data);
      const out = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        out[i] = binary.charCodeAt(i);
      }
      return out;
    }
    return null;
  } catch {
    return null;
  }
}

function matchesBinaryImageMagic(
  bytes: Uint8Array,
  mimeType: SupportedSourceMimeType,
): boolean {
  if (bytes.byteLength < 12) {
    return false;
  }
  if (mimeType === 'image/png') {
    return (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  }
  if (mimeType === 'image/jpeg') {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  // image/webp: RIFF....WEBP
  return (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  );
}

export function decodeDataUrlToValidatedImageBlob(
  dataUrl: string,
): ServiceResult<{
  readonly blob: Blob;
  readonly mimeType: SupportedSourceMimeType;
  readonly byteSize: number;
}> {
  if (typeof dataUrl !== 'string' || dataUrl.trim().length === 0) {
    return errResult(
      'PROVIDER_ERROR',
      'Generation response did not contain an image payload.',
    );
  }

  const match = /^\s*data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)\s*$/i.exec(
    dataUrl,
  );
  if (!match) {
    return errResult(
      'PROVIDER_ERROR',
      'Returned generation image format is unsupported or malformed.',
    );
  }

  const mimeType = match[1].toLowerCase() as SupportedSourceMimeType;
  const bytes = decodeBase64ToBytes(match[2]);
  if (!bytes || bytes.byteLength === 0) {
    return errResult(
      'PROVIDER_ERROR',
      'Returned generation image payload could not be decoded cleanly.',
    );
  }

  if (!matchesBinaryImageMagic(bytes, mimeType)) {
    return errResult(
      'PROVIDER_ERROR',
      `Returned binary header does not match declared ${mimeType} image signature.`,
    );
  }

  const bufferCopy = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const blob = new Blob([bufferCopy], { type: mimeType });

  return okResult({
    blob,
    mimeType,
    byteSize: bytes.byteLength,
  });
}

export async function defaultImageGenerationExecuteTransport(
  params: ImageGenerationExecuteTransportParams,
): Promise<{
  readonly status: number;
  readonly body: ImageGenerationExecuteApiResponse;
}> {
  const timeoutMs = params.timeoutMs ?? DEFAULT_GENERATION_CLIENT_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;

  const onExternalAbort = () => {
    controller.abort(params.abortSignal?.reason ?? new Error('Generation cancelled.'));
  };

  if (params.abortSignal) {
    if (params.abortSignal.aborted) {
      throw new DOMException('Image generation aborted before dispatch.', 'AbortError');
    }
    params.abortSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error(`Generation request timed out after ${timeoutMs}ms.`));
  }, timeoutMs);

  try {
    const response = await fetch(params.endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params.payload),
      signal: controller.signal,
    });

    const text = await response.text();
    let parsed: ImageGenerationExecuteApiResponse = { ok: false };
    try {
      parsed = JSON.parse(text || '{}') as ImageGenerationExecuteApiResponse;
    } catch {
      parsed = {
        ok: false,
        error: {
          code: 'PROVIDER_ERROR',
          category: 'INVALID_RESPONSE',
          message: 'Server returned an unreadable image generation response.',
          retryable: false,
        },
      };
    }

    return {
      status: response.status,
      body: parsed,
    };
  } catch (error) {
    if (timedOut) {
      const timeoutErr = new Error(
        'The image generation request timed out waiting for the provider response.',
      );
      timeoutErr.name = 'TimeoutError';
      throw timeoutErr;
    }
    throw error;
  } finally {
    clearTimeout(timer);
    if (params.abortSignal) {
      params.abortSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}

export function buildFailedGenerationJobRecord(params: {
  readonly generationId?: EntityId;
  readonly projectId: EntityId;
  readonly promptDocumentId: EntityId;
  readonly capabilities: ImageGenerationProviderCapabilities;
  readonly errorCode: string;
  readonly errorMessage: string;
  readonly queuedAt: string;
  readonly startedAt: string;
  readonly lineage?: GenerationLineageMetadataInput;
}): GenerationJob {
  const completedAt = nowIsoTimestamp();
  const outputSpec = resolveSupportedOutputSpec(params.capabilities);
  const jobId =
    params.generationId && isValidEntityId(params.generationId)
      ? params.generationId
      : createEntityId('job');

  return {
    id: jobId,
    projectId: params.projectId,
    promptDocumentId: params.promptDocumentId,
    providerConfigRef: {
      providerId: params.capabilities.providerId,
      modelId: params.capabilities.modelId,
    },
    aspectRatio: outputSpec.aspectRatio,
    resolution: {
      width: outputSpec.width,
      height: outputSpec.height,
      label: 'standard',
    },
    modelParameters: {},
    status: 'failed',
    artworkIds: [],
    errorCode: params.errorCode,
    errorMessage: params.errorMessage,
    queuedAt: params.queuedAt,
    startedAt: params.startedAt,
    completedAt,
    generationKind: params.lineage?.generationKind ?? 'original',
    parentGenerationId: params.lineage?.parentGenerationId ?? null,
    parentPromptId: params.lineage?.parentPromptId ?? null,
    variationId: params.lineage?.variationId ?? null,
    variationPromptId: params.lineage?.variationPromptId ?? null,
    variationInstructions: params.lineage?.variationInstructions ?? null,
    variationLabel: params.lineage?.variationLabel ?? null,
    ...(params.lineage?.includeNegativePrompt !== undefined
      ? { includeNegativePrompt: params.lineage.includeNegativePrompt }
      : {}),
    ...(params.lineage?.negativePromptUsed !== undefined
      ? { negativePromptUsed: params.lineage.negativePromptUsed }
      : {}),
    createdAt: params.queuedAt,
    updatedAt: completedAt,
  };
}

export async function executeTextToImageGeneration(params: {
  readonly projectId: EntityId;
  readonly promptDocument: PromptDocument;
  readonly providerSummary: RegisteredImageGenerationProviderSummary;
  readonly includeNegativePrompt: boolean;
  readonly allowAnonymousFreeTier: boolean;
  readonly lineage?: GenerationLineageMetadataInput;
  readonly abortSignal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly transport?: ImageGenerationExecuteTransport;
}): Promise<ImageGenerationClientOutcome> {
  const queuedAt = nowIsoTimestamp();
  const { capabilities } = params.providerSummary;
  const outputSpec = resolveSupportedOutputSpec(capabilities);
  const effectiveNegativePromptUsed =
    capabilities.supportsNegativePrompt &&
    params.includeNegativePrompt &&
    params.promptDocument.negativePrompt.trim().length > 0
      ? params.promptDocument.negativePrompt.trim()
      : '';
  const resolvedLineage: GenerationLineageMetadataInput = {
    generationKind: params.lineage?.generationKind ?? 'original',
    parentGenerationId: params.lineage?.parentGenerationId ?? null,
    parentPromptId: params.lineage?.parentPromptId ?? null,
    variationId: params.lineage?.variationId ?? null,
    variationPromptId: params.lineage?.variationPromptId ?? null,
    variationInstructions: params.lineage?.variationInstructions ?? null,
    variationLabel: params.lineage?.variationLabel ?? null,
    includeNegativePrompt:
      params.lineage?.includeNegativePrompt ?? Boolean(effectiveNegativePromptUsed),
    negativePromptUsed:
      params.lineage?.negativePromptUsed ?? effectiveNegativePromptUsed,
  };

  if (params.abortSignal?.aborted) {
    return {
      outcomeState: 'cancelled',
      job: null,
      errorCode: 'CANCELLED',
      errorMessage: 'Generation was cancelled before sending a request to the provider.',
    };
  }

  const payloadResult = buildTextOnlyExecutePayload({
    projectId: params.projectId,
    promptDocument: params.promptDocument,
    providerSummary: params.providerSummary,
    includeNegativePrompt: params.includeNegativePrompt,
    allowAnonymousFreeTier: params.allowAnonymousFreeTier,
  });

  if (!payloadResult.ok) {
    const failedJob = buildFailedGenerationJobRecord({
      projectId: params.projectId,
      promptDocumentId: params.promptDocument.id,
      capabilities,
      errorCode: payloadResult.error.code,
      errorMessage: payloadResult.error.message,
      queuedAt,
      startedAt: queuedAt,
      lineage: resolvedLineage,
    });
    return {
      outcomeState: 'failed',
      job: failedJob,
      errorCode: payloadResult.error.code,
      errorMessage: payloadResult.error.message,
    };
  }

  const startedAt = nowIsoTimestamp();
  const transport = params.transport ?? defaultImageGenerationExecuteTransport;

  try {
    const response = await transport({
      endpoint: '/api/image-generation/execute',
      payload: payloadResult.data,
      abortSignal: params.abortSignal,
      timeoutMs: params.timeoutMs,
    });

    if (response.status === 200 && response.body.ok && response.body.data) {
      const data = response.body.data;
      const decodedResult = decodeDataUrlToValidatedImageBlob(
        data.temporaryImageDataUrl ?? '',
      );

      if (!decodedResult.ok) {
        const failedJob = buildFailedGenerationJobRecord({
          generationId: data.generationId,
          projectId: params.projectId,
          promptDocumentId: params.promptDocument.id,
          capabilities,
          errorCode: 'INVALID_RESPONSE',
          errorMessage: decodedResult.error.message,
          queuedAt,
          startedAt,
          lineage: resolvedLineage,
        });
        return {
          outcomeState: 'failed',
          job: failedJob,
          errorCode: 'INVALID_RESPONSE',
          errorMessage: decodedResult.error.message,
        };
      }

      const completedAt = data.createdAt || nowIsoTimestamp();
      const jobId = isValidEntityId(data.generationId)
        ? data.generationId
        : createEntityId('job');
      const artworkId = createEntityId('art');
      const blobKey = createEntityId('blb');
      const finalWidth = data.outputDimensions?.width ?? outputSpec.width;
      const finalHeight = data.outputDimensions?.height ?? outputSpec.height;

      const job: GenerationJob = {
        id: jobId,
        projectId: params.projectId,
        promptDocumentId: params.promptDocument.id,
        providerConfigRef: {
          providerId: data.providerId || capabilities.providerId,
          modelId: data.modelId || capabilities.modelId,
        },
        aspectRatio: outputSpec.aspectRatio,
        resolution: {
          width: finalWidth,
          height: finalHeight,
          label: 'standard',
        },
        modelParameters: {},
        status: 'completed',
        artworkIds: [artworkId],
        errorCode: null,
        errorMessage: null,
        queuedAt,
        startedAt,
        completedAt,
        generationKind: resolvedLineage.generationKind ?? 'original',
        parentGenerationId: resolvedLineage.parentGenerationId ?? null,
        parentPromptId: resolvedLineage.parentPromptId ?? null,
        variationId: resolvedLineage.variationId ?? null,
        variationPromptId: resolvedLineage.variationPromptId ?? null,
        variationInstructions: resolvedLineage.variationInstructions ?? null,
        variationLabel: resolvedLineage.variationLabel ?? null,
        includeNegativePrompt: resolvedLineage.includeNegativePrompt,
        negativePromptUsed: resolvedLineage.negativePromptUsed,
        createdAt: queuedAt,
        updatedAt: completedAt,
      };

      const artwork: GeneratedArtwork = {
        id: artworkId,
        projectId: params.projectId,
        generationJobId: jobId,
        promptDocumentId: params.promptDocument.id,
        mimeType: decodedResult.data.mimeType,
        width: finalWidth,
        height: finalHeight,
        localBlobKey: blobKey,
        fileSizeBytes: decodedResult.data.byteSize,
        providerModelId: data.modelId || capabilities.modelId,
        generationKind: resolvedLineage.generationKind ?? 'original',
        parentGenerationId: resolvedLineage.parentGenerationId ?? null,
        variationId: resolvedLineage.variationId ?? null,
        variationLabel: resolvedLineage.variationLabel ?? null,
        createdAt: completedAt,
        updatedAt: completedAt,
      };

      return {
        outcomeState: 'completed',
        job,
        artwork,
        imageBlob: decodedResult.data.blob,
        durationMs: data.durationMs,
        accessMode: data.usageMetadata?.accessMode,
        normalizationWarnings: response.body.normalizationWarnings,
      };
    }

    const errCategory = response.body.error?.category;
    const errCode =
      response.body.error?.code ??
      (response.status === 429 ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_ERROR');
    const errMessage =
      response.body.error?.message ??
      `Image generation failed with HTTP ${response.status}.`;

    if (response.status === 429 || errCategory === 'RATE_LIMITED') {
      const rateLimitedJob = buildFailedGenerationJobRecord({
        projectId: params.projectId,
        promptDocumentId: params.promptDocument.id,
        capabilities,
        errorCode: 'RATE_LIMITED',
        errorMessage: errMessage,
        queuedAt,
        startedAt,
        lineage: resolvedLineage,
      });
      return {
        outcomeState: 'rate_limited',
        job: rateLimitedJob,
        errorCode: 'RATE_LIMITED',
        errorMessage: errMessage,
      };
    }

    if (response.status === 504 || errCategory === 'NETWORK_TIMEOUT') {
      const uncertainMessage =
        'Generation timed out after the request may have reached the external provider. Automatic retries are disabled to avoid duplicate free-tier requests.';
      const uncertainJob = buildFailedGenerationJobRecord({
        projectId: params.projectId,
        promptDocumentId: params.promptDocument.id,
        capabilities,
        errorCode: 'UNCERTAIN_TIMEOUT',
        errorMessage: uncertainMessage,
        queuedAt,
        startedAt,
        lineage: resolvedLineage,
      });
      return {
        outcomeState: 'uncertain',
        job: uncertainJob,
        errorCode: 'UNCERTAIN_TIMEOUT',
        errorMessage: uncertainMessage,
      };
    }

    if (errCategory === 'CANCELLED') {
      return {
        outcomeState: 'cancelled',
        job: null,
        errorCode: 'CANCELLED',
        errorMessage: errMessage,
      };
    }

    const failedJob = buildFailedGenerationJobRecord({
      projectId: params.projectId,
      promptDocumentId: params.promptDocument.id,
      capabilities,
      errorCode: errCode,
      errorMessage: errMessage,
      queuedAt,
      startedAt,
      lineage: resolvedLineage,
    });
    return {
      outcomeState: 'failed',
      job: failedJob,
      errorCode: errCode,
      errorMessage: errMessage,
    };
  } catch (error) {
    // Request was already dispatched to /api/image-generation/execute.
    // Timeout or network interruption after dispatch is treated as uncertain (never silently retried).
    const isTimeoutOrAbort =
      error instanceof Error &&
      (error.name === 'TimeoutError' ||
        error.name === 'AbortError' ||
        /timeout|aborted|network/i.test(error.message));

    if (isTimeoutOrAbort) {
      const uncertainMessage =
        'Connection timed out or dropped after submitting the generation request. The external provider may still have processed the prompt; automatic retries are disabled.';
      const uncertainJob = buildFailedGenerationJobRecord({
        projectId: params.projectId,
        promptDocumentId: params.promptDocument.id,
        capabilities,
        errorCode: 'UNCERTAIN_TIMEOUT',
        errorMessage: uncertainMessage,
        queuedAt,
        startedAt,
        lineage: resolvedLineage,
      });
      return {
        outcomeState: 'uncertain',
        job: uncertainJob,
        errorCode: 'UNCERTAIN_TIMEOUT',
        errorMessage: uncertainMessage,
      };
    }

    const message =
      error instanceof Error && error.message.trim().length > 0
        ? error.message
        : 'Unable to reach FormFusion image generation server.';
    const failedJob = buildFailedGenerationJobRecord({
      projectId: params.projectId,
      promptDocumentId: params.promptDocument.id,
      capabilities,
      errorCode: 'PROVIDER_UNAVAILABLE',
      errorMessage: message,
      queuedAt,
      startedAt,
      lineage: resolvedLineage,
    });
    return {
      outcomeState: 'failed',
      job: failedJob,
      errorCode: 'PROVIDER_UNAVAILABLE',
      errorMessage: message,
    };
  }
}

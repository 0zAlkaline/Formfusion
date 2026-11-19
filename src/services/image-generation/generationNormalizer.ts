import { errResult, okResult } from '../../types/common.ts';
import type { ServiceResult } from '../../types/common.ts';
import type { GenerationModelParameters, PromptDocument } from '../../types/domain.ts';
import type {
  ImageGenerationProviderCapabilities,
  NormalizedImageGenerationNormalizationReport,
  NormalizedImageGenerationRequest,
} from '../../types/providers.ts';
import { isValidEntityId } from '../../utils/ids.ts';
import {
  findCredentialLeakKey,
  isNonEmptyString,
  isPlainRecord,
} from '../../utils/validation.ts';
import { findForbiddenImageInput } from './contract.ts';

export const ALLOWED_NORMALIZED_GENERATION_KEYS: ReadonlySet<string> = new Set([
  'projectId',
  'promptId',
  'providerId',
  'approvalStatus',
  'approvedPrompt',
  'negativePrompt',
  'modelId',
  'aspectRatio',
  'outputWidth',
  'outputHeight',
  'numberOfImages',
  'providerParameters',
  'allowAnonymousFreeTier',
  'confirmed',
  'isSmokeTest',
]);

/**
 * Validates and normalizes an incoming text-to-image generation request
 * against a target provider's declared capabilities.
 *
 * Security invariants:
 * - Source images, base64 image URIs, binary buffers, and sourceAsset references are rejected.
 * - Credentials / API keys / tokens are rejected.
 * - Prompts without explicit approvalStatus === 'approved' are rejected.
 * - Unsupported provider parameters (e.g. seed, guidanceScale, inferenceSteps, custom dimensions)
 *   are cleanly omitted and reported rather than sent upstream.
 */
export function normalizeGenerationRequest(
  input: unknown,
  capabilities: ImageGenerationProviderCapabilities,
): ServiceResult<NormalizedImageGenerationNormalizationReport> {
  if (!isPlainRecord(input)) {
    return errResult(
      'VALIDATION_ERROR',
      'Normalized image generation request must be a plain JSON object.',
    );
  }

  const credentialKey = findCredentialLeakKey(input, 'request');
  if (credentialKey !== null) {
    return errResult(
      'SECURITY_BOUNDARY_VIOLATION',
      `Client generation requests must not include credential field "${credentialKey}".`,
      { field: credentialKey },
    );
  }

  const forbiddenImage = findForbiddenImageInput(input, 'request');
  if (forbiddenImage !== null) {
    return errResult(
      'SECURITY_BOUNDARY_VIOLATION',
      `${forbiddenImage.reason} Image generation must operate strictly on approved text prompts.`,
      { path: forbiddenImage.path },
    );
  }

  for (const key of Object.keys(input)) {
    if (!ALLOWED_NORMALIZED_GENERATION_KEYS.has(key)) {
      return errResult(
        'VALIDATION_ERROR',
        `Unexpected field "${key}" on normalized image generation request.`,
        { field: key },
      );
    }
  }

  if (!isValidEntityId(input.projectId)) {
    return errResult(
      'VALIDATION_ERROR',
      'projectId must be a valid entity identifier.',
    );
  }

  if (!isValidEntityId(input.promptId)) {
    return errResult(
      'VALIDATION_ERROR',
      'promptId must be a valid entity identifier.',
    );
  }

  if (input.providerId !== undefined) {
    if (!isNonEmptyString(input.providerId)) {
      return errResult(
        'VALIDATION_ERROR',
        'providerId must be a non-empty string when provided.',
      );
    }
    if (input.providerId.trim() !== capabilities.providerId) {
      return errResult(
        'VALIDATION_ERROR',
        `Requested provider "${input.providerId.trim()}" does not match selected provider "${capabilities.providerId}". Automatic provider switching is disabled.`,
        {
          requestedProviderId: input.providerId.trim(),
          activeProviderId: capabilities.providerId,
        },
      );
    }
  }

  if (
    input.allowAnonymousFreeTier !== undefined &&
    typeof input.allowAnonymousFreeTier !== 'boolean'
  ) {
    return errResult(
      'VALIDATION_ERROR',
      'allowAnonymousFreeTier must be a boolean when provided.',
    );
  }

  if (input.confirmed !== undefined && input.confirmed !== true) {
    return errResult(
      'VALIDATION_ERROR',
      'Image generation requires explicit user confirmation before dispatch.',
    );
  }

  if (input.approvalStatus !== 'approved') {
    return errResult(
      'VALIDATION_ERROR',
      'Image generation requires an explicitly approved prompt (approvalStatus === "approved").',
      {
        approvalStatus:
          typeof input.approvalStatus === 'string'
            ? input.approvalStatus
            : 'missing',
      },
    );
  }

  if (!isNonEmptyString(input.approvedPrompt)) {
    return errResult(
      'VALIDATION_ERROR',
      'approvedPrompt must be a non-empty prompt string.',
    );
  }

  const trimmedPrompt = input.approvedPrompt.trim();
  if (
    capabilities.maxPromptLength > 0 &&
    trimmedPrompt.length > capabilities.maxPromptLength
  ) {
    return errResult(
      'VALIDATION_ERROR',
      `approvedPrompt exceeds provider maximum length of ${capabilities.maxPromptLength} characters.`,
      {
        maxPromptLength: capabilities.maxPromptLength,
        actualLength: trimmedPrompt.length,
      },
    );
  }

  if (
    input.negativePrompt !== undefined &&
    typeof input.negativePrompt !== 'string'
  ) {
    return errResult(
      'VALIDATION_ERROR',
      'negativePrompt must be a string when provided.',
    );
  }

  const requestedModelId = isNonEmptyString(input.modelId)
    ? input.modelId.trim()
    : capabilities.modelId;

  if (requestedModelId !== capabilities.modelId) {
    return errResult(
      'VALIDATION_ERROR',
      `Requested model "${requestedModelId}" does not match active provider model "${capabilities.modelId}". Automatic model switching is disabled.`,
      {
        requestedModelId,
        activeModelId: capabilities.modelId,
      },
    );
  }

  const omittedParameters: string[] = [];
  const warnings: string[] = [];

  const trimmedNegative =
    typeof input.negativePrompt === 'string' && input.negativePrompt.trim().length > 0
      ? input.negativePrompt.trim()
      : undefined;

  let resolvedNegativePrompt: string | undefined = trimmedNegative;
  if (trimmedNegative && !capabilities.supportsNegativePrompt) {
    omittedParameters.push('negativePrompt');
    resolvedNegativePrompt = undefined;
    warnings.push(
      `${capabilities.providerName} (${capabilities.modelId}) does not support negative prompts; negativePrompt was omitted.`,
    );
  }

  const defaultOutput = capabilities.supportedOutputSizes[0] ?? {
    width: 1024,
    height: 1024,
    aspectRatio: '1:1',
    label: '1024 × 1024',
  };

  const requestedAspectRatio = isNonEmptyString(input.aspectRatio)
    ? input.aspectRatio.trim()
    : defaultOutput.aspectRatio;
  const requestedWidth =
    typeof input.outputWidth === 'number' && Number.isInteger(input.outputWidth)
      ? input.outputWidth
      : defaultOutput.width;
  const requestedHeight =
    typeof input.outputHeight === 'number' && Number.isInteger(input.outputHeight)
      ? input.outputHeight
      : defaultOutput.height;

  const matchedSize = capabilities.supportedOutputSizes.find(
    (size) =>
      size.width === requestedWidth &&
      size.height === requestedHeight &&
      size.aspectRatio === requestedAspectRatio,
  );

  let outputWidth = requestedWidth;
  let outputHeight = requestedHeight;
  let aspectRatio = requestedAspectRatio;

  if (!matchedSize) {
    if (
      input.outputWidth !== undefined &&
      input.outputWidth !== defaultOutput.width
    ) {
      omittedParameters.push('outputWidth');
    }
    if (
      input.outputHeight !== undefined &&
      input.outputHeight !== defaultOutput.height
    ) {
      omittedParameters.push('outputHeight');
    }
    if (
      input.aspectRatio !== undefined &&
      input.aspectRatio !== defaultOutput.aspectRatio
    ) {
      omittedParameters.push('aspectRatio');
    }

    outputWidth = defaultOutput.width;
    outputHeight = defaultOutput.height;
    aspectRatio = defaultOutput.aspectRatio;

    if (
      input.outputWidth !== undefined ||
      input.outputHeight !== undefined ||
      input.aspectRatio !== undefined
    ) {
      warnings.push(
        `Model "${capabilities.modelId}" produces fixed ${defaultOutput.width} × ${defaultOutput.height} (${defaultOutput.aspectRatio}) output; requested dimensions were normalized to ${defaultOutput.width} × ${defaultOutput.height}.`,
      );
    }
  }

  const rawCount = input.numberOfImages ?? 1;
  if (
    typeof rawCount !== 'number' ||
    !Number.isInteger(rawCount) ||
    rawCount < 1
  ) {
    return errResult(
      'VALIDATION_ERROR',
      'numberOfImages must be a positive integer.',
    );
  }

  let numberOfImages = rawCount;
  if (rawCount > capabilities.maxNumberOfImages) {
    numberOfImages = capabilities.maxNumberOfImages;
    omittedParameters.push('numberOfImages');
    warnings.push(
      `Model "${capabilities.modelId}" supports up to ${capabilities.maxNumberOfImages} image per request; requested count (${rawCount}) was clamped to ${capabilities.maxNumberOfImages}.`,
    );
  }

  const rawParams =
    input.providerParameters === undefined ? {} : input.providerParameters;
  if (!isPlainRecord(rawParams)) {
    return errResult(
      'VALIDATION_ERROR',
      'providerParameters must be a plain object when provided.',
    );
  }

  const normalizedParams: {
    guidanceScale?: number;
    inferenceSteps?: number;
    seed?: number;
    safetyFilterLevel?: 'strict' | 'balanced';
  } = {};

  if (rawParams.guidanceScale !== undefined) {
    if (
      typeof rawParams.guidanceScale !== 'number' ||
      !Number.isFinite(rawParams.guidanceScale)
    ) {
      return errResult(
        'VALIDATION_ERROR',
        'providerParameters.guidanceScale must be a finite number.',
      );
    }
    if (capabilities.supportsGuidanceScale) {
      normalizedParams.guidanceScale = rawParams.guidanceScale;
    } else {
      omittedParameters.push('guidanceScale');
    }
  }

  if (rawParams.inferenceSteps !== undefined) {
    if (
      typeof rawParams.inferenceSteps !== 'number' ||
      !Number.isInteger(rawParams.inferenceSteps) ||
      rawParams.inferenceSteps < 1
    ) {
      return errResult(
        'VALIDATION_ERROR',
        'providerParameters.inferenceSteps must be a positive integer.',
      );
    }
    if (capabilities.supportsInferenceSteps) {
      normalizedParams.inferenceSteps = rawParams.inferenceSteps;
    } else {
      omittedParameters.push('inferenceSteps');
    }
  }

  if (rawParams.seed !== undefined) {
    if (
      typeof rawParams.seed !== 'number' ||
      !Number.isInteger(rawParams.seed) ||
      rawParams.seed < 0
    ) {
      return errResult(
        'VALIDATION_ERROR',
        'providerParameters.seed must be a non-negative integer.',
      );
    }
    if (capabilities.supportsSeed) {
      normalizedParams.seed = rawParams.seed;
    } else {
      omittedParameters.push('seed');
    }
  }

  if (rawParams.safetyFilterLevel !== undefined) {
    if (
      rawParams.safetyFilterLevel !== 'strict' &&
      rawParams.safetyFilterLevel !== 'balanced'
    ) {
      return errResult(
        'VALIDATION_ERROR',
        'providerParameters.safetyFilterLevel must be "strict" or "balanced".',
      );
    }
    omittedParameters.push('safetyFilterLevel');
  }

  if (
    input.isSmokeTest !== undefined &&
    typeof input.isSmokeTest !== 'boolean'
  ) {
    return errResult(
      'VALIDATION_ERROR',
      'isSmokeTest must be a boolean when provided.',
    );
  }

  const normalizedRequest: NormalizedImageGenerationRequest = {
    projectId: input.projectId.trim(),
    promptId: input.promptId.trim(),
    providerId: capabilities.providerId,
    approvalStatus: 'approved',
    approvedPrompt: trimmedPrompt,
    ...(resolvedNegativePrompt ? { negativePrompt: resolvedNegativePrompt } : {}),
    modelId: capabilities.modelId,
    aspectRatio,
    outputWidth,
    outputHeight,
    numberOfImages,
    providerParameters: normalizedParams,
    ...(input.isSmokeTest === true ? { isSmokeTest: true } : {}),
  };

  return okResult({
    normalizedRequest,
    omittedParameters,
    warnings,
  });
}

/**
 * Helper to construct a NormalizedImageGenerationRequest from an approved PromptDocument.
 */
export function buildNormalizedRequestFromPromptDocument(params: {
  readonly promptDocument: PromptDocument;
  readonly capabilities: ImageGenerationProviderCapabilities;
  readonly aspectRatio?: string;
  readonly outputWidth?: number;
  readonly outputHeight?: number;
  readonly numberOfImages?: number;
  readonly providerParameters?: GenerationModelParameters;
}): ServiceResult<NormalizedImageGenerationNormalizationReport> {
  return normalizeGenerationRequest(
    {
      projectId: params.promptDocument.projectId,
      promptId: params.promptDocument.id,
      approvalStatus: params.promptDocument.approvalStatus,
      approvedPrompt: params.promptDocument.finalPrompt,
      ...(params.promptDocument.negativePrompt.trim().length > 0
        ? { negativePrompt: params.promptDocument.negativePrompt.trim() }
        : {}),
      modelId: params.capabilities.modelId,
      ...(params.aspectRatio ? { aspectRatio: params.aspectRatio } : {}),
      ...(params.outputWidth !== undefined
        ? { outputWidth: params.outputWidth }
        : {}),
      ...(params.outputHeight !== undefined
        ? { outputHeight: params.outputHeight }
        : {}),
      ...(params.numberOfImages !== undefined
        ? { numberOfImages: params.numberOfImages }
        : {}),
      ...(params.providerParameters
        ? { providerParameters: params.providerParameters }
        : {}),
    },
    params.capabilities,
  );
}

import { errResult, okResult } from '../../types/common.ts';
import type { ServiceResult } from '../../types/common.ts';
import type {
  AspectRatio,
  GenerationModelParameters,
  ImageResolution,
  PromptDocument,
} from '../../types/domain.ts';
import type { ProviderConfigRef } from '../../types/providers.ts';
import type {
  ForbiddenImageInputKey,
  ImageGenerationResult,
  ImageGenerationService,
  StrictTextToImageRequest,
  TextToImageGenerationRequest,
} from '../../types/services.ts';
import {
  isNonEmptyString,
  isPlainRecord,
  validateProviderConfigRef,
} from '../../utils/validation.ts';

export const ALLOWED_ASPECT_RATIOS: readonly AspectRatio[] = [
  '1:1',
  '4:3',
  '3:4',
  '16:9',
  '9:16',
  '3:2',
  '2:3',
] as const;

export const ALLOWED_IMAGE_GENERATION_KEYS: ReadonlySet<string> = new Set([
  'finalApprovedPrompt',
  'negativePrompt',
  'aspectRatio',
  'resolution',
  'modelParameters',
  'providerConfigRef',
]);

export const FORBIDDEN_IMAGE_INPUT_KEYS: readonly ForbiddenImageInputKey[] = [
  'sourceImage',
  'source_image',
  'imageFile',
  'image_file',
  'base64Image',
  'base64_image',
  'sourceImageUrl',
  'source_image_url',
  'imageAttachment',
  'image_attachment',
  'uploadedImageReference',
  'uploaded_image_reference',
  'sourceAsset',
  'sourceAssetId',
  'source_asset_id',
  'referenceImage',
  'reference_image',
  'initImage',
  'init_image',
  'maskImage',
  'mask_image',
  'imageData',
  'imageUrl',
  'imageBase64',
  'image',
  'file',
  'files',
  'attachment',
  'attachments',
] as const;

const FORBIDDEN_KEY_SET: ReadonlySet<string> = new Set(
  FORBIDDEN_IMAGE_INPUT_KEYS.map((key) =>
    key.toLowerCase().replace(/[\s_-]/g, ''),
  ),
);

function isBinaryOrImageContainer(value: unknown): boolean {
  if (typeof Uint8Array !== 'undefined' && value instanceof Uint8Array) {
    return true;
  }
  if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) {
    return true;
  }
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    return true;
  }
  if (typeof File !== 'undefined' && value instanceof File) {
    return true;
  }
  return false;
}

function isImageDataUri(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    /^\s*data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(value)
  );
}

/**
 * Recursively inspects an unknown payload and rejects any source-image,
 * image-file, base64-image, image-URL, or attachment payloads.
 */
export function findForbiddenImageInput(
  payload: unknown,
  pathPrefix = '',
): { readonly reason: string; readonly path: string } | null {
  if (isBinaryOrImageContainer(payload)) {
    return {
      reason: 'Binary file or buffer objects are prohibited in Text-to-Image requests.',
      path: pathPrefix || '<root>',
    };
  }

  if (isImageDataUri(payload)) {
    return {
      reason: 'Base64 image data URIs are prohibited in Text-to-Image requests.',
      path: pathPrefix || '<root>',
    };
  }

  if (Array.isArray(payload)) {
    for (let i = 0; i < payload.length; i += 1) {
      const nested = findForbiddenImageInput(payload[i], `${pathPrefix}[${i}]`);
      if (nested !== null) {
        return nested;
      }
    }
    return null;
  }

  if (!isPlainRecord(payload)) {
    return null;
  }

  for (const [key, value] of Object.entries(payload)) {
    const normalized = key.toLowerCase().replace(/[\s_-]/g, '');
    const fullPath = pathPrefix ? `${pathPrefix}.${key}` : key;

    if (FORBIDDEN_KEY_SET.has(normalized)) {
      return {
        reason: `Forbidden source-image or image-attachment key "${key}" detected.`,
        path: fullPath,
      };
    }

    const nested = findForbiddenImageInput(value, fullPath);
    if (nested !== null) {
      return nested;
    }
  }

  return null;
}

function validateAspectRatio(value: unknown): ServiceResult<AspectRatio> {
  if (
    typeof value === 'string' &&
    (ALLOWED_ASPECT_RATIOS as readonly string[]).includes(value)
  ) {
    return okResult(value as AspectRatio);
  }
  return errResult(
    'VALIDATION_ERROR',
    `Unsupported aspectRatio. Expected one of: ${ALLOWED_ASPECT_RATIOS.join(', ')}.`,
  );
}

function validateImageResolution(value: unknown): ServiceResult<ImageResolution> {
  if (!isPlainRecord(value)) {
    return errResult('VALIDATION_ERROR', 'resolution must be an object.');
  }

  const allowedResolutionKeys = new Set(['width', 'height', 'label']);
  for (const key of Object.keys(value)) {
    if (!allowedResolutionKeys.has(key)) {
      return errResult(
        'VALIDATION_ERROR',
        `Unexpected field "${key}" in resolution.`,
      );
    }
  }

  const { width, height, label } = value;
  if (
    typeof width !== 'number' ||
    !Number.isInteger(width) ||
    width < 64 ||
    width > 8192
  ) {
    return errResult(
      'VALIDATION_ERROR',
      'resolution.width must be an integer between 64 and 8192.',
    );
  }
  if (
    typeof height !== 'number' ||
    !Number.isInteger(height) ||
    height < 64 ||
    height > 8192
  ) {
    return errResult(
      'VALIDATION_ERROR',
      'resolution.height must be an integer between 64 and 8192.',
    );
  }
  if (label !== 'standard' && label !== 'hd' && label !== 'uhd') {
    return errResult(
      'VALIDATION_ERROR',
      'resolution.label must be "standard", "hd", or "uhd".',
    );
  }

  return okResult({ width, height, label });
}

function validateModelParameters(
  value: unknown,
): ServiceResult<GenerationModelParameters> {
  if (!isPlainRecord(value)) {
    return errResult('VALIDATION_ERROR', 'modelParameters must be an object.');
  }

  const allowedParamKeys = new Set([
    'guidanceScale',
    'inferenceSteps',
    'seed',
    'safetyFilterLevel',
  ]);

  for (const key of Object.keys(value)) {
    if (!allowedParamKeys.has(key)) {
      return errResult(
        'VALIDATION_ERROR',
        `Unsupported model parameter "${key}".`,
      );
    }
  }

  if (
    value.guidanceScale !== undefined &&
    (typeof value.guidanceScale !== 'number' ||
      !Number.isFinite(value.guidanceScale) ||
      value.guidanceScale < 0 ||
      value.guidanceScale > 50)
  ) {
    return errResult(
      'VALIDATION_ERROR',
      'modelParameters.guidanceScale must be a finite number between 0 and 50.',
    );
  }

  if (
    value.inferenceSteps !== undefined &&
    (typeof value.inferenceSteps !== 'number' ||
      !Number.isInteger(value.inferenceSteps) ||
      value.inferenceSteps < 1 ||
      value.inferenceSteps > 200)
  ) {
    return errResult(
      'VALIDATION_ERROR',
      'modelParameters.inferenceSteps must be an integer between 1 and 200.',
    );
  }

  if (
    value.seed !== undefined &&
    (typeof value.seed !== 'number' ||
      !Number.isInteger(value.seed) ||
      value.seed < 0)
  ) {
    return errResult(
      'VALIDATION_ERROR',
      'modelParameters.seed must be a non-negative integer.',
    );
  }

  if (
    value.safetyFilterLevel !== undefined &&
    value.safetyFilterLevel !== 'strict' &&
    value.safetyFilterLevel !== 'balanced'
  ) {
    return errResult(
      'VALIDATION_ERROR',
      'modelParameters.safetyFilterLevel must be "strict" or "balanced".',
    );
  }

  return okResult({
    ...(typeof value.guidanceScale === 'number'
      ? { guidanceScale: value.guidanceScale }
      : {}),
    ...(typeof value.inferenceSteps === 'number'
      ? { inferenceSteps: value.inferenceSteps }
      : {}),
    ...(typeof value.seed === 'number' ? { seed: value.seed } : {}),
    ...(value.safetyFilterLevel === 'strict' ||
    value.safetyFilterLevel === 'balanced'
      ? { safetyFilterLevel: value.safetyFilterLevel }
      : {}),
  });
}

/**
 * Validates that an image generation request strictly contains only text-based
 * generation inputs and zero source-image, file, URL, or attachment fields.
 */
export function validateImageGenerationRequest(
  input: unknown,
): ServiceResult<TextToImageGenerationRequest> {
  if (!isPlainRecord(input)) {
    return errResult(
      'VALIDATION_ERROR',
      'Image generation request must be a plain JSON object.',
    );
  }

  const forbiddenHit = findForbiddenImageInput(input);
  if (forbiddenHit !== null) {
    return errResult(
      'SECURITY_BOUNDARY_VIOLATION',
      `${forbiddenHit.reason} Text-to-Image generation must remain independent of source-image inputs.`,
      { path: forbiddenHit.path },
    );
  }

  for (const key of Object.keys(input)) {
    if (!ALLOWED_IMAGE_GENERATION_KEYS.has(key)) {
      return errResult(
        'VALIDATION_ERROR',
        `Unexpected field "${key}" on TextToImageGenerationRequest.`,
        { field: key },
      );
    }
  }

  if (!isNonEmptyString(input.finalApprovedPrompt)) {
    return errResult(
      'VALIDATION_ERROR',
      'finalApprovedPrompt must be a non-empty string.',
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

  const aspectRatioResult = validateAspectRatio(input.aspectRatio);
  if (!aspectRatioResult.ok) {
    return aspectRatioResult;
  }

  const resolutionResult = validateImageResolution(input.resolution);
  if (!resolutionResult.ok) {
    return resolutionResult;
  }

  const modelParamsResult = validateModelParameters(input.modelParameters);
  if (!modelParamsResult.ok) {
    return modelParamsResult;
  }

  const providerRefResult = validateProviderConfigRef(input.providerConfigRef);
  if (!providerRefResult.ok) {
    return providerRefResult;
  }

  return okResult({
    finalApprovedPrompt: input.finalApprovedPrompt.trim(),
    ...(typeof input.negativePrompt === 'string' &&
    input.negativePrompt.trim().length > 0
      ? { negativePrompt: input.negativePrompt.trim() }
      : {}),
    aspectRatio: aspectRatioResult.data,
    resolution: resolutionResult.data,
    modelParameters: modelParamsResult.data,
    providerConfigRef: providerRefResult.data,
  });
}

export function buildApprovedTextGenerationRequest(params: {
  readonly promptDocument: PromptDocument;
  readonly aspectRatio: AspectRatio;
  readonly resolution: ImageResolution;
  readonly modelParameters: GenerationModelParameters;
  readonly providerConfigRef: ProviderConfigRef;
}): ServiceResult<TextToImageGenerationRequest> {
  if (params.promptDocument.approvalStatus !== 'approved') {
    return errResult(
      'VALIDATION_ERROR',
      'PromptDocument must have approvalStatus "approved" before image generation.',
      { approvalStatus: params.promptDocument.approvalStatus },
    );
  }

  return validateImageGenerationRequest({
    finalApprovedPrompt: params.promptDocument.finalPrompt,
    ...(params.promptDocument.negativePrompt.trim().length > 0
      ? { negativePrompt: params.promptDocument.negativePrompt }
      : {}),
    aspectRatio: params.aspectRatio,
    resolution: params.resolution,
    modelParameters: params.modelParameters,
    providerConfigRef: params.providerConfigRef,
  });
}

export class ImageGenerationServiceFoundation
  implements ImageGenerationService
{
  async generateArtwork<TRequest extends TextToImageGenerationRequest>(
    request: StrictTextToImageRequest<TRequest>,
  ): Promise<ServiceResult<ImageGenerationResult>> {
    const validated = validateImageGenerationRequest(request);
    if (!validated.ok) {
      return validated;
    }

    return errResult(
      'NOT_IMPLEMENTED',
      'ImageGenerationService provider execution is deferred beyond Phase 01.1.',
    );
  }
}

export {
  buildNormalizedRequestFromPromptDocument,
  normalizeGenerationRequest,
} from './generationNormalizer.ts';

export type {
  ForbiddenImageInputKey,
  ImageGenerationResult,
  ImageGenerationService,
  StrictTextToImageRequest,
  TextToImageGenerationRequest,
};


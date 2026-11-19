import { errResult, okResult } from '../../src/types/common.ts';
import type { ServiceResult } from '../../src/types/common.ts';
import type {
  AspectRatio,
  PromptBackgroundTreatment,
  PromptDetailLevel,
  PromptOutputOrientation,
} from '../../src/types/domain.ts';
import type {
  PromptSynthesisProviderInput,
  ProviderConfigRef,
} from '../../src/types/providers.ts';
import type { TextToImageGenerationRequest } from '../../src/types/services.ts';
import {
  ALLOWED_ASPECT_RATIOS,
  findForbiddenImageInput,
  validateImageGenerationRequest,
} from '../../src/services/image-generation/contract.ts';
import { isValidEntityId } from '../../src/utils/ids.ts';
import {
  findCredentialLeakKey,
  isNonEmptyString,
  isPlainRecord,
  validateProviderConfigRef,
} from '../../src/utils/validation.ts';

export interface ServerVisionIdentificationPayload {
  readonly projectId: string;
  readonly sourceAssetId: string;
  readonly mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  readonly providerConfigRef: ProviderConfigRef;
}

const ALLOWED_DETAIL_LEVELS: ReadonlySet<PromptDetailLevel> = new Set([
  'minimal',
  'balanced',
  'high',
  'intricate',
]);

const ALLOWED_OUTPUT_ORIENTATIONS: ReadonlySet<PromptOutputOrientation> = new Set([
  'square',
  'portrait',
  'landscape',
]);

const ALLOWED_BACKGROUND_TREATMENTS: ReadonlySet<PromptBackgroundTreatment> =
  new Set([
    'preserve_clean',
    'neutral_studio',
    'editorial_backdrop',
    'minimal_gradient',
    'environmental_match',
  ]);

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function validateServerImageGenerationPayload(
  body: unknown,
): ServiceResult<TextToImageGenerationRequest> {
  const credentialKey = findCredentialLeakKey(body, 'request');
  if (credentialKey !== null) {
    return errResult(
      'SECURITY_BOUNDARY_VIOLATION',
      `Client requests must not include credential field "${credentialKey}".`,
      { field: credentialKey },
    );
  }
  return validateImageGenerationRequest(body);
}

export function validateServerPromptSynthesisPayload(
  body: unknown,
): ServiceResult<PromptSynthesisProviderInput> {
  if (!isPlainRecord(body)) {
    return errResult(
      'VALIDATION_ERROR',
      'Prompt synthesis request body must be a JSON object.',
    );
  }

  const credentialKey = findCredentialLeakKey(body, 'request');
  if (credentialKey !== null) {
    return errResult(
      'SECURITY_BOUNDARY_VIOLATION',
      `Client requests must not include credential field "${credentialKey}".`,
      { field: credentialKey },
    );
  }

  const forbiddenImage = findForbiddenImageInput(body, 'request');
  if (forbiddenImage !== null) {
    return errResult(
      'SECURITY_BOUNDARY_VIOLATION',
      `${forbiddenImage.reason} Prompt synthesis operates strictly on text descriptions and style rules without source image payloads.`,
      { path: forbiddenImage.path },
    );
  }

  if (!isValidEntityId(body.projectId)) {
    return errResult(
      'VALIDATION_ERROR',
      'A valid projectId is required for prompt synthesis.',
    );
  }

  if (!isPlainRecord(body.subject)) {
    return errResult(
      'VALIDATION_ERROR',
      'subject must be a structured object derived from Editable Object Description.',
    );
  }

  const subject = body.subject;
  if (!isValidEntityId(subject.descriptionId)) {
    return errResult(
      'VALIDATION_ERROR',
      'subject.descriptionId must reference a saved ObjectDescription record.',
    );
  }
  if (
    typeof subject.sourceDescriptionRevision !== 'number' ||
    !Number.isInteger(subject.sourceDescriptionRevision) ||
    subject.sourceDescriptionRevision < 1
  ) {
    return errResult(
      'VALIDATION_ERROR',
      'subject.sourceDescriptionRevision must be a positive integer.',
    );
  }
  if (
    !isNonEmptyString(subject.objectName) ||
    !isNonEmptyString(subject.objectCategory) ||
    !isNonEmptyString(subject.primaryDescription)
  ) {
    return errResult(
      'VALIDATION_ERROR',
      'Editable Object Description requires non-empty Object Name, Object Category, and Primary Description before synthesizing a prompt.',
    );
  }

  if (!isPlainRecord(body.creativeDirection)) {
    return errResult(
      'VALIDATION_ERROR',
      'creativeDirection configuration is required before synthesizing a prompt.',
    );
  }

  const direction = body.creativeDirection;
  const styleName = readTrimmedString(direction.styleName);
  const styleDescription = readTrimmedString(direction.styleDescription);
  const visualCharacteristics = readTrimmedString(direction.visualCharacteristics);
  const renderingRules =
    readTrimmedString(direction.renderingRules) ||
    readTrimmedString(direction.renderingTechnique);
  const lineworkRules = readTrimmedString(direction.lineworkRules);
  const colorRules = readTrimmedString(direction.colorRules);
  const textureRules = readTrimmedString(direction.textureRules);
  const shadingRules = readTrimmedString(direction.shadingRules);
  const compositionRules = readTrimmedString(direction.compositionRules);

  if (!styleName) {
    return errResult(
      'VALIDATION_ERROR',
      'Style Name is required in Creative Direction before prompt synthesis.',
    );
  }

  const hasAnyDirectionDetail = Boolean(
    styleDescription ||
      visualCharacteristics ||
      renderingRules ||
      lineworkRules ||
      colorRules ||
      textureRules ||
      shadingRules ||
      compositionRules,
  );
  if (!hasAnyDirectionDetail) {
    return errResult(
      'VALIDATION_ERROR',
      'Provide a Style Description or at least one visual/rendering rule in Creative Direction.',
    );
  }

  if (
    direction.styleId !== null &&
    direction.styleId !== undefined &&
    !isValidEntityId(direction.styleId)
  ) {
    return errResult(
      'VALIDATION_ERROR',
      'creativeDirection.styleId must be null or a valid style entity ID.',
    );
  }

  const directionDetailLevel =
    typeof direction.detailLevel === 'string' &&
    ALLOWED_DETAIL_LEVELS.has(direction.detailLevel as PromptDetailLevel)
      ? (direction.detailLevel as PromptDetailLevel)
      : 'balanced';

  if (!isPlainRecord(body.compositionPreferences)) {
    return errResult(
      'VALIDATION_ERROR',
      'compositionPreferences is required for prompt synthesis.',
    );
  }

  const prefs = body.compositionPreferences;
  if (
    typeof prefs.aspectRatio !== 'string' ||
    !(ALLOWED_ASPECT_RATIOS as readonly string[]).includes(prefs.aspectRatio)
  ) {
    return errResult(
      'VALIDATION_ERROR',
      `compositionPreferences.aspectRatio must be one of: ${ALLOWED_ASPECT_RATIOS.join(', ')}.`,
    );
  }

  const detailLevel =
    typeof prefs.detailLevel === 'string' &&
    ALLOWED_DETAIL_LEVELS.has(prefs.detailLevel as PromptDetailLevel)
      ? (prefs.detailLevel as PromptDetailLevel)
      : directionDetailLevel;

  const outputOrientation =
    typeof prefs.outputOrientation === 'string' &&
    ALLOWED_OUTPUT_ORIENTATIONS.has(
      prefs.outputOrientation as PromptOutputOrientation,
    )
      ? (prefs.outputOrientation as PromptOutputOrientation)
      : 'square';

  const backgroundTreatment =
    typeof prefs.backgroundTreatment === 'string' &&
    ALLOWED_BACKGROUND_TREATMENTS.has(
      prefs.backgroundTreatment as PromptBackgroundTreatment,
    )
      ? (prefs.backgroundTreatment as PromptBackgroundTreatment)
      : 'preserve_clean';

  return okResult({
    projectId: body.projectId,
    subject: {
      descriptionId: subject.descriptionId,
      sourceDescriptionRevision: subject.sourceDescriptionRevision,
      objectName: readTrimmedString(subject.objectName),
      objectCategory: readTrimmedString(subject.objectCategory),
      primaryDescription: readTrimmedString(subject.primaryDescription),
      shapeAndSilhouette: readTrimmedString(subject.shapeAndSilhouette),
      materials: readStringArray(subject.materials),
      dominantColors: readStringArray(subject.dominantColors),
      surfaceDetails: readTrimmedString(subject.surfaceDetails),
      distinctiveFeatures: readStringArray(subject.distinctiveFeatures),
      composition: readTrimmedString(subject.composition),
      viewingAngle: readTrimmedString(subject.viewingAngle),
      preservationPriorities: readStringArray(subject.preservationPriorities),
      uncertainAttributes: readStringArray(subject.uncertainAttributes),
      userNotes: readTrimmedString(subject.userNotes),
    },
    creativeDirection: {
      source:
        direction.source === 'curated' || direction.isManualCreativeDirection === false
          ? 'curated'
          : 'manual',
      styleId:
        typeof direction.styleId === 'string' ? direction.styleId : null,
      styleName,
      styleCategory: readTrimmedString(direction.styleCategory) || 'illustration',
      styleDescription,
      visualCharacteristics,
      renderingRules,
      ...(renderingRules ? { renderingTechnique: renderingRules } : {}),
      lineworkRules,
      colorRules,
      textureRules,
      shadingRules,
      compositionRules,
      detailLevel: directionDetailLevel,
      ...(readTrimmedString(direction.promptTemplate)
        ? { promptTemplate: readTrimmedString(direction.promptTemplate) }
        : {}),
      ...(readTrimmedString(direction.negativePromptTemplate)
        ? {
            negativePromptTemplate: readTrimmedString(
              direction.negativePromptTemplate,
            ),
          }
        : {}),
      isManualCreativeDirection: direction.isManualCreativeDirection !== false,
    },
    creativeInstructions: readTrimmedString(body.creativeInstructions),
    compositionPreferences: {
      aspectRatio: prefs.aspectRatio as AspectRatio,
      compositionDirection:
        readTrimmedString(prefs.compositionDirection) || 'Preserve source framing',
      backgroundTreatment,
      detailLevel,
      outputOrientation,
    },
    ...(Array.isArray(body.detectedInputConflicts)
      ? { detectedInputConflicts: readStringArray(body.detectedInputConflicts) }
      : {}),
  });
}

export function validateServerVisionIdentificationPayload(
  body: unknown,
): ServiceResult<ServerVisionIdentificationPayload> {
  if (!isPlainRecord(body)) {
    return errResult(
      'VALIDATION_ERROR',
      'Vision identification request body must be a JSON object.',
    );
  }

  const credentialKey = findCredentialLeakKey(body, 'request');
  if (credentialKey !== null) {
    return errResult(
      'SECURITY_BOUNDARY_VIOLATION',
      `Client requests must not include credential field "${credentialKey}".`,
      { field: credentialKey },
    );
  }

  if (!isNonEmptyString(body.projectId)) {
    return errResult('VALIDATION_ERROR', 'projectId must be a non-empty string.');
  }
  if (!isNonEmptyString(body.sourceAssetId)) {
    return errResult(
      'VALIDATION_ERROR',
      'sourceAssetId must be a non-empty string.',
    );
  }
  if (
    body.mimeType !== 'image/png' &&
    body.mimeType !== 'image/jpeg' &&
    body.mimeType !== 'image/webp'
  ) {
    return errResult(
      'VALIDATION_ERROR',
      'mimeType must be "image/png", "image/jpeg", or "image/webp".',
    );
  }

  const providerRefResult = validateProviderConfigRef(body.providerConfigRef);
  if (!providerRefResult.ok) {
    return providerRefResult;
  }

  return okResult({
    projectId: body.projectId.trim(),
    sourceAssetId: body.sourceAssetId.trim(),
    mimeType: body.mimeType,
    providerConfigRef: providerRefResult.data,
  });
}

export function validateGeminiVerifyPayload(
  body: unknown,
): ServiceResult<Record<string, never>> {
  if (body === undefined) {
    return okResult({});
  }
  if (!isPlainRecord(body)) {
    return errResult(
      'VALIDATION_ERROR',
      'Provider connectivity check payload must be an empty JSON object.',
    );
  }

  const credentialKey = findCredentialLeakKey(body, 'request');
  if (credentialKey !== null) {
    return errResult(
      'SECURITY_BOUNDARY_VIOLATION',
      `Client requests must not include credential field "${credentialKey}".`,
      { field: credentialKey },
    );
  }

  const keys = Object.keys(body);
  if (keys.length > 0) {
    return errResult(
      'VALIDATION_ERROR',
      `Unexpected field "${keys[0]}" in provider connectivity verification request. Server-configured provider settings are used automatically.`,
      { field: keys[0] },
    );
  }

  return okResult({});
}

export interface ValidatedImageGenerationHealthPayload {
  readonly allowAnonymousFreeTier?: boolean;
}

export function validateImageGenerationHealthCheckPayload(
  body: unknown,
): ServiceResult<ValidatedImageGenerationHealthPayload> {
  if (body === undefined) {
    return okResult({});
  }
  if (!isPlainRecord(body)) {
    return errResult(
      'VALIDATION_ERROR',
      'Image generation provider health check payload must be a plain JSON object.',
    );
  }

  const credentialKey = findCredentialLeakKey(body, 'request');
  if (credentialKey !== null) {
    return errResult(
      'SECURITY_BOUNDARY_VIOLATION',
      `Client requests must not include credential field "${credentialKey}".`,
      { field: credentialKey },
    );
  }

  const forbiddenImage = findForbiddenImageInput(body, 'request');
  if (forbiddenImage !== null) {
    return errResult(
      'SECURITY_BOUNDARY_VIOLATION',
      `${forbiddenImage.reason} Health checks must not contain image payloads.`,
      { path: forbiddenImage.path },
    );
  }

  const allowedKeys = new Set(['allowAnonymousFreeTier']);
  for (const key of Object.keys(body)) {
    if (!allowedKeys.has(key)) {
      return errResult(
        'VALIDATION_ERROR',
        `Unexpected field "${key}" in image generation provider health check payload.`,
        { field: key },
      );
    }
  }

  if (
    body.allowAnonymousFreeTier !== undefined &&
    typeof body.allowAnonymousFreeTier !== 'boolean'
  ) {
    return errResult(
      'VALIDATION_ERROR',
      'allowAnonymousFreeTier must be a boolean when provided.',
    );
  }

  return okResult({
    ...(typeof body.allowAnonymousFreeTier === 'boolean'
      ? { allowAnonymousFreeTier: body.allowAnonymousFreeTier }
      : {}),
  });
}

export interface ValidatedImageGenerationSmokeTestPayload {
  readonly confirmed: true;
  readonly prompt?: string;
  readonly allowAnonymousFreeTier?: boolean;
}

export function validateImageGenerationSmokeTestPayload(
  body: unknown,
): ServiceResult<ValidatedImageGenerationSmokeTestPayload> {
  if (!isPlainRecord(body)) {
    return errResult(
      'VALIDATION_ERROR',
      'Smoke test request body must be a JSON object.',
    );
  }

  const credentialKey = findCredentialLeakKey(body, 'request');
  if (credentialKey !== null) {
    return errResult(
      'SECURITY_BOUNDARY_VIOLATION',
      `Client requests must not include credential field "${credentialKey}".`,
      { field: credentialKey },
    );
  }

  const forbiddenImage = findForbiddenImageInput(body, 'request');
  if (forbiddenImage !== null) {
    return errResult(
      'SECURITY_BOUNDARY_VIOLATION',
      `${forbiddenImage.reason} Image generation smoke tests operate strictly on text prompts.`,
      { path: forbiddenImage.path },
    );
  }

  const allowedKeys = new Set(['confirmed', 'prompt', 'allowAnonymousFreeTier']);
  for (const key of Object.keys(body)) {
    if (!allowedKeys.has(key)) {
      return errResult(
        'VALIDATION_ERROR',
        `Unexpected field "${key}" in smoke test request.`,
        { field: key },
      );
    }
  }

  if (body.confirmed !== true) {
    return errResult(
      'VALIDATION_ERROR',
      'Explicit confirmation (confirmed: true) is required before running an image generation smoke test.',
    );
  }

  if (body.prompt !== undefined) {
    if (!isNonEmptyString(body.prompt)) {
      return errResult(
        'VALIDATION_ERROR',
        'prompt must be a non-empty string when provided for smoke testing.',
      );
    }
    if (body.prompt.trim().length > 500) {
      return errResult(
        'VALIDATION_ERROR',
        'Smoke test prompt must be concise (500 characters or fewer).',
      );
    }
  }

  if (
    body.allowAnonymousFreeTier !== undefined &&
    typeof body.allowAnonymousFreeTier !== 'boolean'
  ) {
    return errResult(
      'VALIDATION_ERROR',
      'allowAnonymousFreeTier must be a boolean when provided.',
    );
  }

  return okResult({
    confirmed: true,
    ...(typeof body.prompt === 'string' && body.prompt.trim().length > 0
      ? { prompt: body.prompt.trim() }
      : {}),
    ...(typeof body.allowAnonymousFreeTier === 'boolean'
      ? { allowAnonymousFreeTier: body.allowAnonymousFreeTier }
      : {}),
  });
}


import { errResult, okResult } from '../../src/types/common.ts';
import type { EntityId, ServiceResult } from '../../src/types/common.ts';
import type { SupportedSourceMimeType } from '../../src/types/domain.ts';
import {
  detectImageSignature,
  formatFileSize,
  formatSourceFormatLabel,
  isSupportedDeclaredMimeType,
  MAX_SOURCE_IMAGE_BYTES,
  MIN_SOURCE_IMAGE_BYTES,
} from '../../src/services/source-asset/imageValidation.ts';
import { isValidEntityId } from '../../src/utils/ids.ts';
import {
  findCredentialLeakKey,
  isNonEmptyString,
  isPlainRecord,
} from '../../src/utils/validation.ts';

/**
 * Gemini REST inlineData JSON encoding expands raw binary bytes by 4/3 (~33%).
 * Gemini enforces a 20 MB ceiling on total inline request payload size, so raw
 * inline images above 14.5 MB are rejected explicitly rather than silently altered.
 */
export const MAX_GEMINI_INLINE_IMAGE_BYTES = 14_500_000;

const ALLOWED_VISION_FORM_FIELDS = new Set([
  'projectId',
  'assetId',
  'mimeType',
]);

const URL_OVERRIDE_KEY_PATTERNS = [
  'url',
  'uri',
  'endpoint',
  'baseurl',
  'base_url',
  'href',
  'link',
] as const;

const MODEL_OVERRIDE_KEY_PATTERNS = [
  'model',
  'modelid',
  'model_id',
  'provider',
  'providerid',
  'provider_id',
  'providerconfig',
  'endpointprofile',
] as const;

export interface UploadedVisionBinaryFile {
  readonly fieldname?: string;
  readonly originalname?: string;
  readonly mimetype?: string;
  readonly size?: number;
  readonly buffer?: Buffer | Uint8Array;
}

export interface ValidatedVisionMultipartRequest {
  readonly projectId: EntityId;
  readonly assetId: EntityId;
  readonly mimeType: SupportedSourceMimeType;
  readonly fileSizeBytes: number;
  readonly imageBytes: Uint8Array;
}

function hasValidStructuralHeader(
  bytes: Uint8Array,
  mimeType: SupportedSourceMimeType,
): boolean {
  if (mimeType === 'image/png') {
    if (bytes.length < 24) {
      return false;
    }
    const width =
      ((bytes[16] ?? 0) << 24) |
      ((bytes[17] ?? 0) << 16) |
      ((bytes[18] ?? 0) << 8) |
      (bytes[19] ?? 0);
    const height =
      ((bytes[20] ?? 0) << 24) |
      ((bytes[21] ?? 0) << 16) |
      ((bytes[22] ?? 0) << 8) |
      (bytes[23] ?? 0);
    return width > 0 && height > 0;
  }

  if (mimeType === 'image/webp') {
    if (bytes.length < 20) {
      return false;
    }
    const chunkFourCc = String.fromCharCode(
      bytes[12] ?? 0,
      bytes[13] ?? 0,
      bytes[14] ?? 0,
      bytes[15] ?? 0,
    );
    return (
      chunkFourCc === 'VP8 ' ||
      chunkFourCc === 'VP8L' ||
      chunkFourCc === 'VP8X'
    );
  }

  if (mimeType === 'image/jpeg') {
    if (bytes.length < 16) {
      return false;
    }
    // Check that bytes[3] is a valid JPEG marker byte (0xE0..0xFE or 0xC0..0xDB)
    const marker = bytes[3] ?? 0;
    return marker >= 0xc0 && marker <= 0xfe;
  }

  return false;
}

export function validateVisionMultipartRequest(params: {
  readonly fields: unknown;
  readonly file: UploadedVisionBinaryFile | undefined;
}): ServiceResult<ValidatedVisionMultipartRequest> {
  if (!isPlainRecord(params.fields)) {
    return errResult(
      'VALIDATION_ERROR',
      'Vision analysis form fields must be provided as key-value fields.',
    );
  }

  const credentialKey = findCredentialLeakKey(params.fields, 'form');
  if (credentialKey !== null) {
    return errResult(
      'SECURITY_BOUNDARY_VIOLATION',
      `Client requests must not supply credential field "${credentialKey}".`,
      { field: credentialKey },
    );
  }

  for (const [key, value] of Object.entries(params.fields)) {
    const lower = key.toLowerCase().replace(/[\s-]/g, '');

    if (URL_OVERRIDE_KEY_PATTERNS.some((pattern) => lower.includes(pattern))) {
      return errResult(
        'VALIDATION_ERROR',
        `Arbitrary URL or endpoint field "${key}" is prohibited. Upload the validated local image binary directly.`,
        { field: key },
      );
    }

    if (MODEL_OVERRIDE_KEY_PATTERNS.some((pattern) => lower.includes(pattern))) {
      return errResult(
        'SECURITY_BOUNDARY_VIOLATION',
        `Client requests cannot override server provider or model configuration ("${key}").`,
        { field: key },
      );
    }

    if (!ALLOWED_VISION_FORM_FIELDS.has(key)) {
      return errResult(
        'VALIDATION_ERROR',
        `Unexpected field "${key}" in Vision analysis request.`,
        { field: key },
      );
    }

    if (
      typeof value === 'string' &&
      /^\s*(https?:\/\/|data:image\/)/i.test(value)
    ) {
      return errResult(
        'VALIDATION_ERROR',
        `URL or data-URI string values are not permitted in "${key}".`,
        { field: key },
      );
    }
  }

  const { projectId, assetId, mimeType: declaredFieldMime } = params.fields;

  if (!isNonEmptyString(projectId) || !isValidEntityId(projectId.trim())) {
    return errResult(
      'VALIDATION_ERROR',
      'A valid projectId (e.g., prj_...) is required for Vision analysis.',
    );
  }

  if (!isNonEmptyString(assetId) || !isValidEntityId(assetId.trim())) {
    return errResult(
      'VALIDATION_ERROR',
      'A valid assetId (e.g., src_...) is required for Vision analysis.',
    );
  }

  const file = params.file;
  if (!file || !file.buffer) {
    return errResult(
      'VALIDATION_ERROR',
      'No source image binary was received. Attach the original image file under the "image" field.',
    );
  }

  const bytes =
    file.buffer instanceof Uint8Array
      ? file.buffer
      : new Uint8Array(file.buffer);
  const byteLength = bytes.byteLength;

  if (byteLength === 0) {
    return errResult(
      'VALIDATION_ERROR',
      'The uploaded source image binary is empty (0 bytes).',
    );
  }

  if (byteLength < MIN_SOURCE_IMAGE_BYTES) {
    return errResult(
      'VALIDATION_ERROR',
      'Uploaded image payload is too small or corrupted to be a valid image.',
    );
  }

  if (byteLength > MAX_SOURCE_IMAGE_BYTES) {
    return errResult(
      'VALIDATION_ERROR',
      `Uploaded image exceeds the 20 MB maximum size (${formatFileSize(byteLength)}).`,
    );
  }

  if (byteLength > MAX_GEMINI_INLINE_IMAGE_BYTES) {
    return errResult(
      'VALIDATION_ERROR',
      `Source image (${formatFileSize(byteLength)}) exceeds the Gemini inline Vision payload limit (${formatFileSize(MAX_GEMINI_INLINE_IMAGE_BYTES)} raw before encoding). Choose a smaller image rather than modifying the original asset.`,
      {
        maxInlineBytes: MAX_GEMINI_INLINE_IMAGE_BYTES,
        actualBytes: byteLength,
      },
    );
  }

  const normalizedPartMime =
    typeof file.mimetype === 'string' &&
    file.mimetype.trim().toLowerCase() !== 'application/octet-stream'
      ? file.mimetype.trim().toLowerCase()
      : '';

  if (
    normalizedPartMime !== '' &&
    !isSupportedDeclaredMimeType(normalizedPartMime)
  ) {
    return errResult(
      'VALIDATION_ERROR',
      `Unsupported image MIME type "${normalizedPartMime}". Supported formats are JPEG, PNG, and WebP.`,
    );
  }

  if (declaredFieldMime !== undefined) {
    if (
      typeof declaredFieldMime !== 'string' ||
      !isSupportedDeclaredMimeType(declaredFieldMime)
    ) {
      return errResult(
        'VALIDATION_ERROR',
        'Declared mimeType must be "image/jpeg", "image/png", or "image/webp".',
      );
    }
  }

  const detectedMimeType = detectImageSignature(bytes);
  if (detectedMimeType === null) {
    return errResult(
      'VALIDATION_ERROR',
      'Uploaded binary signature does not match a valid JPEG, PNG, or WebP image.',
    );
  }

  if (!hasValidStructuralHeader(bytes, detectedMimeType)) {
    return errResult(
      'VALIDATION_ERROR',
      `Uploaded ${formatSourceFormatLabel(detectedMimeType)} image appears truncated or malformed.`,
    );
  }

  if (normalizedPartMime !== '' && normalizedPartMime !== detectedMimeType) {
    return errResult(
      'VALIDATION_ERROR',
      `Uploaded file MIME type (${normalizedPartMime}) does not match detected binary signature (${detectedMimeType}).`,
    );
  }

  if (
    typeof declaredFieldMime === 'string' &&
    declaredFieldMime.trim().toLowerCase() !== detectedMimeType
  ) {
    return errResult(
      'VALIDATION_ERROR',
      `Form mimeType (${declaredFieldMime.trim().toLowerCase()}) does not match detected binary signature (${detectedMimeType}).`,
    );
  }

  return okResult({
    projectId: projectId.trim(),
    assetId: assetId.trim(),
    mimeType: detectedMimeType,
    fileSizeBytes: byteLength,
    imageBytes: bytes,
  });
}

import { errResult, okResult } from '../../types/common.ts';
import type { EntityId, ServiceResult } from '../../types/common.ts';
import type {
  SourceAsset,
  SourceAssetAspectRatio,
  SupportedSourceExtension,
  SupportedSourceMimeType,
} from '../../types/domain.ts';
import { createEntityId, nowIsoTimestamp } from '../../utils/ids.ts';

export const MAX_SOURCE_IMAGE_BYTES = 20 * 1024 * 1024;
export const MIN_SOURCE_IMAGE_BYTES = 16;
export const MIN_SOURCE_IMAGE_WIDTH = 256;
export const MIN_SOURCE_IMAGE_HEIGHT = 256;

export const SUPPORTED_SOURCE_MIME_TYPES: readonly SupportedSourceMimeType[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export const SUPPORTED_SOURCE_EXTENSIONS: readonly SupportedSourceExtension[] = [
  'jpg',
  'jpeg',
  'png',
  'webp',
] as const;

const EXTENSION_TO_MIME: Readonly<Record<SupportedSourceExtension, SupportedSourceMimeType>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

const MIME_TO_LABEL: Readonly<Record<SupportedSourceMimeType, string>> = {
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'image/webp': 'WebP',
};

const MIME_TO_DEFAULT_EXTENSION: Readonly<Record<SupportedSourceMimeType, SupportedSourceExtension>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export interface BinaryImageInspectionInput {
  readonly fileName: string;
  readonly declaredMimeType: string;
  readonly fileSizeBytes: number;
  readonly headerBytes: Uint8Array;
}

export interface BinaryImageInspectionResult {
  readonly detectedMimeType: SupportedSourceMimeType;
  readonly fileExtension: SupportedSourceExtension;
  readonly formatLabel: string;
}

export interface ValidatedDimensionsInput extends BinaryImageInspectionInput {
  readonly width: number;
  readonly height: number;
  readonly projectId: EntityId;
  readonly checksumSha256?: string;
}

export function extractFileExtension(fileName: string): string | null {
  const baseName = fileName.trim().split(/[/\\]/).pop() ?? '';
  const dotIndex = baseName.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === baseName.length - 1) {
    return null;
  }
  return baseName.slice(dotIndex + 1).toLowerCase();
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '0 B';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatSourceFormatLabel(mimeType: SupportedSourceMimeType): string {
  return MIME_TO_LABEL[mimeType];
}

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.trunc(a));
  let y = Math.abs(Math.trunc(b));
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

export function computeSourceAspectRatio(
  width: number,
  height: number,
): SourceAssetAspectRatio {
  const safeWidth = Math.max(1, Math.trunc(width));
  const safeHeight = Math.max(1, Math.trunc(height));
  const divisor = gcd(safeWidth, safeHeight);
  const widthRatio = Math.trunc(safeWidth / divisor);
  const heightRatio = Math.trunc(safeHeight / divisor);
  const numeric = Number((safeWidth / safeHeight).toFixed(4));
  const label =
    widthRatio <= 32 && heightRatio <= 32
      ? `${widthRatio}:${heightRatio}`
      : `${(safeWidth / safeHeight).toFixed(2)}:1`;

  return {
    widthRatio,
    heightRatio,
    label,
    numeric,
  };
}

/**
 * Inspects file magic bytes to detect JPEG, PNG, or WebP signatures.
 * Returns null if the binary header does not match any supported format.
 */
export function detectImageSignature(
  bytes: Uint8Array,
): SupportedSourceMimeType | null {
  if (bytes.length < MIN_SOURCE_IMAGE_BYTES) {
    return null;
  }

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A + IHDR chunk header at offset 12..15
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a &&
    bytes[12] === 0x49 &&
    bytes[13] === 0x48 &&
    bytes[14] === 0x44 &&
    bytes[15] === 0x52
  ) {
    return 'image/png';
  }

  // WebP: "RIFF" (52 49 46 46) .... "WEBP" (57 45 42 50)
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }

  return null;
}

export function isSupportedDeclaredMimeType(
  mimeType: string,
): mimeType is SupportedSourceMimeType {
  const normalized = mimeType.trim().toLowerCase();
  return (SUPPORTED_SOURCE_MIME_TYPES as readonly string[]).includes(normalized);
}

export function isSupportedFileExtension(
  extension: string | null,
): extension is SupportedSourceExtension {
  return (
    extension !== null &&
    (SUPPORTED_SOURCE_EXTENSIONS as readonly string[]).includes(extension)
  );
}

/**
 * Validates file size, declared MIME type, file extension, and magic-byte signature.
 * Intended to execute before browser image decoding.
 */
export function validateSourceImageBinary(
  input: BinaryImageInspectionInput,
): ServiceResult<BinaryImageInspectionResult> {
  if (!Number.isFinite(input.fileSizeBytes) || input.fileSizeBytes <= 0) {
    return errResult(
      'VALIDATION_ERROR',
      'The selected file is empty (0 bytes). Please choose a valid image file.',
    );
  }

  if (input.fileSizeBytes < MIN_SOURCE_IMAGE_BYTES) {
    return errResult(
      'VALIDATION_ERROR',
      'File is corrupted or invalid. The image file is too small to contain valid image data.',
    );
  }

  if (input.fileSizeBytes > MAX_SOURCE_IMAGE_BYTES) {
    return errResult(
      'VALIDATION_ERROR',
      `Image exceeds 20 MB maximum size (${formatFileSize(input.fileSizeBytes)}). Please choose a smaller file.`,
    );
  }

  const normalizedMime = input.declaredMimeType.trim().toLowerCase();
  if (normalizedMime !== '' && !isSupportedDeclaredMimeType(normalizedMime)) {
    return errResult(
      'VALIDATION_ERROR',
      'Unsupported image format. Supported formats are JPEG, PNG, and WebP.',
    );
  }

  const extension = extractFileExtension(input.fileName);
  if (extension !== null && !isSupportedFileExtension(extension)) {
    return errResult(
      'VALIDATION_ERROR',
      `Unsupported image format ".${extension}". Supported formats are JPEG, JPG, PNG, and WebP.`,
    );
  }

  const detectedMimeType = detectImageSignature(input.headerBytes);
  if (detectedMimeType === null) {
    if (normalizedMime !== '' || extension !== null) {
      return errResult(
        'VALIDATION_ERROR',
        'File signature does not match the image format. The file may be renamed, unsupported, or corrupted.',
      );
    }
    return errResult(
      'VALIDATION_ERROR',
      'Unsupported image format. Please upload a valid JPEG, PNG, or WebP image.',
    );
  }

  if (normalizedMime !== '' && normalizedMime !== detectedMimeType) {
    return errResult(
      'VALIDATION_ERROR',
      `File signature does not match the declared image format (${formatSourceFormatLabel(detectedMimeType)} data inside a ${normalizedMime} file).`,
    );
  }

  if (extension !== null && EXTENSION_TO_MIME[extension] !== detectedMimeType) {
    return errResult(
      'VALIDATION_ERROR',
      `File signature does not match the ".${extension}" file extension (${formatSourceFormatLabel(detectedMimeType)} content detected).`,
    );
  }

  const resolvedExtension: SupportedSourceExtension =
    extension ?? MIME_TO_DEFAULT_EXTENSION[detectedMimeType];

  return okResult({
    detectedMimeType,
    fileExtension: resolvedExtension,
    formatLabel: formatSourceFormatLabel(detectedMimeType),
  });
}

export function validateSourceImageDimensions(
  width: number,
  height: number,
): ServiceResult<{ readonly width: number; readonly height: number }> {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return errResult(
      'VALIDATION_ERROR',
      'Image could not be decoded. Valid image dimensions could not be determined.',
    );
  }

  if (width < MIN_SOURCE_IMAGE_WIDTH || height < MIN_SOURCE_IMAGE_HEIGHT) {
    return errResult(
      'VALIDATION_ERROR',
      `Image resolution is too small (${width} × ${height} px). Minimum required resolution is ${MIN_SOURCE_IMAGE_WIDTH} × ${MIN_SOURCE_IMAGE_HEIGHT} px.`,
    );
  }

  return okResult({ width, height });
}

export function createValidatedSourceAsset(
  input: ValidatedDimensionsInput,
): ServiceResult<SourceAsset> {
  const binaryResult = validateSourceImageBinary(input);
  if (!binaryResult.ok) {
    return binaryResult;
  }

  const dimensionResult = validateSourceImageDimensions(
    input.width,
    input.height,
  );
  if (!dimensionResult.ok) {
    return dimensionResult;
  }

  const timestamp = nowIsoTimestamp();
  const safeName =
    input.fileName.trim().split(/[/\\]/).pop() ||
    `source-image.${binaryResult.data.fileExtension}`;

  return okResult({
    id: createEntityId('src'),
    projectId: input.projectId,
    originalFileName: safeName,
    mimeType: binaryResult.data.detectedMimeType,
    fileExtension: binaryResult.data.fileExtension,
    fileSizeBytes: input.fileSizeBytes,
    width: dimensionResult.data.width,
    height: dimensionResult.data.height,
    aspectRatio: computeSourceAspectRatio(
      dimensionResult.data.width,
      dimensionResult.data.height,
    ),
    ...(input.checksumSha256 ? { checksumSha256: input.checksumSha256 } : {}),
    localBlobKey: null,
    validationStatus: 'validated',
    storageStatus: 'in_memory',
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

import { detectImageSignature } from '../../../src/services/source-asset/imageValidation.ts';
import type { SupportedSourceMimeType } from '../../../src/types/domain.ts';

export const MAX_GENERATED_IMAGE_BYTES = 20 * 1024 * 1024;
export const MIN_GENERATED_IMAGE_BYTES = 24;

export type OutputImageFormat = 'png' | 'jpeg' | 'webp';

export interface InspectedGeneratedImage {
  readonly mimeType: SupportedSourceMimeType;
  readonly outputFormat: OutputImageFormat;
  readonly width: number;
  readonly height: number;
  readonly byteSize: number;
  readonly bytes: Uint8Array;
}

export class InvalidGeneratedImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidGeneratedImageError';
  }
}

function mimeToFormat(mimeType: SupportedSourceMimeType): OutputImageFormat {
  if (mimeType === 'image/png') {
    return 'png';
  }
  if (mimeType === 'image/jpeg') {
    return 'jpeg';
  }
  return 'webp';
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint24LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

function extractPngDimensions(
  bytes: Uint8Array,
): { readonly width: number; readonly height: number } | null {
  if (bytes.length < 24) {
    return null;
  }
  const width = readUint32BE(bytes, 16);
  const height = readUint32BE(bytes, 20);
  if (width <= 0 || height <= 0 || width > 16384 || height > 16384) {
    return null;
  }
  return { width, height };
}

function extractJpegDimensions(
  bytes: Uint8Array,
): { readonly width: number; readonly height: number } | null {
  let offset = 2;
  while (offset + 4 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    offset += 2;

    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }

    if (offset + 2 > bytes.length) {
      break;
    }
    const segmentLength = readUint16BE(bytes, offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) {
      break;
    }

    const isSofMarker =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);

    if (isSofMarker && offset + 7 < bytes.length) {
      const height = readUint16BE(bytes, offset + 3);
      const width = readUint16BE(bytes, offset + 5);
      if (width > 0 && height > 0 && width <= 16384 && height <= 16384) {
        return { width, height };
      }
      return null;
    }

    offset += segmentLength;
  }
  return null;
}

function extractWebpDimensions(
  bytes: Uint8Array,
): { readonly width: number; readonly height: number } | null {
  if (bytes.length < 30) {
    return null;
  }
  const chunkTag = String.fromCharCode(
    bytes[12],
    bytes[13],
    bytes[14],
    bytes[15],
  );

  if (chunkTag === 'VP8X' && bytes.length >= 30) {
    const width = readUint24LE(bytes, 24) + 1;
    const height = readUint24LE(bytes, 27) + 1;
    return width > 0 && height > 0 ? { width, height } : null;
  }

  if (chunkTag === 'VP8L' && bytes.length >= 25) {
    const b0 = bytes[21];
    const b1 = bytes[22];
    const b2 = bytes[23];
    const b3 = bytes[24];
    const width = (b0 | ((b1 & 0x3f) << 8)) + 1;
    const height = (((b1 & 0xc0) >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10)) + 1;
    return width > 0 && height > 0 ? { width, height } : null;
  }

  if (chunkTag === 'VP8 ' && bytes.length >= 30) {
    const width = readUint16LE(bytes, 26) & 0x3fff;
    const height = readUint16LE(bytes, 28) & 0x3fff;
    return width > 0 && height > 0 ? { width, height } : null;
  }

  return null;
}

export function extractBinaryImageDimensions(
  bytes: Uint8Array,
  mimeType: SupportedSourceMimeType,
): { readonly width: number; readonly height: number } | null {
  if (mimeType === 'image/png') {
    return extractPngDimensions(bytes);
  }
  if (mimeType === 'image/jpeg') {
    return extractJpegDimensions(bytes);
  }
  return extractWebpDimensions(bytes);
}

function isAllowedImageContentType(headerValue: string | null): boolean {
  if (!headerValue) {
    return true;
  }
  const mime = headerValue.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!mime) {
    return true;
  }
  return (
    mime === 'application/octet-stream' ||
    mime === 'image/png' ||
    mime === 'image/jpeg' ||
    mime === 'image/jpg' ||
    mime === 'image/webp' ||
    mime === 'binary/octet-stream'
  );
}

/**
 * Validates and inspects binary image data returned from OVHcloud SDXL.
 * Verifies byte bounds, HTTP content-type compatibility, magic-byte signature,
 * and parses true width/height dimensions from binary headers.
 */
export function inspectGeneratedImageBinary(params: {
  readonly bytes: Uint8Array;
  readonly contentTypeHeader: string | null;
}): InspectedGeneratedImage {
  const { bytes, contentTypeHeader } = params;

  if (!isAllowedImageContentType(contentTypeHeader)) {
    throw new InvalidGeneratedImageError(
      `Provider returned unsupported response Content-Type "${contentTypeHeader}". Expected binary image data.`,
    );
  }

  if (bytes.byteLength === 0) {
    throw new InvalidGeneratedImageError(
      'Provider returned an empty binary image response.',
    );
  }

  if (bytes.byteLength < MIN_GENERATED_IMAGE_BYTES) {
    throw new InvalidGeneratedImageError(
      `Provider response (${bytes.byteLength} bytes) is too small to be a valid image.`,
    );
  }

  if (bytes.byteLength > MAX_GENERATED_IMAGE_BYTES) {
    throw new InvalidGeneratedImageError(
      `Provider image response (${bytes.byteLength} bytes) exceeds the ${MAX_GENERATED_IMAGE_BYTES} byte safety ceiling.`,
    );
  }

  const detectedMime = detectImageSignature(bytes);
  if (!detectedMime) {
    throw new InvalidGeneratedImageError(
      'Provider response bytes did not match a valid PNG, JPEG, or WebP image signature.',
    );
  }

  const normalizedDeclared =
    contentTypeHeader?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (
    normalizedDeclared.startsWith('image/') &&
    normalizedDeclared !== detectedMime &&
    !(normalizedDeclared === 'image/jpg' && detectedMime === 'image/jpeg')
  ) {
    throw new InvalidGeneratedImageError(
      `Provider MIME mismatch: header declared "${normalizedDeclared}" while image bytes are "${detectedMime}".`,
    );
  }

  const dimensions = extractBinaryImageDimensions(bytes, detectedMime);
  if (!dimensions) {
    throw new InvalidGeneratedImageError(
      `Unable to parse valid image dimensions from returned ${detectedMime} binary.`,
    );
  }

  return {
    mimeType: detectedMime,
    outputFormat: mimeToFormat(detectedMime),
    width: dimensions.width,
    height: dimensions.height,
    byteSize: bytes.byteLength,
    bytes,
  };
}

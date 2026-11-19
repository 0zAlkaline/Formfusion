import sharp from 'sharp';
import type { SupportedSourceMimeType } from '../../src/types/domain.ts';

/**
 * Binaries up to 2 MiB travel directly to Gemini inlineData in ~4–6 seconds.
 * Larger binaries (e.g., 4–13.8 MiB 4096×4096 PNGs) stall when sent as giant
 * Base64 JSON inlineData payloads; for those, a transient in-memory WebP/JPEG
 * analysis derivative is produced solely for the Gemini Vision request while
 * the user's original SourceAsset and IndexedDB Blob remain untouched.
 */
export const GEMINI_VISION_TRANSIENT_FAST_INLINE_BYTES = 2 * 1024 * 1024;
export const GEMINI_VISION_TRANSIENT_MAX_DIMENSION = 2048;

export interface PreparedTransientVisionPayload {
  readonly mimeType: SupportedSourceMimeType;
  readonly imageBytes: Uint8Array;
  readonly optimized: boolean;
}

export type VisionPayloadPreparer = (input: {
  readonly mimeType: SupportedSourceMimeType;
  readonly imageBytes: Uint8Array;
}) => Promise<PreparedTransientVisionPayload>;

export async function prepareTransientVisionPayload(input: {
  readonly mimeType: SupportedSourceMimeType;
  readonly imageBytes: Uint8Array;
}): Promise<PreparedTransientVisionPayload> {
  if (input.imageBytes.byteLength <= GEMINI_VISION_TRANSIENT_FAST_INLINE_BYTES) {
    return {
      mimeType: input.mimeType,
      imageBytes: input.imageBytes,
      optimized: false,
    };
  }

  const sourceBuffer = Buffer.from(
    input.imageBytes.buffer,
    input.imageBytes.byteOffset,
    input.imageBytes.byteLength,
  );

  // First attempt: preserve alpha & crisp details via high-quality WebP bounded to 2048px
  let outputBuffer = await sharp(sourceBuffer)
    .rotate()
    .resize({
      width: GEMINI_VISION_TRANSIENT_MAX_DIMENSION,
      height: GEMINI_VISION_TRANSIENT_MAX_DIMENSION,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: 88 })
    .toBuffer();

  if (outputBuffer.byteLength <= GEMINI_VISION_TRANSIENT_FAST_INLINE_BYTES) {
    return {
      mimeType: 'image/webp',
      imageBytes: new Uint8Array(
        outputBuffer.buffer,
        outputBuffer.byteOffset,
        outputBuffer.byteLength,
      ),
      optimized: true,
    };
  }

  // Fallback for ultra-high-entropy noise images: high-quality JPEG bounded to 1536px
  outputBuffer = await sharp(sourceBuffer)
    .rotate()
    .resize({
      width: 1536,
      height: 1536,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 84, mozjpeg: true })
    .toBuffer();

  return {
    mimeType: 'image/jpeg',
    imageBytes: new Uint8Array(
      outputBuffer.buffer,
      outputBuffer.byteOffset,
      outputBuffer.byteLength,
    ),
    optimized: true,
  };
}

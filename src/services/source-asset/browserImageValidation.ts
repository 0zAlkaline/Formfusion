import { errResult, okResult } from '../../types/common.ts';
import type { EntityId, ServiceResult } from '../../types/common.ts';
import type { SourceAsset } from '../../types/domain.ts';
import {
  createValidatedSourceAsset,
  validateSourceImageBinary,
} from './imageValidation.ts';

export interface ValidatedSourceUpload {
  readonly sourceAsset: SourceAsset;
  readonly previewUrl: string;
  readonly selectedFile: File;
  readonly binaryBlob: Blob;
}

async function computeSha256Hex(buffer: ArrayBuffer): Promise<string | undefined> {
  try {
    if (
      typeof globalThis.crypto === 'undefined' ||
      typeof globalThis.crypto.subtle?.digest !== 'function'
    ) {
      return undefined;
    }
    const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
    const bytes = new Uint8Array(digest);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return undefined;
  }
}

async function decodeBrowserImage(
  file: File,
): Promise<ServiceResult<{ readonly width: number; readonly height: number; readonly previewUrl: string }>> {
  const objectUrl = URL.createObjectURL(file);

  try {
    const dimensions = await new Promise<{ width: number; height: number }>(
      (resolve, reject) => {
        const img = new Image();

        img.onload = async () => {
          try {
            if (typeof img.decode === 'function') {
              await img.decode();
            }
          } catch {
            reject(new Error('Image could not be decoded.'));
            return;
          }

          if (img.naturalWidth <= 0 || img.naturalHeight <= 0) {
            reject(new Error('Image contains zero-sized dimensions.'));
            return;
          }

          resolve({
            width: img.naturalWidth,
            height: img.naturalHeight,
          });
        };

        img.onerror = () => {
          reject(new Error('Image could not be decoded.'));
        };

        img.src = objectUrl;
      },
    );

    return okResult({
      width: dimensions.width,
      height: dimensions.height,
      previewUrl: objectUrl,
    });
  } catch {
    URL.revokeObjectURL(objectUrl);
    return errResult(
      'VALIDATION_ERROR',
      'Image could not be decoded. The file may be corrupted or truncated.',
    );
  }
}

/**
 * Validates a browser-selected File end-to-end:
 * 1) Size, MIME, extension, and magic-byte signature verification.
 * 2) Browser image decode & natural dimension measurement (>= 256x256).
 * 3) SHA-256 checksum computation (when WebCrypto subtle digest is available).
 * Returns a validated SourceAsset marked strictly as in_memory (never persisted).
 */
export async function validateSelectedImageFile(
  file: File,
  projectId: EntityId,
): Promise<ServiceResult<ValidatedSourceUpload>> {
  let arrayBuffer: ArrayBuffer;
  try {
    arrayBuffer = await file.arrayBuffer();
  } catch {
    return errResult(
      'VALIDATION_ERROR',
      'Unable to read the selected image file.',
    );
  }

  const headerSlice = new Uint8Array(
    arrayBuffer,
    0,
    Math.min(arrayBuffer.byteLength, 64),
  );

  const binaryCheck = validateSourceImageBinary({
    fileName: file.name,
    declaredMimeType: file.type,
    fileSizeBytes: file.size,
    headerBytes: headerSlice,
  });
  if (!binaryCheck.ok) {
    return binaryCheck;
  }

  const decoded = await decodeBrowserImage(file);
  if (!decoded.ok) {
    return decoded;
  }

  const checksumSha256 = await computeSha256Hex(arrayBuffer);

  const assetResult = createValidatedSourceAsset({
    projectId,
    fileName: file.name,
    declaredMimeType: file.type,
    fileSizeBytes: file.size,
    headerBytes: headerSlice,
    width: decoded.data.width,
    height: decoded.data.height,
    checksumSha256,
  });

  if (!assetResult.ok) {
    URL.revokeObjectURL(decoded.data.previewUrl);
    return assetResult;
  }

  return okResult({
    sourceAsset: assetResult.data,
    previewUrl: decoded.data.previewUrl,
    selectedFile: file,
    binaryBlob: new Blob([arrayBuffer], { type: assetResult.data.mimeType }),
  });
}

import { errResult, okResult } from '../../types/common.ts';
import type { EntityId, ServiceResult } from '../../types/common.ts';
import type { GeneratedArtwork, GenerationKind } from '../../types/domain.ts';
import type {
  ArtworkSourceExportInspection,
  ExportArtifact,
  ExportArtworkRequest,
  ExportService,
} from '../../types/services.ts';
import type {
  IndexedDbStorageGateway,
  PersistedAssetBlob,
} from '../../types/storage.ts';
import {
  createDefaultExportSettings,
  DEFAULT_JPEG_BACKGROUND_COLOR,
  DEFAULT_JPEG_QUALITY_PERCENT,
  detectAlphaTransparencyFromRgbaPixels,
  evaluateArtworkExportSettings,
  type ArtworkExportFormat,
  type ArtworkExportSettings,
  type ResolvedArtworkExportSpec,
} from './exportConfig.ts';

function isReadableBlob(value: unknown): value is Blob {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Blob).size === 'number' &&
    (value as Blob).size > 0 &&
    typeof (value as Blob).arrayBuffer === 'function'
  );
}

interface DecodedBrowserImage {
  readonly image: HTMLImageElement;
  readonly width: number;
  readonly height: number;
  readonly revoke: () => void;
}

async function decodeImageBlobSafely(
  blob: Blob,
): Promise<ServiceResult<DecodedBrowserImage>> {
  if (
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function' ||
    typeof Image === 'undefined'
  ) {
    return errResult(
      'STORAGE_ERROR',
      'Browser image decoding APIs are unavailable in this environment.',
    );
  }

  const objectUrl = URL.createObjectURL(blob);

  try {
    const loaded = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () =>
        reject(new Error('Image binary could not be decoded by the browser.'));
      img.src = objectUrl;
    });

    if (typeof loaded.decode === 'function') {
      try {
        await loaded.decode();
      } catch {
        // Fallback when onload already decoded image dimensions cleanly.
      }
    }

    if (loaded.naturalWidth <= 0 || loaded.naturalHeight <= 0) {
      URL.revokeObjectURL(objectUrl);
      return errResult(
        'VALIDATION_ERROR',
        'Decoded artwork image has invalid zero dimensions.',
      );
    }

    return okResult({
      image: loaded,
      width: loaded.naturalWidth,
      height: loaded.naturalHeight,
      revoke: () => URL.revokeObjectURL(objectUrl),
    });
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    return errResult(
      'STORAGE_ERROR',
      error instanceof Error
        ? error.message
        : 'Artwork image binary is corrupted or cannot be decoded.',
    );
  }
}

function inspectDecodedImageAlpha(decoded: DecodedBrowserImage): boolean {
  if (typeof document === 'undefined') {
    return false;
  }
  const maxSampleSide = 2048;
  const scale = Math.min(
    1,
    maxSampleSide / Math.max(decoded.width, decoded.height, 1),
  );
  const sampleWidth = Math.max(1, Math.round(decoded.width * scale));
  const sampleHeight = Math.max(1, Math.round(decoded.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = sampleWidth;
  canvas.height = sampleHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return false;
  }

  ctx.clearRect(0, 0, sampleWidth, sampleHeight);
  ctx.drawImage(decoded.image, 0, 0, sampleWidth, sampleHeight);

  try {
    const imageData = ctx.getImageData(0, 0, sampleWidth, sampleHeight);
    return detectAlphaTransparencyFromRgbaPixels(imageData.data);
  } catch {
    return false;
  }
}

async function encodeCanvasToBlob(
  decoded: DecodedBrowserImage,
  spec: ResolvedArtworkExportSpec,
): Promise<ServiceResult<Blob>> {
  if (typeof document === 'undefined') {
    return errResult(
      'STORAGE_ERROR',
      'Browser Canvas API is unavailable for image export.',
    );
  }

  const canvas = document.createElement('canvas');
  canvas.width = spec.width;
  canvas.height = spec.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return errResult(
      'STORAGE_ERROR',
      'Unable to initialize 2D rendering context for artwork export.',
    );
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  if (spec.format === 'jpeg') {
    ctx.fillStyle = spec.jpegBackgroundColor;
    ctx.fillRect(0, 0, spec.width, spec.height);
  } else {
    ctx.clearRect(0, 0, spec.width, spec.height);
  }

  ctx.drawImage(decoded.image, 0, 0, spec.width, spec.height);

  try {
    const encoded = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(
        (result) => resolve(result),
        spec.mimeType,
        spec.jpegQualityNormalized,
      );
    });

    if (!encoded || encoded.size <= 0) {
      return errResult(
        'STORAGE_ERROR',
        `Browser failed to encode the ${spec.format.toUpperCase()} export image at ${spec.width} × ${spec.height} px.`,
      );
    }

    return okResult(encoded);
  } catch (error) {
    return errResult(
      'STORAGE_ERROR',
      error instanceof Error
        ? `Export encoding failed: ${error.message}`
        : 'Unexpected error while encoding exported artwork.',
    );
  }
}

export function triggerBrowserBlobDownload(
  blob: Blob,
  fileName: string,
): ServiceResult<void> {
  if (
    typeof document === 'undefined' ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function'
  ) {
    return errResult(
      'STORAGE_ERROR',
      'Browser download APIs are unavailable in this environment.',
    );
  }

  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = downloadUrl;
  link.download = fileName;
  link.rel = 'noopener noreferrer';
  link.style.display = 'none';

  try {
    document.body.appendChild(link);
    link.click();
    return okResult(undefined);
  } catch (error) {
    return errResult(
      'STORAGE_ERROR',
      error instanceof Error
        ? `Unable to trigger browser download: ${error.message}`
        : 'Unable to trigger browser download.',
    );
  } finally {
    if (link.parentNode) {
      link.parentNode.removeChild(link);
    }
    setTimeout(() => {
      URL.revokeObjectURL(downloadUrl);
    }, 1500);
  }
}

export interface EncodedPreviewResult {
  readonly artifact: ExportArtifact;
  readonly spec: ResolvedArtworkExportSpec;
}

export class StudioExportService implements ExportService {
  private readonly storageGateway: IndexedDbStorageGateway | null;

  constructor(storageGateway?: IndexedDbStorageGateway | null) {
    this.storageGateway = storageGateway ?? null;
  }

  private async readPersistedArtworkBlobFromIndexedDb(
    artwork: GeneratedArtwork,
  ): Promise<ServiceResult<{ readonly artwork: GeneratedArtwork; readonly blob: Blob }>> {
    if (!this.storageGateway) {
      return errResult(
        'STORAGE_ERROR',
        'IndexedDB storage gateway is unavailable for export Blob lookup.',
      );
    }

    const gateway = this.storageGateway;
    return gateway.runInTransaction(
      {
        stores: ['generatedArtworks', 'assetBlobs'],
        mode: 'readonly',
      },
      async () => {
        const artworkRes = await gateway
          .getStore('generatedArtworks')
          .getById(artwork.id);

        if (!artworkRes.ok) {
          return artworkRes;
        }

        const targetArtwork = artworkRes.data ?? artwork;
        if (!targetArtwork.localBlobKey) {
          return errResult(
            'NOT_FOUND',
            'Stored generated artwork is missing its local binary key.',
          );
        }

        const blobRes = await gateway
          .getStore('assetBlobs')
          .getById(targetArtwork.localBlobKey);

        if (!blobRes.ok) {
          return blobRes;
        }

        const blobRecord = blobRes.data;
        if (
          !blobRecord ||
          blobRecord.ownerAssetId !== targetArtwork.id ||
          blobRecord.projectId !== targetArtwork.projectId ||
          !isReadableBlob(blobRecord.blob)
        ) {
          return errResult(
            'NOT_FOUND',
            'Artwork binary data is missing or corrupted in local IndexedDB storage and cannot be exported.',
          );
        }

        return okResult({
          artwork: targetArtwork,
          blob: blobRecord.blob,
        });
      },
    );
  }

  async inspectArtworkSource(
    artwork: GeneratedArtwork,
  ): Promise<ServiceResult<ArtworkSourceExportInspection>> {
    const persisted = await this.readPersistedArtworkBlobFromIndexedDb(artwork);
    if (!persisted.ok) {
      return persisted;
    }

    const decoded = await decodeImageBlobSafely(persisted.data.blob);
    if (!decoded.ok) {
      return decoded;
    }

    try {
      const hasAlphaTransparency = inspectDecodedImageAlpha(decoded.data);
      return okResult({
        artwork: persisted.data.artwork,
        naturalWidth: decoded.data.width,
        naturalHeight: decoded.data.height,
        originalByteSize: persisted.data.blob.size,
        hasAlphaTransparency,
        blob: persisted.data.blob,
      });
    } finally {
      decoded.data.revoke();
    }
  }

  async buildExportArtifactFromSettings(params: {
    readonly artwork: GeneratedArtwork;
    readonly generationId: EntityId;
    readonly generationKind: GenerationKind;
    readonly settings: ArtworkExportSettings;
    readonly triggerDownload: boolean;
  }): Promise<ServiceResult<EncodedPreviewResult>> {
    const inspected = await this.inspectArtworkSource(params.artwork);
    if (!inspected.ok) {
      return inspected;
    }

    const evaluation = evaluateArtworkExportSettings({
      settings: params.settings,
      sourceWidth: inspected.data.naturalWidth,
      sourceHeight: inspected.data.naturalHeight,
      generationKind: params.generationKind,
      generationId: params.generationId,
      hasSourceTransparency: inspected.data.hasAlphaTransparency,
    });

    if (!evaluation.valid || !evaluation.spec) {
      const firstError =
        evaluation.fieldErrors.width ??
        evaluation.fieldErrors.height ??
        evaluation.fieldErrors.jpegQuality ??
        evaluation.fieldErrors.jpegBackgroundColor ??
        'Export configuration is invalid.';
      return errResult('VALIDATION_ERROR', firstError);
    }

    const decoded = await decodeImageBlobSafely(inspected.data.blob);
    if (!decoded.ok) {
      return decoded;
    }

    try {
      const encodedBlob = await encodeCanvasToBlob(decoded.data, evaluation.spec);
      if (!encodedBlob.ok) {
        return encodedBlob;
      }

      if (params.triggerDownload) {
        const downloadRes = triggerBrowserBlobDownload(
          encodedBlob.data,
          evaluation.spec.fileName,
        );
        if (!downloadRes.ok) {
          return downloadRes;
        }
      }

      return okResult({
        spec: evaluation.spec,
        artifact: {
          fileName: evaluation.spec.fileName,
          mimeType: evaluation.spec.mimeType,
          byteSize: encodedBlob.data.size,
          width: evaluation.spec.width,
          height: evaluation.spec.height,
          hasSourceTransparency: inspected.data.hasAlphaTransparency,
          blob: encodedBlob.data,
          warnings: evaluation.warnings,
        },
      });
    } finally {
      decoded.data.revoke();
    }
  }

  private toSettingsFromRequest(
    request: ExportArtworkRequest,
    sourceWidth: number,
    sourceHeight: number,
  ): ServiceResult<ArtworkExportSettings> {
    if (request.format !== 'png' && request.format !== 'jpeg') {
      return errResult(
        'VALIDATION_ERROR',
        `Unsupported export format "${request.format}". Supported formats are PNG and JPEG.`,
      );
    }

    const format: ArtworkExportFormat = request.format;
    const hasCustomDims =
      request.targetWidth !== undefined || request.targetHeight !== undefined;

    const defaults = createDefaultExportSettings(sourceWidth, sourceHeight);
    return okResult({
      ...defaults,
      format,
      dimensionMode: hasCustomDims ? 'custom' : 'original',
      customWidthInput: String(request.targetWidth ?? sourceWidth),
      customHeightInput: String(request.targetHeight ?? sourceHeight),
      lockAspectRatio: request.lockAspectRatio ?? true,
      jpegQualityPercent:
        request.jpegQualityPercent ?? DEFAULT_JPEG_QUALITY_PERCENT,
      jpegBackgroundColor:
        request.jpegBackgroundColor ?? DEFAULT_JPEG_BACKGROUND_COLOR,
    });
  }

  async estimateExportArtifact(
    request: Omit<ExportArtworkRequest, 'triggerDownload'>,
  ): Promise<ServiceResult<ExportArtifact>> {
    const inspected = await this.inspectArtworkSource(request.artwork);
    if (!inspected.ok) {
      return inspected;
    }

    const settingsRes = this.toSettingsFromRequest(
      { ...request, triggerDownload: false },
      inspected.data.naturalWidth,
      inspected.data.naturalHeight,
    );
    if (!settingsRes.ok) {
      return settingsRes;
    }

    const built = await this.buildExportArtifactFromSettings({
      artwork: inspected.data.artwork,
      generationId: request.artwork.generationJobId,
      generationKind:
        request.generationKind ??
        inspected.data.artwork.generationKind ??
        'original',
      settings: settingsRes.data,
      triggerDownload: false,
    });
    return built.ok ? okResult(built.data.artifact) : built;
  }

  async exportArtwork(
    request: ExportArtworkRequest,
  ): Promise<ServiceResult<ExportArtifact>> {
    const inspected = await this.inspectArtworkSource(request.artwork);
    if (!inspected.ok) {
      return inspected;
    }

    const settingsRes = this.toSettingsFromRequest(
      request,
      inspected.data.naturalWidth,
      inspected.data.naturalHeight,
    );
    if (!settingsRes.ok) {
      return settingsRes;
    }

    const built = await this.buildExportArtifactFromSettings({
      artwork: inspected.data.artwork,
      generationId: request.artwork.generationJobId,
      generationKind:
        request.generationKind ??
        inspected.data.artwork.generationKind ??
        'original',
      settings: settingsRes.data,
      triggerDownload: request.triggerDownload ?? true,
    });
    return built.ok ? okResult(built.data.artifact) : built;
  }
}

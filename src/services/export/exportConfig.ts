import { errResult, okResult } from '../../types/common.ts';
import type { EntityId, ServiceResult } from '../../types/common.ts';
import type { GenerationKind } from '../../types/domain.ts';

export const MIN_EXPORT_DIMENSION = 1 as const;
export const MAX_EXPORT_DIMENSION = 8192 as const;
export const DEFAULT_JPEG_QUALITY_PERCENT = 92 as const;
export const MIN_JPEG_QUALITY_PERCENT = 60 as const;
export const MAX_JPEG_QUALITY_PERCENT = 100 as const;
export const DEFAULT_JPEG_BACKGROUND_COLOR = '#FFFFFF' as const;

export const JPEG_BACKGROUND_PRESETS: readonly {
  readonly label: string;
  readonly hex: string;
}[] = [
  { label: 'Pure White', hex: '#FFFFFF' },
  { label: 'Studio Ivory', hex: '#F7F5F0' },
  { label: 'Matte Ink', hex: '#17191E' },
] as const;

export type ArtworkExportFormat = 'png' | 'jpeg';
export type ExportDimensionMode = 'original' | 'custom';

export interface ArtworkExportSettings {
  readonly format: ArtworkExportFormat;
  readonly dimensionMode: ExportDimensionMode;
  readonly customWidthInput: string;
  readonly customHeightInput: string;
  readonly lockAspectRatio: boolean;
  readonly jpegQualityPercent: number;
  readonly jpegBackgroundColor: string;
}

export interface ExportFieldErrors {
  readonly width?: string;
  readonly height?: string;
  readonly jpegQuality?: string;
  readonly jpegBackgroundColor?: string;
}

export interface ResolvedArtworkExportSpec {
  readonly format: ArtworkExportFormat;
  readonly mimeType: 'image/png' | 'image/jpeg';
  readonly width: number;
  readonly height: number;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly aspectRatioLabel: string;
  readonly isAspectRatioLocked: boolean;
  readonly isAspectRatioChanged: boolean;
  readonly jpegQualityPercent: number;
  readonly jpegQualityNormalized: number | undefined;
  readonly jpegBackgroundColor: string;
  readonly fileName: string;
}

export interface ExportValidationEvaluation {
  readonly valid: boolean;
  readonly spec: ResolvedArtworkExportSpec | null;
  readonly fieldErrors: ExportFieldErrors;
  readonly warnings: readonly string[];
}

export function createDefaultExportSettings(
  sourceWidth: number,
  sourceHeight: number,
): ArtworkExportSettings {
  const safeW =
    Number.isInteger(sourceWidth) && sourceWidth > 0 ? sourceWidth : 1024;
  const safeH =
    Number.isInteger(sourceHeight) && sourceHeight > 0 ? sourceHeight : 1024;

  return {
    format: 'png',
    dimensionMode: 'original',
    customWidthInput: String(safeW),
    customHeightInput: String(safeH),
    lockAspectRatio: true,
    jpegQualityPercent: DEFAULT_JPEG_QUALITY_PERCENT,
    jpegBackgroundColor: DEFAULT_JPEG_BACKGROUND_COLOR,
  };
}

export function validateJpegQualityPercent(
  value: unknown,
): ServiceResult<number> {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return errResult(
      'VALIDATION_ERROR',
      'JPEG quality must be a valid number between 60% and 100%.',
    );
  }
  const rounded = Math.round(value);
  if (rounded < MIN_JPEG_QUALITY_PERCENT || rounded > MAX_JPEG_QUALITY_PERCENT) {
    return errResult(
      'VALIDATION_ERROR',
      `JPEG quality must be between ${MIN_JPEG_QUALITY_PERCENT}% and ${MAX_JPEG_QUALITY_PERCENT}%.`,
    );
  }
  return okResult(rounded);
}

export function clampJpegQualityPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_JPEG_QUALITY_PERCENT;
  }
  return Math.min(
    MAX_JPEG_QUALITY_PERCENT,
    Math.max(MIN_JPEG_QUALITY_PERCENT, Math.round(value)),
  );
}

export function normalizeHexColor(value: string): string | null {
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(trimmed)) {
    return `#${trimmed.toUpperCase()}`;
  }
  return null;
}

export function validateBackgroundColor(value: string): ServiceResult<string> {
  const normalized = normalizeHexColor(value);
  if (!normalized) {
    return errResult(
      'VALIDATION_ERROR',
      'Background color must be a valid 6-digit hex color (for example, #FFFFFF).',
    );
  }
  return okResult(normalized);
}

export function validateCustomDimensionValue(
  raw: string | number,
  axisLabel: 'Width' | 'Height',
): ServiceResult<number> {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || !Number.isInteger(raw)) {
      return errResult(
        'VALIDATION_ERROR',
        `${axisLabel} must be a whole integer in pixels.`,
      );
    }
    if (raw < MIN_EXPORT_DIMENSION) {
      return errResult(
        'VALIDATION_ERROR',
        `${axisLabel} must be at least ${MIN_EXPORT_DIMENSION} px.`,
      );
    }
    if (raw > MAX_EXPORT_DIMENSION) {
      return errResult(
        'VALIDATION_ERROR',
        `${axisLabel} cannot exceed ${MAX_EXPORT_DIMENSION} px.`,
      );
    }
    return okResult(raw);
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return errResult('VALIDATION_ERROR', `${axisLabel} is required.`);
  }
  if (!/^-?\d+$/.test(trimmed)) {
    return errResult(
      'VALIDATION_ERROR',
      `${axisLabel} must be a positive whole integer in pixels.`,
    );
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(parsed)) {
    return errResult(
      'VALIDATION_ERROR',
      `${axisLabel} exceeds supported numeric range.`,
    );
  }
  if (parsed < MIN_EXPORT_DIMENSION) {
    return errResult(
      'VALIDATION_ERROR',
      `${axisLabel} must be at least ${MIN_EXPORT_DIMENSION} px.`,
    );
  }
  if (parsed > MAX_EXPORT_DIMENSION) {
    return errResult(
      'VALIDATION_ERROR',
      `${axisLabel} cannot exceed ${MAX_EXPORT_DIMENSION} px.`,
    );
  }
  return okResult(parsed);
}

export function computeAspectLockedHeight(
  targetWidth: number,
  sourceWidth: number,
  sourceHeight: number,
): number {
  if (
    !Number.isFinite(targetWidth) ||
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0
  ) {
    return Math.max(MIN_EXPORT_DIMENSION, Math.round(targetWidth) || 1024);
  }
  const raw = Math.round((targetWidth * sourceHeight) / sourceWidth);
  return Math.max(MIN_EXPORT_DIMENSION, raw);
}

export function computeAspectLockedWidth(
  targetHeight: number,
  sourceWidth: number,
  sourceHeight: number,
): number {
  if (
    !Number.isFinite(targetHeight) ||
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0
  ) {
    return Math.max(MIN_EXPORT_DIMENSION, Math.round(targetHeight) || 1024);
  }
  const raw = Math.round((targetHeight * sourceWidth) / sourceHeight);
  return Math.max(MIN_EXPORT_DIMENSION, raw);
}

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

export function formatPixelAspectRatio(width: number, height: number): string {
  if (width <= 0 || height <= 0) {
    return 'Unavailable';
  }
  const divisor = gcd(width, height);
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
}

export function isAspectRatioChanged(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): boolean {
  if (
    sourceWidth <= 0 ||
    sourceHeight <= 0 ||
    targetWidth <= 0 ||
    targetHeight <= 0
  ) {
    return false;
  }
  const expectedHeight = computeAspectLockedHeight(
    targetWidth,
    sourceWidth,
    sourceHeight,
  );
  const expectedWidth = computeAspectLockedWidth(
    targetHeight,
    sourceWidth,
    sourceHeight,
  );
  return (
    Math.abs(targetHeight - expectedHeight) > 1 &&
    Math.abs(targetWidth - expectedWidth) > 1
  );
}

export function formatExportArtworkTypeSegment(kind: GenerationKind): string {
  switch (kind) {
    case 'regeneration':
      return 'Regenerated';
    case 'variation':
      return 'Variation';
    default:
      return 'Original';
  }
}

export function sanitizeExportFilenameSegment(value: string): string {
  const cleaned = value
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001F]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned.length > 0 ? cleaned : 'Artifact';
}

export function buildArtworkExportFilename(params: {
  readonly generationKind: GenerationKind;
  readonly generationId: EntityId;
  readonly width: number;
  readonly height: number;
  readonly format: ArtworkExportFormat;
}): string {
  const typeSegment = sanitizeExportFilenameSegment(
    formatExportArtworkTypeSegment(params.generationKind),
  );
  const idSegment = sanitizeExportFilenameSegment(params.generationId);
  const w = Math.max(1, Math.round(params.width));
  const h = Math.max(1, Math.round(params.height));
  const ext = params.format === 'jpeg' ? 'jpeg' : 'png';
  return `FormFusion_${typeSegment}_${idSegment}_${w}x${h}.${ext}`;
}

/**
 * Inspects RGBA pixel data (Uint8ClampedArray in R,G,B,A quadruplets) to determine
 * whether the source image genuinely contains non-opaque alpha pixels (< 255).
 */
export function detectAlphaTransparencyFromRgbaPixels(
  rgba: Uint8ClampedArray,
): boolean {
  for (let i = 3; i < rgba.length; i += 4) {
    const alpha = rgba[i];
    if (alpha !== undefined && alpha < 255) {
      return true;
    }
  }
  return false;
}

export function evaluateArtworkExportSettings(params: {
  readonly settings: ArtworkExportSettings;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly generationKind: GenerationKind;
  readonly generationId: EntityId;
  readonly hasSourceTransparency?: boolean;
}): ExportValidationEvaluation {
  const { settings, sourceWidth, sourceHeight } = params;
  const fieldErrors: {
    width?: string;
    height?: string;
    jpegQuality?: string;
    jpegBackgroundColor?: string;
  } = {};
  const warnings: string[] = [];

  if (
    !Number.isInteger(sourceWidth) ||
    sourceWidth <= 0 ||
    !Number.isInteger(sourceHeight) ||
    sourceHeight <= 0
  ) {
    return {
      valid: false,
      spec: null,
      fieldErrors: {
        width: 'Source artwork dimensions are unavailable.',
      },
      warnings: [],
    };
  }

  let resolvedWidth = sourceWidth;
  let resolvedHeight = sourceHeight;

  if (settings.dimensionMode === 'custom') {
    const wRes = validateCustomDimensionValue(
      settings.customWidthInput,
      'Width',
    );
    const hRes = validateCustomDimensionValue(
      settings.customHeightInput,
      'Height',
    );

    if (!wRes.ok) {
      fieldErrors.width = wRes.error.message;
    } else {
      resolvedWidth = wRes.data;
    }

    if (!hRes.ok) {
      fieldErrors.height = hRes.error.message;
    } else {
      resolvedHeight = hRes.data;
    }

    if (
      wRes.ok &&
      hRes.ok &&
      settings.lockAspectRatio &&
      isAspectRatioChanged(
        sourceWidth,
        sourceHeight,
        resolvedWidth,
        resolvedHeight,
      )
    ) {
      fieldErrors.height =
        'Locked aspect ratio requires height to stay proportional to width.';
    }
  }

  const qualityRes = validateJpegQualityPercent(settings.jpegQualityPercent);
  let resolvedQuality: number = DEFAULT_JPEG_QUALITY_PERCENT;
  if (settings.format === 'jpeg') {
    if (!qualityRes.ok) {
      fieldErrors.jpegQuality = qualityRes.error.message;
    } else {
      resolvedQuality = qualityRes.data;
    }
  }

  const bgRes = validateBackgroundColor(settings.jpegBackgroundColor);
  let resolvedBg: string = DEFAULT_JPEG_BACKGROUND_COLOR;
  if (settings.format === 'jpeg') {
    if (!bgRes.ok) {
      fieldErrors.jpegBackgroundColor = bgRes.error.message;
    } else {
      resolvedBg = bgRes.data;
    }
  }

  const hasErrors = Object.keys(fieldErrors).length > 0;
  const aspectChanged =
    !hasErrors &&
    settings.dimensionMode === 'custom' &&
    isAspectRatioChanged(sourceWidth, sourceHeight, resolvedWidth, resolvedHeight);

  if (settings.format === 'jpeg') {
    warnings.push(
      params.hasSourceTransparency
        ? 'JPEG does not support transparency. Transparent pixels in this artwork will be composited onto the selected background color.'
        : 'JPEG does not support transparency. Any transparent areas will be composited onto the selected background color.',
    );
  }

  if (!settings.lockAspectRatio && settings.dimensionMode === 'custom' && aspectChanged) {
    warnings.push(
      `Aspect ratio is unlocked and differs from original proportions (${formatPixelAspectRatio(sourceWidth, sourceHeight)} → ${formatPixelAspectRatio(resolvedWidth, resolvedHeight)}). Exported image will stretch to fill ${resolvedWidth} × ${resolvedHeight} px.`,
    );
  }

  if (
    !hasErrors &&
    settings.dimensionMode === 'custom' &&
    (resolvedWidth > sourceWidth || resolvedHeight > sourceHeight)
  ) {
    warnings.push(
      `Output exceeds original ${sourceWidth} × ${sourceHeight} px resolution and will be resampled using browser canvas interpolation.`,
    );
  }

  if (hasErrors) {
    return {
      valid: false,
      spec: null,
      fieldErrors,
      warnings,
    };
  }

  const fileName = buildArtworkExportFilename({
    generationKind: params.generationKind,
    generationId: params.generationId,
    width: resolvedWidth,
    height: resolvedHeight,
    format: settings.format,
  });

  return {
    valid: true,
    spec: {
      format: settings.format,
      mimeType: settings.format === 'jpeg' ? 'image/jpeg' : 'image/png',
      width: resolvedWidth,
      height: resolvedHeight,
      sourceWidth,
      sourceHeight,
      aspectRatioLabel: formatPixelAspectRatio(resolvedWidth, resolvedHeight),
      isAspectRatioLocked:
        settings.dimensionMode === 'original' ? true : settings.lockAspectRatio,
      isAspectRatioChanged: aspectChanged,
      jpegQualityPercent: resolvedQuality,
      jpegQualityNormalized:
        settings.format === 'jpeg' ? resolvedQuality / 100 : undefined,
      jpegBackgroundColor: resolvedBg,
      fileName,
    },
    fieldErrors,
    warnings,
  };
}

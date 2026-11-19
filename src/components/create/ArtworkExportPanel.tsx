import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ImageOff,
  Lock,
  Unlock,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStudioServices } from '../../app/providers/AppProviders.tsx';
import {
  clampJpegQualityPercent,
  computeAspectLockedHeight,
  computeAspectLockedWidth,
  createDefaultExportSettings,
  evaluateArtworkExportSettings,
  JPEG_BACKGROUND_PRESETS,
  MAX_EXPORT_DIMENSION,
  MAX_JPEG_QUALITY_PERCENT,
  MIN_JPEG_QUALITY_PERCENT,
  validateCustomDimensionValue,
  type ArtworkExportFormat,
  type ArtworkExportSettings,
  type ExportDimensionMode,
} from '../../services/export/exportConfig.ts';
import {
  resolveGenerationKind,
  type PersistedGenerationRecordBundle,
} from '../../services/image-generation/generationHistoryService.ts';
import { formatFileSize } from '../../services/source-asset/imageValidation.ts';
import {
  Alert,
  Button,
  Checkbox,
  TextInput,
  Typography,
  cn,
} from '../ui/index.ts';

export interface ArtworkExportPanelProps {
  readonly entry: PersistedGenerationRecordBundle;
  readonly previewObjectUrl: string | null;
  readonly hasImageReady: boolean;
  readonly intrinsicWidth: number;
  readonly intrinsicHeight: number;
}

export function ArtworkExportPanel({
  entry,
  previewObjectUrl,
  hasImageReady,
  intrinsicWidth,
  intrinsicHeight,
}: ArtworkExportPanelProps) {
  const { exportService } = useStudioServices();
  const isMountedRef = useRef(true);

  const generationKind = resolveGenerationKind(entry.job, entry.promptDocument);

  const [sourceWidth, setSourceWidth] = useState(intrinsicWidth);
  const [sourceHeight, setSourceHeight] = useState(intrinsicHeight);
  const [hasSourceTransparency, setHasSourceTransparency] = useState(false);
  const [isInspectingSource, setIsInspectingSource] = useState(false);

  const [settings, setSettings] = useState<ArtworkExportSettings>(() =>
    createDefaultExportSettings(intrinsicWidth, intrinsicHeight),
  );

  const [estimatedByteSize, setEstimatedByteSize] = useState<number | null>(
    null,
  );
  const [isEstimating, setIsEstimating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState<{
    readonly fileName: string;
    readonly width: number;
    readonly height: number;
    readonly byteSize: number;
    readonly mimeType: string;
  } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Reset form state & inspect persisted IndexedDB Blob transparency whenever artwork changes.
  useEffect(() => {
    setSourceWidth(intrinsicWidth);
    setSourceHeight(intrinsicHeight);
    setSettings(createDefaultExportSettings(intrinsicWidth, intrinsicHeight));
    setHasSourceTransparency(false);
    setEstimatedByteSize(null);
    setExportSuccess(null);
    setExportError(null);

    if (!entry.artwork || !hasImageReady || entry.blobMissingOrCorrupted) {
      return;
    }

    let cancelled = false;
    setIsInspectingSource(true);

    void exportService.inspectArtworkSource(entry.artwork).then((res) => {
      if (cancelled || !isMountedRef.current) {
        return;
      }
      setIsInspectingSource(false);
      if (res.ok) {
        setSourceWidth(res.data.naturalWidth);
        setSourceHeight(res.data.naturalHeight);
        setHasSourceTransparency(res.data.hasAlphaTransparency);
        setSettings((prev) =>
          prev.dimensionMode === 'original'
            ? {
                ...prev,
                customWidthInput: String(res.data.naturalWidth),
                customHeightInput: String(res.data.naturalHeight),
              }
            : prev,
        );
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    entry.job.id,
    entry.artwork,
    entry.blobMissingOrCorrupted,
    hasImageReady,
    intrinsicWidth,
    intrinsicHeight,
    exportService,
  ]);

  const evaluation = useMemo(
    () =>
      evaluateArtworkExportSettings({
        settings,
        sourceWidth,
        sourceHeight,
        generationKind,
        generationId: entry.job.id,
        hasSourceTransparency,
      }),
    [
      settings,
      sourceWidth,
      sourceHeight,
      generationKind,
      entry.job.id,
      hasSourceTransparency,
    ],
  );

  // Compute authentic encoded file size estimate without modifying stored Blobs or triggering download.
  useEffect(() => {
    if (
      !entry.artwork ||
      !hasImageReady ||
      entry.blobMissingOrCorrupted ||
      !evaluation.valid ||
      !evaluation.spec
    ) {
      setEstimatedByteSize(null);
      setIsEstimating(false);
      return;
    }

    const spec = evaluation.spec;
    let cancelled = false;
    setIsEstimating(true);

    const timer = setTimeout(() => {
      void exportService
        .estimateExportArtifact({
          artwork: entry.artwork!,
          format: spec.format,
          fileNameBase: spec.fileName,
          includeMetadataSidecar: false,
          generationKind,
          targetWidth:
            settings.dimensionMode === 'custom' ? spec.width : undefined,
          targetHeight:
            settings.dimensionMode === 'custom' ? spec.height : undefined,
          lockAspectRatio: settings.lockAspectRatio,
          jpegQualityPercent: spec.jpegQualityPercent,
          jpegBackgroundColor: spec.jpegBackgroundColor,
        })
        .then((res) => {
          if (cancelled || !isMountedRef.current) {
            return;
          }
          setIsEstimating(false);
          if (res.ok) {
            setEstimatedByteSize(res.data.byteSize);
          } else {
            setEstimatedByteSize(null);
          }
        });
    }, 180);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    entry.artwork,
    hasImageReady,
    entry.blobMissingOrCorrupted,
    evaluation,
    generationKind,
    settings.dimensionMode,
    settings.lockAspectRatio,
    exportService,
  ]);

  const handleFormatChange = (format: ArtworkExportFormat) => {
    setExportSuccess(null);
    setExportError(null);
    setSettings((prev) => ({
      ...prev,
      format,
    }));
  };

  const handleDimensionModeChange = (dimensionMode: ExportDimensionMode) => {
    setExportSuccess(null);
    setExportError(null);
    setSettings((prev) => ({
      ...prev,
      dimensionMode,
      customWidthInput:
        dimensionMode === 'original'
          ? String(sourceWidth)
          : prev.customWidthInput,
      customHeightInput:
        dimensionMode === 'original'
          ? String(sourceHeight)
          : prev.customHeightInput,
    }));
  };

  const handleWidthChange = (rawWidth: string) => {
    setExportSuccess(null);
    setExportError(null);
    setSettings((prev) => {
      if (!prev.lockAspectRatio) {
        return {
          ...prev,
          customWidthInput: rawWidth,
        };
      }
      const validated = validateCustomDimensionValue(rawWidth, 'Width');
      if (!validated.ok) {
        return {
          ...prev,
          customWidthInput: rawWidth,
        };
      }
      const nextHeight = computeAspectLockedHeight(
        validated.data,
        sourceWidth,
        sourceHeight,
      );
      return {
        ...prev,
        customWidthInput: rawWidth,
        customHeightInput: String(nextHeight),
      };
    });
  };

  const handleHeightChange = (rawHeight: string) => {
    setExportSuccess(null);
    setExportError(null);
    setSettings((prev) => {
      if (!prev.lockAspectRatio) {
        return {
          ...prev,
          customHeightInput: rawHeight,
        };
      }
      const validated = validateCustomDimensionValue(rawHeight, 'Height');
      if (!validated.ok) {
        return {
          ...prev,
          customHeightInput: rawHeight,
        };
      }
      const nextWidth = computeAspectLockedWidth(
        validated.data,
        sourceWidth,
        sourceHeight,
      );
      return {
        ...prev,
        customHeightInput: rawHeight,
        customWidthInput: String(nextWidth),
      };
    });
  };

  const handleToggleLockAspectRatio = (nextLocked: boolean) => {
    setExportSuccess(null);
    setExportError(null);
    setSettings((prev) => {
      if (!nextLocked) {
        return {
          ...prev,
          lockAspectRatio: false,
        };
      }
      const validatedWidth = validateCustomDimensionValue(
        prev.customWidthInput,
        'Width',
      );
      if (validatedWidth.ok) {
        return {
          ...prev,
          lockAspectRatio: true,
          customHeightInput: String(
            computeAspectLockedHeight(
              validatedWidth.data,
              sourceWidth,
              sourceHeight,
            ),
          ),
        };
      }
      return {
        ...prev,
        lockAspectRatio: true,
        customWidthInput: String(sourceWidth),
        customHeightInput: String(sourceHeight),
      };
    });
  };

  const handleExportDownload = async () => {
    if (!entry.artwork) {
      setExportError(
        'No persisted artwork record is available to export for this generation.',
      );
      return;
    }
    if (!evaluation.valid || !evaluation.spec) {
      setExportError('Resolve the highlighted export dimension or settings errors before exporting.');
      return;
    }

    const spec = evaluation.spec;
    setIsExporting(true);
    setExportSuccess(null);
    setExportError(null);

    const res = await exportService.exportArtwork({
      artwork: entry.artwork,
      format: spec.format,
      fileNameBase: spec.fileName,
      includeMetadataSidecar: false,
      generationKind,
      targetWidth:
        settings.dimensionMode === 'custom' ? spec.width : undefined,
      targetHeight:
        settings.dimensionMode === 'custom' ? spec.height : undefined,
      lockAspectRatio: settings.lockAspectRatio,
      jpegQualityPercent: spec.jpegQualityPercent,
      jpegBackgroundColor: spec.jpegBackgroundColor,
      triggerDownload: true,
    });

    if (!isMountedRef.current) {
      return;
    }

    setIsExporting(false);

    if (!res.ok) {
      setExportError(res.error.message);
      return;
    }

    setExportSuccess({
      fileName: res.data.fileName,
      width: res.data.width,
      height: res.data.height,
      byteSize: res.data.byteSize,
      mimeType: res.data.mimeType,
    });
  };

  const canExport =
    hasImageReady &&
    !entry.blobMissingOrCorrupted &&
    entry.artwork !== null &&
    evaluation.valid &&
    !isExporting;

  return (
    <div className="space-y-5" data-testid="artwork-export-panel">
      {/* Unavailable Source Binary Guard */}
      {!hasImageReady || !entry.artwork || entry.blobMissingOrCorrupted ? (
        <Alert
          tone="warning"
          title="Artwork Binary Unavailable for Export"
          description={
            entry.blobErrorMessage ??
            'The generated artwork Blob is missing or unreadable in local IndexedDB storage. Stored metadata remains intact, but export requires a valid image binary.'
          }
          data-testid="export-missing-blob-alert"
        />
      ) : null}

      {/* Export Preview Card */}
      <section
        aria-labelledby="export-preview-heading"
        className="space-y-3 rounded-[var(--ff-radius-md)] border border-[var(--ff-color-border)] bg-[var(--ff-color-surface-elevated)] p-3.5"
        data-testid="export-preview-card"
      >
        <div className="flex items-center justify-between gap-2">
          <Typography id="export-preview-heading" variant="label">
            Export Preview
          </Typography>
          <span className="font-mono text-[11px] uppercase text-[var(--ff-color-muted-foreground)]">
            {settings.format === 'jpeg' ? 'JPEG' : 'PNG'}
          </span>
        </div>

        <div className="flex items-center gap-3.5">
          {/* Thumbnail showing transparency checkerboard (PNG) or composited background (JPEG) */}
          <div
            className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-[var(--ff-radius-sm)] border border-[var(--ff-color-border)]"
            style={
              settings.format === 'jpeg'
                ? {
                    backgroundColor:
                      evaluation.spec?.jpegBackgroundColor ??
                      settings.jpegBackgroundColor,
                  }
                : hasSourceTransparency
                  ? {
                      backgroundImage:
                        'linear-gradient(45deg, #E2DED5 25%, transparent 25%), linear-gradient(-45deg, #E2DED5 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #E2DED5 75%), linear-gradient(-45deg, transparent 75%, #E2DED5 75%)',
                      backgroundSize: '12px 12px',
                      backgroundPosition: '0 0, 0 6px, 6px -6px, -6px 0px',
                      backgroundColor: '#FAF8F3',
                    }
                  : { backgroundColor: '#EDEAE2' }
            }
          >
            {previewObjectUrl && hasImageReady && !entry.blobMissingOrCorrupted ? (
              <img
                src={previewObjectUrl}
                alt="Export output preview thumbnail"
                data-testid="export-preview-thumbnail"
                className={cn(
                  'h-full w-full',
                  evaluation.spec?.isAspectRatioChanged
                    ? 'object-fill'
                    : 'object-contain',
                )}
              />
            ) : (
              <ImageOff
                className="h-5 w-5 text-[var(--ff-color-muted-foreground)]"
                aria-hidden="true"
              />
            )}
          </div>

          <dl className="min-w-0 flex-1 space-y-1 text-[12px]">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-[var(--ff-color-muted-foreground)]">
                Dimensions
              </dt>
              <dd
                className="font-medium tabular-nums text-[var(--ff-color-foreground)]"
                data-testid="export-preview-dimensions"
              >
                {evaluation.spec
                  ? `${evaluation.spec.width} × ${evaluation.spec.height} px`
                  : 'Invalid'}
              </dd>
            </div>

            <div className="flex items-center justify-between gap-2">
              <dt className="text-[var(--ff-color-muted-foreground)]">
                Aspect Ratio
              </dt>
              <dd
                className="tabular-nums text-[var(--ff-color-foreground)]"
                data-testid="export-preview-aspect"
              >
                {evaluation.spec ? evaluation.spec.aspectRatioLabel : '—'}
              </dd>
            </div>

            {settings.format === 'jpeg' ? (
              <div className="flex items-center justify-between gap-2">
                <dt className="text-[var(--ff-color-muted-foreground)]">
                  JPEG Quality
                </dt>
                <dd className="font-medium tabular-nums text-[var(--ff-color-foreground)]">
                  {settings.jpegQualityPercent}%
                </dd>
              </div>
            ) : null}

            <div className="flex items-center justify-between gap-2">
              <dt className="text-[var(--ff-color-muted-foreground)]">
                Est. Size
              </dt>
              <dd
                className="font-medium tabular-nums text-[var(--ff-color-foreground)]"
                data-testid="export-estimated-size"
              >
                {!hasImageReady || !evaluation.valid
                  ? 'Unavailable'
                  : isEstimating
                    ? 'Calculating...'
                    : estimatedByteSize !== null
                      ? formatFileSize(estimatedByteSize)
                      : 'Unavailable'}
              </dd>
            </div>
          </dl>
        </div>

        <div className="border-t border-[var(--ff-color-border)] pt-2 text-[11px] text-[var(--ff-color-muted-foreground)]">
          {isInspectingSource ? (
            <span>Inspecting source pixels for alpha transparency...</span>
          ) : settings.format === 'png' ? (
            <span data-testid="export-png-transparency-status">
              {hasSourceTransparency
                ? 'Source artwork contains alpha transparency — lossless PNG preserves original transparency.'
                : 'Source artwork is opaque — lossless PNG preserves exact pixels without fabricating transparency.'}
            </span>
          ) : (
            <span data-testid="export-jpeg-bg-summary">
              Compositing background:{' '}
              <span className="font-mono text-[var(--ff-color-foreground)]">
                {evaluation.spec?.jpegBackgroundColor ??
                  settings.jpegBackgroundColor}
              </span>
            </span>
          )}
        </div>
      </section>

      {/* Output Format Selector */}
      <section className="space-y-2.5" aria-labelledby="export-format-heading">
        <Typography id="export-format-heading" variant="label">
          Output Format
        </Typography>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => handleFormatChange('png')}
            aria-pressed={settings.format === 'png'}
            data-testid="export-format-png"
            className={cn(
              'rounded-[var(--ff-radius-md)] border px-3 py-2 text-left transition-colors cursor-pointer',
              settings.format === 'png'
                ? 'border-[var(--ff-color-primary)] bg-[var(--ff-color-info-subtle)]'
                : 'border-[var(--ff-color-border)] bg-[var(--ff-color-surface)] hover:bg-[var(--ff-color-surface-elevated)]',
            )}
          >
            <div className="text-[13px] font-semibold text-[var(--ff-color-foreground)]">
              PNG
            </div>
            <div className="text-[11px] text-[var(--ff-color-muted-foreground)]">
              Lossless · Alpha safe
            </div>
          </button>

          <button
            type="button"
            onClick={() => handleFormatChange('jpeg')}
            aria-pressed={settings.format === 'jpeg'}
            data-testid="export-format-jpeg"
            className={cn(
              'rounded-[var(--ff-radius-md)] border px-3 py-2 text-left transition-colors cursor-pointer',
              settings.format === 'jpeg'
                ? 'border-[var(--ff-color-primary)] bg-[var(--ff-color-info-subtle)]'
                : 'border-[var(--ff-color-border)] bg-[var(--ff-color-surface)] hover:bg-[var(--ff-color-surface-elevated)]',
            )}
          >
            <div className="text-[13px] font-semibold text-[var(--ff-color-foreground)]">
              JPEG
            </div>
            <div className="text-[11px] text-[var(--ff-color-muted-foreground)]">
              Compact · Quality 60–100%
            </div>
          </button>
        </div>

        {/* JPEG Quality & Background Compositing Controls */}
        {settings.format === 'jpeg' ? (
          <div
            className="space-y-3.5 rounded-[var(--ff-radius-md)] border border-[var(--ff-color-border)] bg-[var(--ff-color-surface-elevated)] p-3.5"
            data-testid="export-jpeg-options"
          >
            <div
              className="flex items-start gap-2 rounded-[var(--ff-radius-sm)] border border-[#EAD7B6] bg-[var(--ff-color-warning-subtle)] px-3 py-2 text-[12px] text-[var(--ff-color-foreground)]"
              data-testid="export-jpeg-transparency-notice"
            >
              <AlertTriangle
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ff-color-warning)]"
                aria-hidden="true"
              />
              <span>
                JPEG does not support transparency. Transparent pixels are composited onto the selected background color before encoding.
              </span>
            </div>

            {/* Quality Slider */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[12px]">
                <label
                  htmlFor="export-jpeg-quality-range"
                  className="font-medium text-[var(--ff-color-foreground)]"
                >
                  JPEG Quality
                </label>
                <span
                  data-testid="export-jpeg-quality-value"
                  className="font-mono font-semibold tabular-nums text-[var(--ff-color-primary)]"
                >
                  {settings.jpegQualityPercent}%
                </span>
              </div>
              <input
                id="export-jpeg-quality-range"
                type="range"
                min={MIN_JPEG_QUALITY_PERCENT}
                max={MAX_JPEG_QUALITY_PERCENT}
                step={1}
                value={settings.jpegQualityPercent}
                onChange={(e) => {
                  const next = clampJpegQualityPercent(Number(e.target.value));
                  setExportSuccess(null);
                  setSettings((prev) => ({
                    ...prev,
                    jpegQualityPercent: next,
                  }));
                }}
                data-testid="export-jpeg-quality-slider"
                className="w-full accent-[var(--ff-color-primary)] cursor-pointer"
              />
              <div className="flex justify-between text-[11px] text-[var(--ff-color-muted-foreground)] tabular-nums">
                <span>60% (Smaller)</span>
                <span>92% Default</span>
                <span>100% (Max)</span>
              </div>
            </div>

            {/* Background Color Presets + Custom Picker */}
            <div className="space-y-2">
              <Typography variant="caption" muted className="block font-medium">
                Compositing Background Color
              </Typography>

              <div className="flex flex-wrap items-center gap-1.5">
                {JPEG_BACKGROUND_PRESETS.map((preset) => {
                  const active =
                    settings.jpegBackgroundColor.toUpperCase() === preset.hex;
                  return (
                    <button
                      key={preset.hex}
                      type="button"
                      onClick={() => {
                        setExportSuccess(null);
                        setSettings((prev) => ({
                          ...prev,
                          jpegBackgroundColor: preset.hex,
                        }));
                      }}
                      data-testid={`export-bg-preset-${preset.hex.slice(1)}`}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-[var(--ff-radius-sm)] border px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer',
                        active
                          ? 'border-[var(--ff-color-primary)] bg-[var(--ff-color-info-subtle)] text-[var(--ff-color-primary)]'
                          : 'border-[var(--ff-color-border)] bg-[var(--ff-color-surface)] text-[var(--ff-color-foreground)] hover:bg-[var(--ff-color-muted)]',
                      )}
                    >
                      <span
                        className="h-3 w-3 rounded-[2px] border border-black/15"
                        style={{ backgroundColor: preset.hex }}
                        aria-hidden="true"
                      />
                      <span>{preset.label}</span>
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label="Choose JPEG background color"
                  value={
                    /^#[0-9a-fA-F]{6}$/.test(settings.jpegBackgroundColor)
                      ? settings.jpegBackgroundColor
                      : '#FFFFFF'
                  }
                  onChange={(e) => {
                    setExportSuccess(null);
                    setSettings((prev) => ({
                      ...prev,
                      jpegBackgroundColor: e.target.value.toUpperCase(),
                    }));
                  }}
                  className="h-9 w-11 shrink-0 cursor-pointer rounded-[var(--ff-radius-sm)] border border-[var(--ff-color-input)] bg-[var(--ff-color-surface)] p-0.5"
                />
                <div className="flex-1">
                  <TextInput
                    aria-label="JPEG background hex color"
                    value={settings.jpegBackgroundColor}
                    onChange={(e) => {
                      setExportSuccess(null);
                      setSettings((prev) => ({
                        ...prev,
                        jpegBackgroundColor: e.target.value,
                      }));
                    }}
                    error={evaluation.fieldErrors.jpegBackgroundColor}
                    placeholder="#FFFFFF"
                    className="h-9 font-mono text-[12px]"
                    data-testid="export-bg-hex-input"
                  />
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      {/* Output Dimensions */}
      <section className="space-y-2.5" aria-labelledby="export-dimensions-heading">
        <Typography id="export-dimensions-heading" variant="label">
          Output Dimensions
        </Typography>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => handleDimensionModeChange('original')}
            aria-pressed={settings.dimensionMode === 'original'}
            data-testid="export-dim-original"
            className={cn(
              'rounded-[var(--ff-radius-md)] border px-3 py-2 text-left transition-colors cursor-pointer',
              settings.dimensionMode === 'original'
                ? 'border-[var(--ff-color-primary)] bg-[var(--ff-color-info-subtle)]'
                : 'border-[var(--ff-color-border)] bg-[var(--ff-color-surface)] hover:bg-[var(--ff-color-surface-elevated)]',
            )}
          >
            <div className="text-[13px] font-semibold text-[var(--ff-color-foreground)]">
              Original
            </div>
            <div className="text-[11px] tabular-nums text-[var(--ff-color-muted-foreground)]">
              {sourceWidth} × {sourceHeight} px
            </div>
          </button>

          <button
            type="button"
            onClick={() => handleDimensionModeChange('custom')}
            aria-pressed={settings.dimensionMode === 'custom'}
            data-testid="export-dim-custom"
            className={cn(
              'rounded-[var(--ff-radius-md)] border px-3 py-2 text-left transition-colors cursor-pointer',
              settings.dimensionMode === 'custom'
                ? 'border-[var(--ff-color-primary)] bg-[var(--ff-color-info-subtle)]'
                : 'border-[var(--ff-color-border)] bg-[var(--ff-color-surface)] hover:bg-[var(--ff-color-surface-elevated)]',
            )}
          >
            <div className="text-[13px] font-semibold text-[var(--ff-color-foreground)]">
              Custom
            </div>
            <div className="text-[11px] text-[var(--ff-color-muted-foreground)]">
              Up to {MAX_EXPORT_DIMENSION} px/side
            </div>
          </button>
        </div>

        {settings.dimensionMode === 'original' ? (
          <Typography variant="caption" muted className="block tabular-nums">
            Exports at original {sourceWidth} × {sourceHeight} px without upscaling or downscaling.
          </Typography>
        ) : (
          <div
            className="space-y-3 rounded-[var(--ff-radius-md)] border border-[var(--ff-color-border)] bg-[var(--ff-color-surface-elevated)] p-3.5"
            data-testid="export-custom-dimensions-panel"
          >
            <div className="grid grid-cols-2 gap-3">
              <TextInput
                label="Width (px)"
                inputMode="numeric"
                value={settings.customWidthInput}
                onChange={(e) => handleWidthChange(e.target.value)}
                error={evaluation.fieldErrors.width}
                className="h-9 tabular-nums"
                data-testid="export-width-input"
              />
              <TextInput
                label="Height (px)"
                inputMode="numeric"
                value={settings.customHeightInput}
                onChange={(e) => handleHeightChange(e.target.value)}
                error={evaluation.fieldErrors.height}
                className="h-9 tabular-nums"
                data-testid="export-height-input"
              />
            </div>

            <div className="flex items-center justify-between gap-2">
              <Checkbox
                id="export-lock-aspect-checkbox"
                checked={settings.lockAspectRatio}
                onChange={(e) => handleToggleLockAspectRatio(e.target.checked)}
                label="Lock aspect ratio"
                data-testid="export-lock-aspect-checkbox"
              />
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--ff-color-muted-foreground)]">
                {settings.lockAspectRatio ? (
                  <>
                    <Lock className="h-3 w-3" aria-hidden="true" />
                    Locked
                  </>
                ) : (
                  <>
                    <Unlock className="h-3 w-3" aria-hidden="true" />
                    Unlocked
                  </>
                )}
              </span>
            </div>

            <div
              className="flex items-center justify-between border-t border-[var(--ff-color-border)] pt-2 text-[12px]"
              data-testid="export-resulting-dimensions"
            >
              <span className="text-[var(--ff-color-muted-foreground)]">
                Resulting output
              </span>
              <span className="font-semibold tabular-nums text-[var(--ff-color-foreground)]">
                {evaluation.spec
                  ? `${evaluation.spec.width} × ${evaluation.spec.height} px (${evaluation.spec.aspectRatioLabel})`
                  : 'Fix dimension errors above'}
              </span>
            </div>
          </div>
        )}
      </section>

      {/* Non-blocking Warnings (Stretch Notice / Upscale Notice) */}
      {evaluation.warnings
        .filter((w) => !w.includes('JPEG does not support transparency'))
        .map((warning) => (
          <Alert
            key={warning}
            tone="warning"
            title="Export Notice"
            description={warning}
            data-testid="export-warning-alert"
          />
        ))}

      {/* Output Filename & Download Action */}
      <section className="space-y-3 border-t border-[var(--ff-color-border)] pt-4">
        <div className="space-y-1">
          <Typography variant="caption" muted className="block">
            Output Filename
          </Typography>
          <p
            data-testid="export-filename-preview"
            className="truncate rounded-[var(--ff-radius-sm)] border border-[var(--ff-color-border)] bg-[var(--ff-color-surface-elevated)] px-2.5 py-1.5 font-mono text-[11px] text-[var(--ff-color-foreground)]"
            title={evaluation.spec?.fileName ?? ''}
          >
            {evaluation.spec?.fileName ?? 'Fix settings to resolve filename'}
          </p>
        </div>

        <Button
          type="button"
          variant="primary"
          size="md"
          disabled={!canExport}
          loading={isExporting}
          leftIcon={<Download className="h-4 w-4" aria-hidden="true" />}
          onClick={() => void handleExportDownload()}
          className="w-full"
          data-testid="export-download-btn"
        >
          {isExporting
            ? `Exporting ${settings.format.toUpperCase()}...`
            : `Export ${settings.format.toUpperCase()}`}
        </Button>

        {exportSuccess ? (
          <div
            role="status"
            data-testid="export-success-alert"
            className="flex items-start gap-2.5 rounded-[var(--ff-radius-md)] border border-[#BDDCC8] bg-[var(--ff-color-success-subtle)] px-3.5 py-2.5 text-[12px] text-[var(--ff-color-foreground)]"
          >
            <CheckCircle2
              className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ff-color-success)]"
              aria-hidden="true"
            />
            <div className="min-w-0 space-y-0.5">
              <div className="font-semibold">Export ready and download started</div>
              <div className="truncate font-mono text-[11px]">
                {exportSuccess.fileName}
              </div>
              <div className="tabular-nums text-[var(--ff-color-muted-foreground)]">
                {exportSuccess.width} × {exportSuccess.height} px ·{' '}
                {formatFileSize(exportSuccess.byteSize)}
              </div>
            </div>
          </div>
        ) : null}

        {exportError ? (
          <Alert
            tone="destructive"
            title="Export Failed"
            description={exportError}
            data-testid="export-error-alert"
          />
        ) : null}
      </section>
    </div>
  );
}

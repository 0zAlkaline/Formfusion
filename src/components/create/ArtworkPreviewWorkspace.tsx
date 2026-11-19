import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CopyCheck,
  Download,
  GitBranch,
  ImageOff,
  Loader2,
  Maximize2,
  Minus,
  Move,
  Plus,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type SyntheticEvent,
} from 'react';
import {
  applyActualSizeViewState,
  applyPanDelta,
  applyZoomAtPoint,
  buildArtworkPreviewMetadata,
  createFitViewState,
  extractHistoricalPromptSnapshot,
  formatZoomPercent,
  getPreviewNavigationState,
  hasPreviewPanOffset,
  isImagePannable,
  MAX_VIEWER_SCALE,
  MIN_VIEWER_SCALE,
  recalculateOnContainerResize,
  resetPreviewPosition,
  resolveArtworkIntrinsicDimensions,
  stepZoomScale,
  wheelZoomScale,
  type ViewerDimensions,
  type ViewerTransformState,
} from '../../services/image-generation/artworkPreviewService.ts';
import type { PersistedGenerationRecordBundle } from '../../services/image-generation/generationHistoryService.ts';
import type { EntityId } from '../../types/common.ts';
import {
  Alert,
  Badge,
  Button,
  Tooltip,
  Typography,
  cn,
} from '../ui/index.ts';
import { ArtworkExportPanel } from './ArtworkExportPanel.tsx';

export interface ArtworkPreviewWorkspaceProps {
  readonly open: boolean;
  readonly entry: PersistedGenerationRecordBundle | null;
  readonly navigableEntries: readonly PersistedGenerationRecordBundle[];
  readonly projectTitle?: string | null;
  readonly isSelectedForCompare: boolean;
  readonly isGenerationBusy: boolean;
  readonly onSelectEntry: (jobId: EntityId) => void;
  readonly onClose: () => void;
  readonly onToggleCompare: (jobId: EntityId) => void;
  readonly onRegenerate: (entry: PersistedGenerationRecordBundle) => void;
  readonly onCreateVariation: (entry: PersistedGenerationRecordBundle) => void;
}

const DEFAULT_CANVAS_BOX = { width: 880, height: 640 };

export function ArtworkPreviewWorkspace({
  open,
  entry,
  navigableEntries,
  projectTitle = null,
  isSelectedForCompare,
  isGenerationBusy,
  onSelectEntry,
  onClose,
  onToggleCompare,
  onRegenerate,
  onCreateVariation,
}: ArtworkPreviewWorkspaceProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const containerSizeRef = useRef<{ width: number; height: number }>(
    DEFAULT_CANVAS_BOX,
  );
  const dragSessionRef = useRef<{
    pointerId: number;
    lastX: number;
    lastY: number;
  } | null>(null);
  const lastEntryKeyRef = useRef<string>('');

  const [isDragging, setIsDragging] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<'inspect' | 'export'>('inspect');
  const [isPromptExpanded, setIsPromptExpanded] = useState(false);
  const [previewObjectUrl, setPreviewObjectUrl] = useState<string | null>(null);
  const [decodeStatus, setDecodeStatus] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >('idle');
  const [decodedDimensions, setDecodedDimensions] = useState<{
    readonly width: number;
    readonly height: number;
  } | null>(null);

  const intrinsicDims = useMemo(() => {
    if (!entry) {
      return { width: 1024, height: 1024 };
    }
    return resolveArtworkIntrinsicDimensions(
      entry.artwork,
      entry.job,
      decodedDimensions,
    );
  }, [entry, decodedDimensions]);

  const [transform, setTransform] = useState<ViewerTransformState>(() =>
    createFitViewState({
      containerWidth: DEFAULT_CANVAS_BOX.width,
      containerHeight: DEFAULT_CANVAS_BOX.height,
      imageWidth: intrinsicDims.width,
      imageHeight: intrinsicDims.height,
    }),
  );

  // Lock background document scroll while the workspace is active.
  useEffect(() => {
    if (!open) {
      return;
    }
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [open]);

  // Reset prompt inspection & decode state cleanly when switching artworks.
  useEffect(() => {
    if (!open || !entry) {
      setPreviewObjectUrl(null);
      setDecodeStatus('idle');
      setDecodedDimensions(null);
      setSidebarTab('inspect');
      dragSessionRef.current = null;
      setIsDragging(false);
      return;
    }

    setDecodedDimensions(null);
    dragSessionRef.current = null;
    setIsDragging(false);

    if (
      !entry.artwork ||
      !entry.imageBlob ||
      entry.blobMissingOrCorrupted ||
      entry.imageBlob.size <= 0
    ) {
      setPreviewObjectUrl(null);
      setDecodeStatus('error');
      return;
    }

    setDecodeStatus('loading');
    const objectUrl = URL.createObjectURL(entry.imageBlob);
    setPreviewObjectUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [open, entry]);

  const getDims = useCallback(
    (overrideSize?: { width: number; height: number }): ViewerDimensions => {
      const box = overrideSize ?? containerSizeRef.current;
      return {
        containerWidth: box.width,
        containerHeight: box.height,
        imageWidth: intrinsicDims.width,
        imageHeight: intrinsicDims.height,
      };
    },
    [intrinsicDims.width, intrinsicDims.height],
  );

  // Measure viewer container & reset to Fit when active artwork changes.
  useEffect(() => {
    if (!open || !entry) {
      lastEntryKeyRef.current = '';
      return;
    }
    const element = viewportRef.current;
    if (!element) {
      return;
    }

    const entryKey = `${entry.job.id}:${intrinsicDims.width}x${intrinsicDims.height}`;
    const isNewEntry = lastEntryKeyRef.current !== entryKey;
    lastEntryKeyRef.current = entryKey;

    const applyMeasuredSize = (
      width: number,
      height: number,
      resetToFit: boolean,
    ) => {
      if (width <= 0 || height <= 0) {
        return;
      }
      containerSizeRef.current = { width, height };
      const dims: ViewerDimensions = {
        containerWidth: width,
        containerHeight: height,
        imageWidth: intrinsicDims.width,
        imageHeight: intrinsicDims.height,
      };
      setTransform((prev) =>
        resetToFit
          ? createFitViewState(dims)
          : recalculateOnContainerResize(prev, dims),
      );
    };

    const rect = element.getBoundingClientRect();
    applyMeasuredSize(rect.width, rect.height, isNewEntry);

    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver((entries) => {
        for (const observed of entries) {
          applyMeasuredSize(
            observed.contentRect.width,
            observed.contentRect.height,
            false,
          );
        }
      });
      observer.observe(element);
      return () => {
        observer.disconnect();
      };
    }

    const handleWindowResize = () => {
      const nextRect = element.getBoundingClientRect();
      applyMeasuredSize(nextRect.width, nextRect.height, false);
    };
    window.addEventListener('resize', handleWindowResize);
    return () => {
      window.removeEventListener('resize', handleWindowResize);
    };
  }, [open, entry, intrinsicDims.width, intrinsicDims.height]);

  // Attach non-passive wheel zoom listener strictly scoped to the viewer canvas.
  useEffect(() => {
    if (!open || !entry) {
      return;
    }
    const element = viewportRef.current;
    if (!element) {
      return;
    }

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (decodeStatus === 'error') {
        return;
      }

      const rect = element.getBoundingClientRect();
      const cursorX = event.clientX - rect.left;
      const cursorY = event.clientY - rect.top;
      const dims: ViewerDimensions = {
        containerWidth: rect.width || containerSizeRef.current.width,
        containerHeight: rect.height || containerSizeRef.current.height,
        imageWidth: intrinsicDims.width,
        imageHeight: intrinsicDims.height,
      };

      setTransform((prev) => {
        const nextScale = wheelZoomScale(prev.scale, event.deltaY);
        if (Math.abs(nextScale - prev.scale) < 0.0001) {
          return prev;
        }
        return applyZoomAtPoint(prev, dims, nextScale, cursorX, cursorY);
      });
    };

    element.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      element.removeEventListener('wheel', handleWheel);
    };
  }, [open, entry, decodeStatus, intrinsicDims.width, intrinsicDims.height]);

  const handleZoomIn = useCallback(() => {
    setTransform((prev) =>
      applyZoomAtPoint(prev, getDims(), stepZoomScale(prev.scale, 'in')),
    );
  }, [getDims]);

  const handleZoomOut = useCallback(() => {
    setTransform((prev) =>
      applyZoomAtPoint(prev, getDims(), stepZoomScale(prev.scale, 'out')),
    );
  }, [getDims]);

  const handleFitToScreen = useCallback(() => {
    setTransform(createFitViewState(getDims()));
  }, [getDims]);

  const handleActualSize = useCallback(() => {
    setTransform((prev) => applyActualSizeViewState(getDims(), prev.fitScale));
  }, [getDims]);

  const handleResetPosition = useCallback(() => {
    setTransform((prev) => resetPreviewPosition(prev, getDims()));
  }, [getDims]);

  const endDrag = useCallback((pointerId?: number) => {
    const element = viewportRef.current;
    if (
      element &&
      pointerId !== undefined &&
      typeof element.hasPointerCapture === 'function' &&
      element.hasPointerCapture(pointerId)
    ) {
      try {
        element.releasePointerCapture(pointerId);
      } catch {
        // Ignore if pointer capture already released.
      }
    }
    dragSessionRef.current = null;
    setIsDragging(false);
  }, []);

  const navState = useMemo(
    () =>
      getPreviewNavigationState(navigableEntries, entry ? entry.job.id : null),
    [navigableEntries, entry],
  );

  // Global keyboard shortcuts while Preview Workspace is open.
  useEffect(() => {
    if (!open || !entry) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTextControl =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if (event.key === 'Escape') {
        event.preventDefault();
        if (dragSessionRef.current) {
          endDrag(dragSessionRef.current.pointerId);
        } else {
          onClose();
        }
        return;
      }

      if (isTextControl) {
        return;
      }

      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        handleZoomIn();
        return;
      }
      if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        handleZoomOut();
        return;
      }
      if (event.key === '0') {
        event.preventDefault();
        handleFitToScreen();
        return;
      }
      if (event.key === '1') {
        event.preventDefault();
        handleActualSize();
        return;
      }
      if (event.key === 'ArrowLeft' && navState.previousEntry) {
        event.preventDefault();
        onSelectEntry(navState.previousEntry.job.id);
        return;
      }
      if (event.key === 'ArrowRight' && navState.nextEntry) {
        event.preventDefault();
        onSelectEntry(navState.nextEntry.job.id);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    open,
    entry,
    navState,
    onClose,
    onSelectEntry,
    endDrag,
    handleZoomIn,
    handleZoomOut,
    handleFitToScreen,
    handleActualSize,
  ]);

  if (!open || !entry) {
    return null;
  }

  const metadata = buildArtworkPreviewMetadata(entry, { projectTitle });
  const promptSnapshot = extractHistoricalPromptSnapshot(entry);
  const dims = getDims();
  const hasImageReady =
    Boolean(previewObjectUrl) &&
    !entry.blobMissingOrCorrupted &&
    decodeStatus !== 'error';
  const pannable = hasImageReady && isImagePannable(dims, transform.scale);
  const canResetPosition =
    hasImageReady && hasPreviewPanOffset(transform, dims);

  const canZoomIn =
    hasImageReady && transform.scale < MAX_VIEWER_SCALE - 0.001;
  const canZoomOut =
    hasImageReady && transform.scale > MIN_VIEWER_SCALE + 0.001;
  const zoomLabel = formatZoomPercent(transform.scale);

  const canCompare =
    entry.artwork !== null && entry.job.status === 'completed';
  const canRegenerate =
    entry.promptDocument?.approvalStatus === 'approved';
  const canCreateVariation =
    entry.artwork !== null &&
    entry.job.status === 'completed' &&
    entry.promptDocument?.approvalStatus === 'approved';

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !pannable) {
      return;
    }
    event.preventDefault();
    const element = viewportRef.current;
    if (element && typeof element.setPointerCapture === 'function') {
      try {
        element.setPointerCapture(event.pointerId);
      } catch {
        // Ignore synthetic pointer events without an active pointer.
      }
    }
    dragSessionRef.current = {
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
    };
    setIsDragging(true);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const session = dragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    const deltaX = event.clientX - session.lastX;
    const deltaY = event.clientY - session.lastY;
    session.lastX = event.clientX;
    session.lastY = event.clientY;

    if (deltaX === 0 && deltaY === 0) {
      return;
    }
    setTransform((prev) => applyPanDelta(prev, getDims(), deltaX, deltaY));
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragSessionRef.current?.pointerId === event.pointerId) {
      endDrag(event.pointerId);
    }
  };

  const handlePointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragSessionRef.current?.pointerId === event.pointerId) {
      endDrag(event.pointerId);
    }
  };

  const handleImageLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget;
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      setDecodedDimensions({
        width: img.naturalWidth,
        height: img.naturalHeight,
      });
    }
    setDecodeStatus('ready');
  };

  const handleImageError = () => {
    setDecodeStatus('error');
  };

  const kindTone =
    metadata.generationKind === 'variation'
      ? 'accent'
      : metadata.generationKind === 'regeneration'
        ? 'info'
        : 'primary';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="artwork-preview-title"
      data-testid="artwork-preview-workspace"
      className="fixed inset-0 z-50 flex flex-col overscroll-none bg-[var(--ff-color-background)] text-[var(--ff-color-foreground)]"
    >
      {/* Top Studio Header Bar */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--ff-color-border)] bg-[var(--ff-color-surface)] px-4 py-2.5 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            leftIcon={<ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />}
            onClick={onClose}
            data-testid="preview-close-btn"
          >
            Close Preview
          </Button>

          <span
            className="hidden h-5 w-px bg-[var(--ff-color-border)] sm:inline-block"
            aria-hidden="true"
          />

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Typography
                id="artwork-preview-title"
                variant="h3"
                className="truncate text-[15px]"
              >
                {metadata.artworkName}
              </Typography>
              <Badge tone={kindTone}>{metadata.generationTypeLabel}</Badge>
              <Badge
                tone={
                  metadata.status === 'completed' ? 'success' : 'destructive'
                }
              >
                {metadata.statusLabel}
              </Badge>
            </div>
          </div>
        </div>

        {/* Navigation Between Generated Artworks */}
        <nav
          aria-label="Study artwork navigation"
          className="flex items-center gap-2"
        >
          {navState.totalCount > 0 ? (
            <span
              data-testid="preview-nav-counter"
              className="mr-1 text-[12px] font-medium text-[var(--ff-color-muted-foreground)] tabular-nums"
            >
              Artwork {navState.currentIndex + 1} of {navState.totalCount}
            </span>
          ) : null}

          <Button
            type="button"
            variant="outline"
            size="sm"
            leftIcon={<ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />}
            disabled={!navState.hasPrevious}
            onClick={() => {
              if (navState.previousEntry) {
                onSelectEntry(navState.previousEntry.job.id);
              }
            }}
            data-testid="preview-prev-btn"
          >
            Previous
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            rightIcon={
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            }
            disabled={!navState.hasNext}
            onClick={() => {
              if (navState.nextEntry) {
                onSelectEntry(navState.nextEntry.job.id);
              }
            }}
            data-testid="preview-next-btn"
          >
            Next
          </Button>

          <span
            className="mx-1 hidden h-5 w-px bg-[var(--ff-color-border)] sm:inline-block"
            aria-hidden="true"
          />

          <Button
            type="button"
            variant={sidebarTab === 'export' ? 'primary' : 'outline'}
            size="sm"
            leftIcon={<Download className="h-3.5 w-3.5" aria-hidden="true" />}
            onClick={() =>
              setSidebarTab((prev) =>
                prev === 'export' ? 'inspect' : 'export',
              )
            }
            data-testid="preview-open-export-btn"
          >
            Export Artwork
          </Button>
        </nav>
      </header>

      {/* Main Split Workspace */}
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_380px] lg:overflow-hidden">
        {/* Left: Artwork Viewer & Zoom/Pan Controls */}
        <section
          aria-label="Artwork inspection canvas"
          className="flex min-h-[420px] flex-col lg:min-h-0"
        >
          {/* Zoom & Pan Control Toolbar */}
          <div
            role="toolbar"
            aria-label="Artwork zoom and position controls"
            data-testid="artwork-viewer-toolbar"
            className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ff-color-border)] bg-[var(--ff-color-surface)] px-4 py-2"
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <Tooltip content="Zoom out (-)" side="bottom">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label="Zoom out"
                  disabled={!canZoomOut}
                  onClick={handleZoomOut}
                  className="w-8 px-0"
                  data-testid="artwork-zoom-out-btn"
                >
                  <Minus className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </Tooltip>

              <span
                data-testid="artwork-zoom-percent"
                aria-live="polite"
                className="inline-flex min-w-[56px] items-center justify-center px-1.5 text-[13px] font-medium text-[var(--ff-color-foreground)] tabular-nums"
              >
                {hasImageReady ? zoomLabel : '—'}
              </span>

              <Tooltip content="Zoom in (+)" side="bottom">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label="Zoom in"
                  disabled={!canZoomIn}
                  onClick={handleZoomIn}
                  className="w-8 px-0"
                  data-testid="artwork-zoom-in-btn"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </Tooltip>

              <span
                className="mx-1 h-4 w-px bg-[var(--ff-color-border)]"
                aria-hidden="true"
              />

              <Tooltip content="Fit to screen (0)" side="bottom">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  pressed={hasImageReady && transform.viewMode === 'fit'}
                  disabled={!hasImageReady}
                  aria-label="Fit to screen"
                  leftIcon={<Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />}
                  onClick={handleFitToScreen}
                  data-testid="artwork-zoom-fit-btn"
                >
                  Fit
                </Button>
              </Tooltip>

              <Tooltip content="Reset zoom to 100% (1)" side="bottom">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  pressed={hasImageReady && transform.viewMode === 'actual'}
                  disabled={!hasImageReady}
                  aria-label="Zoom to 100%"
                  onClick={handleActualSize}
                  className="tabular-nums"
                  data-testid="artwork-zoom-100-btn"
                >
                  100%
                </Button>
              </Tooltip>

              <Tooltip content="Center artwork position at current zoom" side="bottom">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={!hasImageReady || !canResetPosition}
                  aria-label="Reset position"
                  leftIcon={<Move className="h-3.5 w-3.5" aria-hidden="true" />}
                  onClick={handleResetPosition}
                  data-testid="artwork-reset-position-btn"
                >
                  Reset Position
                </Button>
              </Tooltip>
            </div>

            <div className="hidden items-center gap-3 text-[12px] text-[var(--ff-color-muted-foreground)] xl:flex">
              {canResetPosition ? (
                <span className="font-medium text-[var(--ff-color-primary)]">
                  Panned
                </span>
              ) : null}
              <span>Scroll to zoom · Drag to pan when zoomed</span>
            </div>
          </div>

          {/* Neutral Artwork Canvas Container */}
          <div
            ref={viewportRef}
            tabIndex={0}
            role="region"
            aria-label="Generated artwork full-resolution canvas"
            data-testid="artwork-preview-canvas"
            data-view-mode={transform.viewMode}
            data-pannable={pannable ? 'true' : 'false'}
            data-dragging={isDragging ? 'true' : 'false'}
            data-has-pan-offset={canResetPosition ? 'true' : 'false'}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onLostPointerCapture={(e) => endDrag(e.pointerId)}
            className={cn(
              'relative flex-1 overflow-hidden overscroll-contain touch-none select-none bg-[#EDEAE2] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--ff-color-primary)]',
              isDragging
                ? 'cursor-grabbing'
                : pannable
                  ? 'cursor-grab'
                  : 'cursor-default',
            )}
          >
            {entry.blobMissingOrCorrupted ||
            !entry.artwork ||
            !entry.imageBlob ||
            decodeStatus === 'error' ? (
              <div
                className="flex h-full w-full items-center justify-center p-6"
                data-testid="artwork-preview-error"
              >
                <div className="max-w-md rounded-[var(--ff-radius-md)] border border-[var(--ff-color-border)] bg-[var(--ff-color-surface)] p-6 text-center">
                  <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-[var(--ff-radius-md)] bg-[var(--ff-color-warning-subtle)] text-[var(--ff-color-warning)]">
                    {entry.job.status === 'failed' ? (
                      <ImageOff className="h-5 w-5" aria-hidden="true" />
                    ) : (
                      <AlertTriangle className="h-5 w-5" aria-hidden="true" />
                    )}
                  </div>
                  <Typography variant="h3" className="mt-3">
                    {entry.job.status === 'failed'
                      ? 'Generation Did Not Produce an Artwork'
                      : 'Artwork Image Unavailable'}
                  </Typography>
                  <Typography variant="body-sm" muted className="mt-1.5">
                    {entry.blobErrorMessage ??
                      (entry.job.status === 'failed'
                        ? entry.job.errorMessage ??
                          'This generation attempt failed before an image was saved.'
                        : 'The stored image binary is missing or could not be decoded from local IndexedDB storage. Metadata and historical prompt records remain intact.')}
                  </Typography>
                </div>
              </div>
            ) : (
              <>
                <div
                  data-testid="artwork-preview-stage"
                  style={{
                    width: `${intrinsicDims.width}px`,
                    height: `${intrinsicDims.height}px`,
                    transform: `translate3d(${transform.translateX}px, ${transform.translateY}px, 0) scale(${transform.scale})`,
                    transformOrigin: '0 0',
                  }}
                  className="absolute left-0 top-0 bg-white shadow-[0_12px_36px_rgba(23,25,30,0.12)] will-change-transform"
                >
                  {previewObjectUrl ? (
                    <img
                      src={previewObjectUrl}
                      alt={`${metadata.artworkName} (${metadata.outputDimensions})`}
                      data-testid="artwork-preview-image"
                      draggable={false}
                      decoding="async"
                      onLoad={handleImageLoad}
                      onError={handleImageError}
                      onDragStart={(e) => e.preventDefault()}
                      className="pointer-events-none block h-full w-full max-h-none max-w-none select-none object-contain"
                    />
                  ) : null}
                </div>

                {decodeStatus === 'loading' ? (
                  <div
                    data-testid="artwork-preview-loading"
                    className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[#EDEAE2]/80"
                  >
                    <div className="flex items-center gap-2 rounded-[var(--ff-radius-md)] border border-[var(--ff-color-border)] bg-[var(--ff-color-surface)] px-3.5 py-2 text-[13px] font-medium text-[var(--ff-color-foreground)]">
                      <Loader2
                        className="h-4 w-4 animate-spin text-[var(--ff-color-primary)]"
                        aria-hidden="true"
                      />
                      <span>Loading full-resolution artwork...</span>
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </section>

        {/* Right: Artwork Information / Export Workspace Panel */}
        <aside
          aria-label="Artwork details, prompt inspection, and export"
          className="flex flex-col justify-between gap-6 border-t border-[var(--ff-color-border)] bg-[var(--ff-color-surface)] p-5 lg:overflow-y-auto lg:border-l lg:border-t-0"
        >
          <div className="space-y-5">
            {/* Clean Two-Mode Panel Switcher */}
            <div
              role="tablist"
              aria-label="Artwork workspace panel mode"
              className="grid grid-cols-2 gap-1 rounded-[var(--ff-radius-md)] border border-[var(--ff-color-border)] bg-[var(--ff-color-surface-elevated)] p-1"
            >
              <button
                type="button"
                role="tab"
                aria-selected={sidebarTab === 'inspect'}
                onClick={() => setSidebarTab('inspect')}
                data-testid="preview-tab-inspect"
                className={cn(
                  'rounded-[var(--ff-radius-sm)] px-3 py-1.5 text-[12px] font-medium transition-colors cursor-pointer',
                  sidebarTab === 'inspect'
                    ? 'bg-[var(--ff-color-surface)] text-[var(--ff-color-foreground)] shadow-xs'
                    : 'text-[var(--ff-color-muted-foreground)] hover:text-[var(--ff-color-foreground)]',
                )}
              >
                Inspect Details
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={sidebarTab === 'export'}
                onClick={() => setSidebarTab('export')}
                data-testid="preview-tab-export"
                className={cn(
                  'rounded-[var(--ff-radius-sm)] px-3 py-1.5 text-[12px] font-medium transition-colors cursor-pointer',
                  sidebarTab === 'export'
                    ? 'bg-[var(--ff-color-surface)] text-[var(--ff-color-foreground)] shadow-xs'
                    : 'text-[var(--ff-color-muted-foreground)] hover:text-[var(--ff-color-foreground)]',
                )}
              >
                Export Settings
              </button>
            </div>

            {sidebarTab === 'export' ? (
              <ArtworkExportPanel
                entry={entry}
                previewObjectUrl={previewObjectUrl}
                hasImageReady={hasImageReady}
                intrinsicWidth={intrinsicDims.width}
                intrinsicHeight={intrinsicDims.height}
              />
            ) : (
              <>
                {/* Artwork Information */}
            <section
              aria-labelledby="preview-info-heading"
              data-testid="artwork-info-panel"
              className="space-y-3"
            >
              <Typography id="preview-info-heading" variant="h3">
                Artwork Information
              </Typography>

              <dl className="divide-y divide-[var(--ff-color-border)] border-y border-[var(--ff-color-border)] text-[12px]">
                <div className="flex items-start justify-between gap-3 py-2">
                  <dt className="shrink-0 text-[var(--ff-color-muted-foreground)]">
                    Artwork Name
                  </dt>
                  <dd
                    className="text-right font-medium text-[var(--ff-color-foreground)]"
                    data-testid="preview-meta-name"
                  >
                    {metadata.artworkName}
                  </dd>
                </div>

                <div className="flex items-center justify-between gap-3 py-2">
                  <dt className="shrink-0 text-[var(--ff-color-muted-foreground)]">
                    Generation ID
                  </dt>
                  <dd
                    className="truncate text-right font-mono text-[11px] text-[var(--ff-color-foreground)]"
                    title={metadata.generationId}
                    data-testid="preview-meta-generation-id"
                  >
                    {metadata.generationId}
                  </dd>
                </div>

                <div className="flex items-center justify-between gap-3 py-2">
                  <dt className="shrink-0 text-[var(--ff-color-muted-foreground)]">
                    Generation Type
                  </dt>
                  <dd
                    className="text-right font-medium text-[var(--ff-color-foreground)]"
                    data-testid="preview-meta-type"
                  >
                    {metadata.generationTypeLabel}
                  </dd>
                </div>

                <div className="flex items-center justify-between gap-3 py-2">
                  <dt className="shrink-0 text-[var(--ff-color-muted-foreground)]">
                    Provider
                  </dt>
                  <dd
                    className="text-right font-mono text-[11px] text-[var(--ff-color-foreground)]"
                    data-testid="preview-meta-provider"
                  >
                    {metadata.providerId}
                  </dd>
                </div>

                <div className="flex items-center justify-between gap-3 py-2">
                  <dt className="shrink-0 text-[var(--ff-color-muted-foreground)]">
                    Model
                  </dt>
                  <dd
                    className="truncate text-right font-mono text-[11px] text-[var(--ff-color-foreground)]"
                    title={metadata.modelId}
                    data-testid="preview-meta-model"
                  >
                    {metadata.modelId}
                  </dd>
                </div>

                <div className="flex items-center justify-between gap-3 py-2">
                  <dt className="shrink-0 text-[var(--ff-color-muted-foreground)]">
                    Prompt Reference
                  </dt>
                  <dd
                    className="truncate text-right font-mono text-[11px] text-[var(--ff-color-foreground)]"
                    title={metadata.originalPromptReference}
                    data-testid="preview-meta-prompt-ref"
                  >
                    {metadata.originalPromptReference}
                  </dd>
                </div>

                {metadata.parentGenerationId ? (
                  <div className="flex items-center justify-between gap-3 py-2">
                    <dt className="shrink-0 text-[var(--ff-color-muted-foreground)]">
                      Parent Generation ID
                    </dt>
                    <dd
                      className="truncate text-right font-mono text-[11px] text-[var(--ff-color-foreground)]"
                      title={metadata.parentGenerationId}
                      data-testid="preview-meta-parent-id"
                    >
                      {metadata.parentGenerationId}
                    </dd>
                  </div>
                ) : null}

                {metadata.parentPromptReference ? (
                  <div className="flex items-center justify-between gap-3 py-2">
                    <dt className="shrink-0 text-[var(--ff-color-muted-foreground)]">
                      Parent Prompt Ref
                    </dt>
                    <dd
                      className="truncate text-right font-mono text-[11px] text-[var(--ff-color-foreground)]"
                      title={metadata.parentPromptReference}
                    >
                      {metadata.parentPromptReference}
                    </dd>
                  </div>
                ) : null}

                <div className="flex items-center justify-between gap-3 py-2">
                  <dt className="shrink-0 text-[var(--ff-color-muted-foreground)]">
                    Output Dimensions
                  </dt>
                  <dd
                    className="text-right font-medium tabular-nums text-[var(--ff-color-foreground)]"
                    data-testid="preview-meta-dimensions"
                  >
                    {metadata.outputDimensions}
                  </dd>
                </div>

                <div className="flex items-center justify-between gap-3 py-2">
                  <dt className="shrink-0 text-[var(--ff-color-muted-foreground)]">
                    Aspect Ratio
                  </dt>
                  <dd
                    className="text-right tabular-nums text-[var(--ff-color-foreground)]"
                    data-testid="preview-meta-aspect-ratio"
                  >
                    {metadata.aspectRatio}
                  </dd>
                </div>

                <div className="flex items-center justify-between gap-3 py-2">
                  <dt className="shrink-0 text-[var(--ff-color-muted-foreground)]">
                    Image Format
                  </dt>
                  <dd
                    className="text-right font-mono text-[11px] text-[var(--ff-color-foreground)]"
                    data-testid="preview-meta-format"
                  >
                    {metadata.imageFormat}
                  </dd>
                </div>

                <div className="flex items-center justify-between gap-3 py-2">
                  <dt className="shrink-0 text-[var(--ff-color-muted-foreground)]">
                    File Size
                  </dt>
                  <dd
                    className="text-right font-medium tabular-nums text-[var(--ff-color-foreground)]"
                    data-testid="preview-meta-file-size"
                  >
                    {metadata.fileSize}
                  </dd>
                </div>

                <div className="flex items-center justify-between gap-3 py-2">
                  <dt className="shrink-0 text-[var(--ff-color-muted-foreground)]">
                    Created
                  </dt>
                  <dd
                    className="text-right tabular-nums text-[var(--ff-color-foreground)]"
                    data-testid="preview-meta-created-at"
                  >
                    {metadata.createdAtDisplay}
                  </dd>
                </div>

                <div className="flex items-center justify-between gap-3 py-2">
                  <dt className="shrink-0 text-[var(--ff-color-muted-foreground)]">
                    Status
                  </dt>
                  <dd
                    className="text-right font-medium text-[var(--ff-color-foreground)]"
                    data-testid="preview-meta-status"
                  >
                    {metadata.statusLabel}
                  </dd>
                </div>
              </dl>
            </section>

            {/* Collapsible Prompt Inspection */}
            <section
              aria-labelledby="preview-prompt-heading"
              data-testid="preview-prompt-inspection"
              className="rounded-[var(--ff-radius-md)] border border-[var(--ff-color-border)] bg-[var(--ff-color-surface-elevated)]"
            >
              <button
                type="button"
                aria-expanded={isPromptExpanded}
                aria-controls="preview-prompt-content"
                onClick={() => setIsPromptExpanded((prev) => !prev)}
                data-testid="preview-prompt-toggle"
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--ff-color-surface)] cursor-pointer rounded-[var(--ff-radius-md)]"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Sparkles
                    className="h-4 w-4 shrink-0 text-[var(--ff-color-primary)]"
                    aria-hidden="true"
                  />
                  <span
                    id="preview-prompt-heading"
                    className="text-[13px] font-semibold text-[var(--ff-color-foreground)]"
                  >
                    Prompt Inspection
                  </span>
                  <span className="font-mono text-[11px] text-[var(--ff-color-muted-foreground)] tabular-nums">
                    {promptSnapshot.revisionLabel}
                  </span>
                </div>
                <ChevronDown
                  className={cn(
                    'h-4 w-4 shrink-0 text-[var(--ff-color-muted-foreground)] transition-transform duration-150',
                    isPromptExpanded ? 'rotate-180' : '',
                  )}
                  aria-hidden="true"
                />
              </button>

              {isPromptExpanded ? (
                <div
                  id="preview-prompt-content"
                  data-testid="preview-prompt-body"
                  className="space-y-3 border-t border-[var(--ff-color-border)] px-4 py-3.5 text-[13px]"
                >
                  <Typography variant="caption" muted className="block">
                    Historical prompt snapshot recorded at generation time (read-only).
                  </Typography>

                  {!promptSnapshot.hasPromptSnapshot ? (
                    <Alert
                      tone="warning"
                      title="Prompt snapshot missing"
                      description="The persisted prompt record referenced by this generation could not be located in IndexedDB."
                    />
                  ) : (
                    <>
                      {promptSnapshot.isVariation &&
                      promptSnapshot.variationInstructions ? (
                        <div className="rounded-[var(--ff-radius-sm)] border border-[var(--ff-color-border)] bg-[var(--ff-color-surface)] p-3">
                          <Typography variant="caption" muted className="mb-1 block">
                            Variation Instructions
                          </Typography>
                          <p
                            className="whitespace-pre-wrap text-[12px] leading-relaxed text-[var(--ff-color-foreground)]"
                            data-testid="preview-variation-instructions"
                          >
                            {promptSnapshot.variationInstructions}
                          </p>
                        </div>
                      ) : null}

                      <div className="rounded-[var(--ff-radius-sm)] border border-[var(--ff-color-border)] bg-[var(--ff-color-surface)] p-3">
                        <Typography variant="caption" muted className="mb-1 block">
                          {promptSnapshot.primaryPromptLabel}
                        </Typography>
                        <p
                          className="whitespace-pre-wrap text-[12px] leading-relaxed text-[var(--ff-color-foreground)]"
                          data-testid="preview-historical-prompt"
                        >
                          {promptSnapshot.primaryPromptText ??
                            'Prompt text unavailable.'}
                        </p>
                      </div>

                      {promptSnapshot.parentPromptText ? (
                        <div className="rounded-[var(--ff-radius-sm)] border border-[var(--ff-color-border)] bg-[var(--ff-color-surface)] p-3">
                          <Typography variant="caption" muted className="mb-1 block">
                            {promptSnapshot.parentPromptLabel}
                          </Typography>
                          <p
                            className="whitespace-pre-wrap text-[12px] leading-relaxed text-[var(--ff-color-muted-foreground)]"
                            data-testid="preview-parent-prompt"
                          >
                            {promptSnapshot.parentPromptText}
                          </p>
                        </div>
                      ) : null}

                      {promptSnapshot.negativePromptText ? (
                        <div className="rounded-[var(--ff-radius-sm)] border border-[var(--ff-color-border)] bg-[var(--ff-color-surface)] p-3">
                          <Typography variant="caption" muted className="mb-1 block">
                            Negative Prompt Exclusions
                          </Typography>
                          <p
                            className="whitespace-pre-wrap text-[12px] leading-relaxed text-[var(--ff-color-muted-foreground)]"
                            data-testid="preview-negative-prompt"
                          >
                            {promptSnapshot.negativePromptText}
                          </p>
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              ) : null}
            </section>
              </>
            )}
          </div>

          {/* Workflow Context Actions (Preserving Existing History Capabilities) */}
          <div className="border-t border-[var(--ff-color-border)] pt-4">
            <Typography variant="caption" muted className="mb-2.5 block">
              Generation History Actions
            </Typography>
            <div className="flex flex-wrap items-center gap-2">
              {canCompare ? (
                <Button
                  type="button"
                  variant={isSelectedForCompare ? 'secondary' : 'outline'}
                  size="sm"
                  leftIcon={<CopyCheck className="h-3.5 w-3.5" aria-hidden="true" />}
                  onClick={() => onToggleCompare(entry.job.id)}
                  data-testid="preview-compare-btn"
                >
                  {isSelectedForCompare ? 'Selected for Compare' : 'Compare'}
                </Button>
              ) : null}

              <Button
                type="button"
                variant="outline"
                size="sm"
                leftIcon={<RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
                disabled={!canRegenerate || isGenerationBusy}
                onClick={() => onRegenerate(entry)}
                data-testid="preview-regenerate-btn"
              >
                Regenerate
              </Button>

              {canCreateVariation ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  leftIcon={<GitBranch className="h-3.5 w-3.5" aria-hidden="true" />}
                  disabled={isGenerationBusy}
                  onClick={() => onCreateVariation(entry)}
                  data-testid="preview-variation-btn"
                >
                  Create Variation
                </Button>
              ) : null}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

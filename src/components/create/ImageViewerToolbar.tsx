import { Maximize2, Minus, Plus, RotateCcw } from 'lucide-react';
import {
  formatZoomPercent,
  MAX_VIEWER_SCALE,
  MIN_VIEWER_SCALE,
  type ViewerMode,
} from '../../services/source-asset/viewerTransform.ts';
import { Button, Tooltip, Typography } from '../ui/index.ts';

export interface ImageViewerToolbarProps {
  readonly scale: number;
  readonly viewMode: ViewerMode;
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
  readonly onFitToScreen: () => void;
  readonly onActualSize: () => void;
  readonly onResetView: () => void;
}

export function ImageViewerToolbar({
  scale,
  viewMode,
  onZoomIn,
  onZoomOut,
  onFitToScreen,
  onActualSize,
  onResetView,
}: ImageViewerToolbarProps) {
  const canZoomIn = scale < MAX_VIEWER_SCALE - 0.001;
  const canZoomOut = scale > MIN_VIEWER_SCALE + 0.001;
  const zoomLabel = formatZoomPercent(scale);

  return (
    <div
      role="toolbar"
      aria-label="Image viewer controls"
      className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--ff-color-border)] bg-[var(--ff-color-surface)] px-4 py-2.5"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Tooltip content="Zoom out (-)" side="bottom">
          <Button
            variant="outline"
            size="sm"
            aria-label="Zoom out"
            disabled={!canZoomOut}
            onClick={onZoomOut}
            className="w-8 px-0"
          >
            <Minus className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </Tooltip>

        <span
          data-testid="viewer-zoom-percent"
          aria-live="polite"
          className="inline-flex min-w-[56px] items-center justify-center px-1.5 text-[13px] font-medium text-[var(--ff-color-foreground)] tabular-nums"
        >
          {zoomLabel}
        </span>

        <Tooltip content="Zoom in (+)" side="bottom">
          <Button
            variant="outline"
            size="sm"
            aria-label="Zoom in"
            disabled={!canZoomIn}
            onClick={onZoomIn}
            className="w-8 px-0"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </Tooltip>

        <span
          className="mx-1.5 h-4 w-px bg-[var(--ff-color-border)]"
          aria-hidden="true"
        />

        <Tooltip content="Fit to screen (0)" side="bottom">
          <Button
            variant="outline"
            size="sm"
            pressed={viewMode === 'fit'}
            aria-label="Fit to screen"
            leftIcon={<Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />}
            onClick={onFitToScreen}
          >
            Fit
          </Button>
        </Tooltip>

        <Tooltip content="Actual size 100% (1)" side="bottom">
          <Button
            variant="outline"
            size="sm"
            pressed={viewMode === 'actual'}
            aria-label="Actual size (100%)"
            onClick={onActualSize}
            className="tabular-nums"
          >
            100%
          </Button>
        </Tooltip>

        <Tooltip content="Reset view" side="bottom">
          <Button
            variant="ghost"
            size="sm"
            aria-label="Reset view"
            leftIcon={<RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />}
            onClick={onResetView}
          >
            Reset
          </Button>
        </Tooltip>
      </div>

      <Typography
        variant="caption"
        muted
        className="hidden xl:inline whitespace-nowrap"
      >
        Scroll to zoom · Drag to pan when zoomed
      </Typography>
    </div>
  );
}

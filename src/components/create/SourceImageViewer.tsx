import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  applyActualSizeViewState,
  applyPanDelta,
  applyZoomAtPoint,
  createFitViewState,
  isImagePannable,
  recalculateOnContainerResize,
  stepZoomScale,
  wheelZoomScale,
  type ViewerDimensions,
  type ViewerTransformState,
} from '../../services/source-asset/viewerTransform.ts';
import type { EntityId } from '../../types/common.ts';
import { Typography, cn } from '../ui/index.ts';
import { ImageViewerToolbar } from './ImageViewerToolbar.tsx';

export interface SourceImageViewerProps {
  readonly assetId: EntityId;
  readonly src: string;
  readonly alt: string;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly isDragReplaceActive?: boolean;
  readonly onImageLoadError?: () => void;
}

const DEFAULT_FALLBACK_BOX = { width: 760, height: 480 };

export function SourceImageViewer({
  assetId,
  src,
  alt,
  naturalWidth,
  naturalHeight,
  isDragReplaceActive = false,
  onImageLoadError,
}: SourceImageViewerProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const containerSizeRef = useRef<{ width: number; height: number }>(
    DEFAULT_FALLBACK_BOX,
  );
  const dragSessionRef = useRef<{
    pointerId: number;
    lastX: number;
    lastY: number;
  } | null>(null);
  const lastAssetKeyRef = useRef<string>('');

  const [isDragging, setIsDragging] = useState(false);
  const [transform, setTransform] = useState<ViewerTransformState>(() =>
    createFitViewState({
      containerWidth: DEFAULT_FALLBACK_BOX.width,
      containerHeight: DEFAULT_FALLBACK_BOX.height,
      imageWidth: naturalWidth,
      imageHeight: naturalHeight,
    }),
  );

  const getDims = useCallback(
    (overrideSize?: { width: number; height: number }): ViewerDimensions => {
      const box = overrideSize ?? containerSizeRef.current;
      return {
        containerWidth: box.width,
        containerHeight: box.height,
        imageWidth: naturalWidth,
        imageHeight: naturalHeight,
      };
    },
    [naturalWidth, naturalHeight],
  );

  // Measure container via ResizeObserver & reset to Fit when image changes
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) {
      return;
    }

    const assetKey = `${assetId}:${src}`;
    const isNewAsset = lastAssetKeyRef.current !== assetKey;
    lastAssetKeyRef.current = assetKey;

    const applyMeasuredSize = (width: number, height: number, resetToFit: boolean) => {
      if (width <= 0 || height <= 0) {
        return;
      }
      containerSizeRef.current = { width, height };
      const dims: ViewerDimensions = {
        containerWidth: width,
        containerHeight: height,
        imageWidth: naturalWidth,
        imageHeight: naturalHeight,
      };
      setTransform((prev) =>
        resetToFit
          ? createFitViewState(dims)
          : recalculateOnContainerResize(prev, dims),
      );
    };

    const rect = element.getBoundingClientRect();
    applyMeasuredSize(rect.width, rect.height, isNewAsset);

    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect;
          applyMeasuredSize(width, height, false);
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
  }, [assetId, src, naturalWidth, naturalHeight]);

  // Attach non-passive wheel listener strictly scoped to the viewer viewport
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) {
      return;
    }

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();

      const rect = element.getBoundingClientRect();
      const cursorX = event.clientX - rect.left;
      const cursorY = event.clientY - rect.top;
      const dims: ViewerDimensions = {
        containerWidth: rect.width || containerSizeRef.current.width,
        containerHeight: rect.height || containerSizeRef.current.height,
        imageWidth: naturalWidth,
        imageHeight: naturalHeight,
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
  }, [naturalWidth, naturalHeight]);

  // Clear drag state if asset changes or component unmounts
  useEffect(() => {
    dragSessionRef.current = null;
    setIsDragging(false);
    return () => {
      dragSessionRef.current = null;
    };
  }, [assetId, src]);

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

  const handleResetView = useCallback(() => {
    setTransform(createFitViewState(getDims()));
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

  const dims = getDims();
  const pannable = isImagePannable(dims, transform.scale);

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
        // Ignore synthetic pointer events without active pointerId.
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

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable)
    ) {
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
    if (event.key === 'Escape') {
      if (dragSessionRef.current) {
        event.preventDefault();
        endDrag(dragSessionRef.current.pointerId);
      } else if (document.activeElement === viewportRef.current) {
        viewportRef.current?.blur();
      }
    }
  };

  return (
    <div
      className={cn(
        'overflow-hidden rounded-[var(--ff-radius-md)] border transition-colors duration-150',
        isDragReplaceActive
          ? 'border-dashed border-[var(--ff-color-primary)]'
          : 'border-[var(--ff-color-border)]',
      )}
    >
      <ImageViewerToolbar
        scale={transform.scale}
        viewMode={transform.viewMode}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onFitToScreen={handleFitToScreen}
        onActualSize={handleActualSize}
        onResetView={handleResetView}
      />

      <div
        ref={viewportRef}
        tabIndex={0}
        role="region"
        aria-label="Source image preview canvas. Use + or - to zoom, 0 to fit, 1 for actual size, or drag to pan when zoomed."
        data-testid="source-image-viewer"
        data-view-mode={transform.viewMode}
        data-pannable={pannable ? 'true' : 'false'}
        data-dragging={isDragging ? 'true' : 'false'}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onLostPointerCapture={(e) => endDrag(e.pointerId)}
        className={cn(
          'relative h-[clamp(380px,54vh,580px)] w-full overflow-hidden select-none bg-[var(--ff-color-surface-elevated)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--ff-color-primary)]',
          isDragging
            ? 'cursor-grabbing'
            : pannable
              ? 'cursor-grab'
              : 'cursor-default',
        )}
      >
        <div
          data-testid="source-image-stage"
          style={{
            width: `${naturalWidth}px`,
            height: `${naturalHeight}px`,
            transform: `translate3d(${transform.translateX}px, ${transform.translateY}px, 0) scale(${transform.scale})`,
            transformOrigin: '0 0',
            backgroundImage:
              'linear-gradient(45deg, #EAE6DC 25%, transparent 25%), linear-gradient(-45deg, #EAE6DC 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #EAE6DC 75%), linear-gradient(-45deg, transparent 75%, #EAE6DC 75%)',
            backgroundSize: '16px 16px',
            backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
            backgroundColor: '#FAF8F3',
          }}
          className="absolute left-0 top-0 will-change-transform"
        >
          <img
            src={src}
            alt={alt}
            draggable={false}
            decoding="async"
            onDragStart={(e) => e.preventDefault()}
            onError={onImageLoadError}
            className="pointer-events-none block h-full w-full max-h-none max-w-none select-none object-contain"
          />
        </div>

        {isDragReplaceActive ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[var(--ff-color-info-subtle)]/90">
            <Typography
              variant="label"
              className="text-[var(--ff-color-primary)]"
            >
              Drop image to replace active source
            </Typography>
          </div>
        ) : null}
      </div>
    </div>
  );
}

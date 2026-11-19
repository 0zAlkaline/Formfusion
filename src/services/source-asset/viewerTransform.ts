export const MIN_VIEWER_SCALE = 0.1;
export const MAX_VIEWER_SCALE = 5.0;
export const DEFAULT_VIEWER_PADDING = 24;

export const ZOOM_STEPS: readonly number[] = [
  0.1,
  0.15,
  0.2,
  0.25,
  0.33,
  0.5,
  0.67,
  0.75,
  1.0,
  1.25,
  1.5,
  2.0,
  2.5,
  3.0,
  4.0,
  5.0,
] as const;

export type ViewerMode = 'fit' | 'actual' | 'custom';

export interface ViewerDimensions {
  readonly containerWidth: number;
  readonly containerHeight: number;
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly padding?: number;
}

export interface ViewerTransformState {
  readonly scale: number;
  readonly translateX: number;
  readonly translateY: number;
  readonly fitScale: number;
  readonly viewMode: ViewerMode;
}

export function clampViewerScale(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) {
    return 1.0;
  }
  return Math.min(MAX_VIEWER_SCALE, Math.max(MIN_VIEWER_SCALE, scale));
}

export function formatZoomPercent(scale: number): string {
  return `${Math.round(clampViewerScale(scale) * 100)}%`;
}

export function computeFitScale(dims: ViewerDimensions): number {
  const padding = Math.max(0, dims.padding ?? DEFAULT_VIEWER_PADDING);
  if (
    !Number.isFinite(dims.containerWidth) ||
    !Number.isFinite(dims.containerHeight) ||
    !Number.isFinite(dims.imageWidth) ||
    !Number.isFinite(dims.imageHeight) ||
    dims.containerWidth <= 0 ||
    dims.containerHeight <= 0 ||
    dims.imageWidth <= 0 ||
    dims.imageHeight <= 0
  ) {
    return 1.0;
  }

  const availableWidth = Math.max(1, dims.containerWidth - padding * 2);
  const availableHeight = Math.max(1, dims.containerHeight - padding * 2);

  const rawFit = Math.min(
    availableWidth / dims.imageWidth,
    availableHeight / dims.imageHeight,
  );

  return clampViewerScale(rawFit);
}

export function computeCenteredTranslate(
  dims: ViewerDimensions,
  scale: number,
): { readonly translateX: number; readonly translateY: number } {
  const safeScale = clampViewerScale(scale);
  const scaledWidth = dims.imageWidth * safeScale;
  const scaledHeight = dims.imageHeight * safeScale;

  return {
    translateX: (dims.containerWidth - scaledWidth) / 2,
    translateY: (dims.containerHeight - scaledHeight) / 2,
  };
}

export function isImagePannable(
  dims: ViewerDimensions,
  scale: number,
): boolean {
  const safeScale = clampViewerScale(scale);
  if (dims.containerWidth <= 0 || dims.containerHeight <= 0) {
    return false;
  }
  return (
    dims.imageWidth * safeScale > dims.containerWidth + 0.5 ||
    dims.imageHeight * safeScale > dims.containerHeight + 0.5
  );
}

export function clampPanTranslate(
  dims: ViewerDimensions,
  scale: number,
  translateX: number,
  translateY: number,
): { readonly translateX: number; readonly translateY: number } {
  const safeScale = clampViewerScale(scale);
  const safeX = Number.isFinite(translateX) ? translateX : 0;
  const safeY = Number.isFinite(translateY) ? translateY : 0;

  const scaledWidth = dims.imageWidth * safeScale;
  const scaledHeight = dims.imageHeight * safeScale;

  let clampedX: number;
  if (scaledWidth <= dims.containerWidth) {
    clampedX = (dims.containerWidth - scaledWidth) / 2;
  } else {
    const minX = dims.containerWidth - scaledWidth;
    const maxX = 0;
    clampedX = Math.min(maxX, Math.max(minX, safeX));
  }

  let clampedY: number;
  if (scaledHeight <= dims.containerHeight) {
    clampedY = (dims.containerHeight - scaledHeight) / 2;
  } else {
    const minY = dims.containerHeight - scaledHeight;
    const maxY = 0;
    clampedY = Math.min(maxY, Math.max(minY, safeY));
  }

  return {
    translateX: clampedX,
    translateY: clampedY,
  };
}

export function createFitViewState(
  dims: ViewerDimensions,
): ViewerTransformState {
  const fitScale = computeFitScale(dims);
  const centered = computeCenteredTranslate(dims, fitScale);
  return {
    scale: fitScale,
    translateX: centered.translateX,
    translateY: centered.translateY,
    fitScale,
    viewMode: 'fit',
  };
}

export function applyActualSizeViewState(
  dims: ViewerDimensions,
  fitScaleOverride?: number,
): ViewerTransformState {
  const fitScale = fitScaleOverride ?? computeFitScale(dims);
  const actualScale = 1.0;
  const centered = computeCenteredTranslate(dims, actualScale);
  const clamped = clampPanTranslate(
    dims,
    actualScale,
    centered.translateX,
    centered.translateY,
  );
  return {
    scale: actualScale,
    translateX: clamped.translateX,
    translateY: clamped.translateY,
    fitScale,
    viewMode: 'actual',
  };
}

export function stepZoomScale(
  currentScale: number,
  direction: 'in' | 'out',
): number {
  const safe = clampViewerScale(currentScale);
  const minDelta = 0.04;

  if (direction === 'in') {
    const next = ZOOM_STEPS.find((step) => step > safe + minDelta);
    return clampViewerScale(next ?? MAX_VIEWER_SCALE);
  }

  for (let i = ZOOM_STEPS.length - 1; i >= 0; i -= 1) {
    const step = ZOOM_STEPS[i];
    if (step !== undefined && step < safe - minDelta) {
      return clampViewerScale(step);
    }
  }
  return MIN_VIEWER_SCALE;
}

export function wheelZoomScale(currentScale: number, deltaY: number): number {
  const safe = clampViewerScale(currentScale);
  if (!Number.isFinite(deltaY) || deltaY === 0) {
    return safe;
  }
  const factor = deltaY < 0 ? 1.12 : 1 / 1.12;
  return clampViewerScale(safe * factor);
}

export function applyZoomAtPoint(
  state: ViewerTransformState,
  dims: ViewerDimensions,
  targetScale: number,
  anchorX?: number,
  anchorY?: number,
): ViewerTransformState {
  const nextScale = clampViewerScale(targetScale);
  const safeAnchorX =
    anchorX !== undefined && Number.isFinite(anchorX)
      ? anchorX
      : dims.containerWidth / 2;
  const safeAnchorY =
    anchorY !== undefined && Number.isFinite(anchorY)
      ? anchorY
      : dims.containerHeight / 2;

  const imagePointX = (safeAnchorX - state.translateX) / state.scale;
  const imagePointY = (safeAnchorY - state.translateY) / state.scale;

  const rawTranslateX = safeAnchorX - imagePointX * nextScale;
  const rawTranslateY = safeAnchorY - imagePointY * nextScale;

  const clamped = clampPanTranslate(
    dims,
    nextScale,
    rawTranslateX,
    rawTranslateY,
  );

  return {
    scale: nextScale,
    translateX: clamped.translateX,
    translateY: clamped.translateY,
    fitScale: state.fitScale,
    viewMode: 'custom',
  };
}

export function applyPanDelta(
  state: ViewerTransformState,
  dims: ViewerDimensions,
  deltaX: number,
  deltaY: number,
): ViewerTransformState {
  if (!isImagePannable(dims, state.scale)) {
    return state;
  }

  const safeDeltaX = Number.isFinite(deltaX) ? deltaX : 0;
  const safeDeltaY = Number.isFinite(deltaY) ? deltaY : 0;

  const clamped = clampPanTranslate(
    dims,
    state.scale,
    state.translateX + safeDeltaX,
    state.translateY + safeDeltaY,
  );

  return {
    ...state,
    translateX: clamped.translateX,
    translateY: clamped.translateY,
  };
}

export function recalculateOnContainerResize(
  state: ViewerTransformState,
  dims: ViewerDimensions,
): ViewerTransformState {
  const nextFitScale = computeFitScale(dims);
  if (state.viewMode === 'fit') {
    return createFitViewState(dims);
  }

  const clamped = clampPanTranslate(
    dims,
    state.scale,
    state.translateX,
    state.translateY,
  );
  return {
    ...state,
    fitScale: nextFitScale,
    translateX: clamped.translateX,
    translateY: clamped.translateY,
  };
}

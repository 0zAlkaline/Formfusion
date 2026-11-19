import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyActualSizeViewState,
  applyPanDelta,
  applyZoomAtPoint,
  clampPanTranslate,
  clampViewerScale,
  computeFitScale,
  createFitViewState,
  formatZoomPercent,
  isImagePannable,
  MAX_VIEWER_SCALE,
  MIN_VIEWER_SCALE,
  recalculateOnContainerResize,
  stepZoomScale,
  wheelZoomScale,
} from './viewerTransform';

test('Fit calculation adapts cleanly to landscape, portrait, and square images', () => {
  // Landscape 1600x900 inside 848x548 container (padding 24 => 800x500 usable)
  const landscapeFit = computeFitScale({
    containerWidth: 848,
    containerHeight: 548,
    imageWidth: 1600,
    imageHeight: 900,
  });
  assert.equal(landscapeFit, 0.5);

  // Portrait 900x1500 inside 848x548 (usable 800x500) => 500/1500 = 0.3333...
  const portraitFit = computeFitScale({
    containerWidth: 848,
    containerHeight: 548,
    imageWidth: 900,
    imageHeight: 1500,
  });
  assert.ok(Math.abs(portraitFit - 1 / 3) < 0.0001);

  // Square 300x300 inside 648x448 (usable 600x400) => 400/300 = 1.3333...
  const squareFit = computeFitScale({
    containerWidth: 648,
    containerHeight: 448,
    imageWidth: 300,
    imageHeight: 300,
  });
  assert.ok(Math.abs(squareFit - 4 / 3) < 0.0001);
});

test('Zoom clamps invalid, sub-minimum, and above-maximum scales', () => {
  assert.equal(clampViewerScale(NaN), 1.0);
  assert.equal(clampViewerScale(Infinity), 1.0);
  assert.equal(clampViewerScale(-2), 1.0);
  assert.equal(clampViewerScale(0.01), MIN_VIEWER_SCALE);
  assert.equal(clampViewerScale(12.5), MAX_VIEWER_SCALE);
  assert.equal(formatZoomPercent(0.1), '10%');
  assert.equal(formatZoomPercent(5.0), '500%');
});

test('Zoom step and wheel zoom advance predictably and preserve anchor point', () => {
  assert.equal(stepZoomScale(1.0, 'in'), 1.25);
  assert.equal(stepZoomScale(1.0, 'out'), 0.75);
  assert.equal(stepZoomScale(MAX_VIEWER_SCALE, 'in'), MAX_VIEWER_SCALE);
  assert.equal(stepZoomScale(MIN_VIEWER_SCALE, 'out'), MIN_VIEWER_SCALE);

  const zoomedIn = wheelZoomScale(1.0, -100);
  const zoomedOut = wheelZoomScale(1.0, 100);
  assert.ok(zoomedIn > 1.0 && zoomedIn <= MAX_VIEWER_SCALE);
  assert.ok(zoomedOut < 1.0 && zoomedOut >= MIN_VIEWER_SCALE);

  const dims = {
    containerWidth: 800,
    containerHeight: 500,
    imageWidth: 1600,
    imageHeight: 1000,
  };
  const actual = applyActualSizeViewState(dims);
  assert.equal(actual.scale, 1.0);
  assert.equal(actual.viewMode, 'actual');

  // Anchor zoom at cursor (200, 150) should preserve image-space coordinate under (200, 150)
  const cursorX = 200;
  const cursorY = 150;
  const imgXBefore = (cursorX - actual.translateX) / actual.scale;
  const imgYBefore = (cursorY - actual.translateY) / actual.scale;

  const after = applyZoomAtPoint(actual, dims, 2.0, cursorX, cursorY);
  assert.equal(after.scale, 2.0);
  assert.equal(after.viewMode, 'custom');
  const imgXAfter = (cursorX - after.translateX) / after.scale;
  const imgYAfter = (cursorY - after.translateY) / after.scale;
  assert.ok(Math.abs(imgXAfter - imgXBefore) < 0.001);
  assert.ok(Math.abs(imgYAfter - imgYBefore) < 0.001);
});

test('Pan is disabled when fitted image fits within viewer and clamped when oversized', () => {
  const dims = {
    containerWidth: 800,
    containerHeight: 500,
    imageWidth: 1600,
    imageHeight: 1000,
  };

  const fitState = createFitViewState(dims);
  assert.equal(isImagePannable(dims, fitState.scale), false);
  const unchanged = applyPanDelta(fitState, dims, 120, -80);
  assert.deepEqual(unchanged, fitState);

  const actualState = applyActualSizeViewState(dims);
  assert.equal(isImagePannable(dims, actualState.scale), true);
  // Centered at (-400, -250). Panning +1000,+1000 must clamp to (0, 0)
  const pannedTopLeft = applyPanDelta(actualState, dims, 1000, 1000);
  assert.equal(pannedTopLeft.translateX, 0);
  assert.equal(pannedTopLeft.translateY, 0);

  // Panning -1000,-1000 must clamp to (800-1600, 500-1000) = (-800, -500)
  const pannedBottomRight = applyPanDelta(actualState, dims, -1000, -1000);
  assert.equal(pannedBottomRight.translateX, -800);
  assert.equal(pannedBottomRight.translateY, -500);

  const directClamp = clampPanTranslate(dims, 1.0, 500, -9999);
  assert.equal(directClamp.translateX, 0);
  assert.equal(directClamp.translateY, -500);
});

test('Resize recalculates fitScale and preserves custom zoom safely inside bounds', () => {
  const initialDims = {
    containerWidth: 848,
    containerHeight: 548,
    imageWidth: 1600,
    imageHeight: 900,
  };
  const fit = createFitViewState(initialDims);
  assert.equal(fit.scale, 0.5);

  const smallerDims = {
    containerWidth: 448,
    containerHeight: 348,
    imageWidth: 1600,
    imageHeight: 900,
  };
  const resizedFit = recalculateOnContainerResize(fit, smallerDims);
  assert.equal(resizedFit.viewMode, 'fit');
  assert.equal(resizedFit.scale, 0.25);

  // Resetting from zoomed custom state returns cleanly to Fit to Screen
  const zoomed = applyZoomAtPoint(resizedFit, smallerDims, 2.0);
  assert.equal(zoomed.viewMode, 'custom');
  const reset = createFitViewState(smallerDims);
  assert.equal(reset.viewMode, 'fit');
  assert.equal(reset.scale, 0.25);
});

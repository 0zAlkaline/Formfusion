import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type {
  GeneratedArtwork,
  GenerationJob,
  PromptDocument,
} from '../../types/domain.ts';
import type { PersistedGenerationRecordBundle } from './generationHistoryService.ts';
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
  resetPreviewPosition,
  resolveArtworkIntrinsicDimensions,
  stepZoomScale,
  wheelZoomScale,
  type ViewerDimensions,
} from './artworkPreviewService.ts';

function makePrompt(overrides: Partial<PromptDocument> = {}): PromptDocument {
  const id = overrides.id ?? 'prm_00000000-0000-4000-8000-000000000001';
  return {
    id,
    promptId: id,
    projectId: 'prj_00000000-0000-4000-8000-000000000001',
    descriptionId: 'dsc_00000000-0000-4000-8000-000000000001',
    sourceDescriptionRevision: 1,
    styleId: 'style_minimal_ink',
    selectedStyleId: 'style_minimal_ink',
    creativeDirection: {
      source: 'curated',
      styleId: 'style_minimal_ink',
      styleName: 'Minimal Ink Illustration',
      styleCategory: 'Illustration',
      styleDescription: 'Crisp minimalist ink aesthetic',
      visualCharacteristics: 'Clean archival lines',
      renderingRules: 'Sharp contours',
      renderingTechnique: 'Fine archival ink linework',
      lineworkRules: 'Monoline weight',
      colorRules: 'Monochrome and warm stone',
      textureRules: 'Subtle cotton rag grain',
      shadingRules: 'Minimal crosshatch',
      compositionRules: 'Balanced negative space',
      detailLevel: 'high',
      isManualCreativeDirection: false,
    },
    userInstructions: 'Crisp contours',
    creativeInstructions: 'Crisp contours',
    compositionPreferences: {
      aspectRatio: '1:1',
      outputOrientation: 'square',
      backgroundTreatment: 'neutral_studio',
      detailLevel: 'high',
      compositionDirection: 'centered subject',
    },
    unresolvedConflicts: [],
    generatedPrompt: 'Historical prompt draft text.',
    finalPrompt: 'Historical approved ceramic tea kettle with brushed brass handle.',
    negativePrompt: 'blurry, low detail, watermark',
    approvalStatus: 'approved',
    generatedAt: '2026-06-01T10:00:00.000Z',
    approvedAt: '2026-06-01T10:01:00.000Z',
    revision: 1,
    revisionNumber: 1,
    providerId: 'ovh-sdxl',
    modelId: 'stable-diffusion-xl-base-v10',
    promptKind: 'master',
    createdAt: '2026-06-01T10:00:00.000Z',
    updatedAt: '2026-06-01T10:01:00.000Z',
    ...overrides,
  };
}

function makeJob(overrides: Partial<GenerationJob> = {}): GenerationJob {
  return {
    id: overrides.id ?? 'gen_00000000-0000-4000-8000-000000000001',
    projectId: 'prj_00000000-0000-4000-8000-000000000001',
    promptDocumentId:
      overrides.promptDocumentId ?? 'prm_00000000-0000-4000-8000-000000000001',
    providerConfigRef: {
      providerId: 'ovh-sdxl',
      modelId: 'stable-diffusion-xl-base-v10',
    },
    status: 'completed',
    aspectRatio: '1:1',
    resolution: { width: 1024, height: 1024, label: 'standard' },
    modelParameters: {},
    artworkIds: [],
    errorMessage: null,
    errorCode: null,
    queuedAt: '2026-06-01T10:02:00.000Z',
    startedAt: '2026-06-01T10:02:01.000Z',
    completedAt: '2026-06-01T10:02:10.000Z',
    generationKind: 'original',
    includeNegativePrompt: true,
    createdAt: '2026-06-01T10:02:00.000Z',
    updatedAt: '2026-06-01T10:02:10.000Z',
    ...overrides,
  };
}

function makeArtwork(
  overrides: Partial<GeneratedArtwork> = {},
): GeneratedArtwork {
  return {
    id: overrides.id ?? 'art_00000000-0000-4000-8000-000000000001',
    projectId: 'prj_00000000-0000-4000-8000-000000000001',
    generationJobId:
      overrides.generationJobId ?? 'gen_00000000-0000-4000-8000-000000000001',
    promptDocumentId:
      overrides.promptDocumentId ?? 'prm_00000000-0000-4000-8000-000000000001',
    mimeType: 'image/png',
    width: 1024,
    height: 1024,
    localBlobKey: 'artwork_blob_1',
    fileSizeBytes: 245760,
    providerModelId: 'stable-diffusion-xl-base-v10',
    generationKind: 'original',
    createdAt: '2026-06-01T10:02:10.000Z',
    updatedAt: '2026-06-01T10:02:10.000Z',
    ...overrides,
  };
}

function makeEntry(
  overrides: Partial<PersistedGenerationRecordBundle> = {},
): PersistedGenerationRecordBundle {
  const job = overrides.job ?? makeJob();
  const artwork =
    overrides.artwork === undefined
      ? makeArtwork({ generationJobId: job.id, promptDocumentId: job.promptDocumentId })
      : overrides.artwork;
  const promptDocument =
    overrides.promptDocument === undefined
      ? makePrompt({ id: job.promptDocumentId, promptId: job.promptDocumentId })
      : overrides.promptDocument;

  return {
    job,
    artwork,
    imageBlob:
      overrides.imageBlob === undefined
        ? new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })
        : overrides.imageBlob,
    blobMissingOrCorrupted: overrides.blobMissingOrCorrupted ?? false,
    blobErrorMessage: overrides.blobErrorMessage ?? null,
    fileSizeBytes:
      overrides.fileSizeBytes === undefined ? 245760 : overrides.fileSizeBytes,
    promptDocument,
    parentPromptDocument: overrides.parentPromptDocument ?? null,
  };
}

describe('artworkPreviewService', () => {
  const dims: ViewerDimensions = {
    containerWidth: 800,
    containerHeight: 600,
    imageWidth: 1024,
    imageHeight: 1024,
  };

  it('computes fit zoom, 100% zoom, step zoom, wheel zoom, and clamps min/max boundaries', () => {
    const fit = createFitViewState(dims);
    assert.equal(fit.viewMode, 'fit');
    assert.ok(fit.scale > 0.5 && fit.scale < 0.6);
    assert.equal(isImagePannable(dims, fit.scale), false);

    const actual = applyActualSizeViewState(dims, fit.fitScale);
    assert.equal(actual.viewMode, 'actual');
    assert.equal(actual.scale, 1.0);
    assert.equal(formatZoomPercent(actual.scale), '100%');
    assert.equal(isImagePannable(dims, actual.scale), true);

    const zoomedIn = stepZoomScale(actual.scale, 'in');
    assert.equal(zoomedIn, 1.25);
    const zoomedOut = stepZoomScale(actual.scale, 'out');
    assert.equal(zoomedOut, 0.75);

    assert.equal(stepZoomScale(MAX_VIEWER_SCALE, 'in'), MAX_VIEWER_SCALE);
    assert.equal(stepZoomScale(MIN_VIEWER_SCALE, 'out'), MIN_VIEWER_SCALE);

    assert.ok(wheelZoomScale(1.0, -120) > 1.0);
    assert.ok(wheelZoomScale(1.0, 120) < 1.0);
    assert.equal(wheelZoomScale(1.0, 0), 1.0);
  });

  it('pans zoomed artwork within bounds and resets position without discarding zoom level', () => {
    const zoomed = applyZoomAtPoint(
      createFitViewState(dims),
      dims,
      2.0,
      400,
      300,
    );
    assert.equal(zoomed.scale, 2.0);
    assert.equal(isImagePannable(dims, zoomed.scale), true);

    const panned = applyPanDelta(zoomed, dims, 160, -120);
    assert.notEqual(panned.translateX, zoomed.translateX);
    assert.notEqual(panned.translateY, zoomed.translateY);
    assert.equal(hasPreviewPanOffset(panned, dims), true);

    const resetPos = resetPreviewPosition(panned, dims);
    assert.equal(resetPos.scale, 2.0);
    assert.equal(hasPreviewPanOffset(resetPos, dims), false);
    assert.equal(resetPos.translateX, (800 - 2048) / 2);
    assert.equal(resetPos.translateY, (600 - 2048) / 2);
  });

  it('builds honest artwork preview metadata for original, regenerated, and variation records', () => {
    const original = makeEntry();
    const originalMeta = buildArtworkPreviewMetadata(original, {
      projectTitle: 'Kettle Study',
    });
    assert.equal(originalMeta.artworkName, 'Kettle Study · Original (v1)');
    assert.equal(originalMeta.generationTypeLabel, 'Original');
    assert.equal(originalMeta.parentGenerationId, null);
    assert.equal(originalMeta.outputDimensions, '1024 × 1024 px');
    assert.equal(originalMeta.aspectRatio, '1:1');
    assert.equal(originalMeta.imageFormat, 'PNG (image/png)');
    assert.equal(originalMeta.fileSize, '240.0 KB');
    assert.equal(originalMeta.statusLabel, 'Completed');

    const parentId = 'gen_00000000-0000-4000-8000-000000000001';
    const variationEntry = makeEntry({
      job: makeJob({
        id: 'gen_00000000-0000-4000-8000-000000000003',
        generationKind: 'variation',
        parentGenerationId: parentId,
        parentPromptId: 'prm_00000000-0000-4000-8000-000000000001',
        variationId: 'var_00000000-0000-4000-8000-000000000001',
        variationLabel: 'Warm brass lighting',
        variationInstructions: 'Use warmer amber rim lighting',
      }),
      promptDocument: makePrompt({
        id: 'prm_00000000-0000-4000-8000-000000000003',
        promptKind: 'variation',
        revision: 2,
        revisionNumber: 2,
        finalPrompt: 'Warm amber lit ceramic tea kettle with brushed brass handle.',
      }),
      parentPromptDocument: makePrompt({
        id: 'prm_00000000-0000-4000-8000-000000000001',
        finalPrompt: 'Historical approved ceramic tea kettle with brushed brass handle.',
      }),
    });

    const variationMeta = buildArtworkPreviewMetadata(variationEntry, {
      projectTitle: 'Kettle Study',
    });
    assert.equal(variationMeta.artworkName, 'Kettle Study · Warm brass lighting');
    assert.equal(variationMeta.generationTypeLabel, 'Variation');
    assert.equal(variationMeta.parentGenerationId, parentId);
    assert.ok(variationMeta.parentPromptReference?.includes('v1'));
  });

  it('never fabricates metadata when binary Blob or artwork record is missing', () => {
    const missingBlobEntry = makeEntry({
      imageBlob: null,
      blobMissingOrCorrupted: true,
      blobErrorMessage: 'Missing local Blob',
      fileSizeBytes: null,
      artwork: null,
      job: makeJob({ status: 'failed' }),
    });

    const meta = buildArtworkPreviewMetadata(missingBlobEntry);
    assert.equal(meta.fileSize, 'Unavailable');
    assert.equal(meta.imageFormat, 'Unavailable');
    assert.equal(meta.outputDimensions, '1024 × 1024 px (Requested)');
    assert.equal(meta.statusLabel, 'Failed');
  });

  it('extracts historical prompt snapshots faithfully including variation lineage', () => {
    const variationEntry = makeEntry({
      job: makeJob({
        generationKind: 'variation',
        parentGenerationId: 'gen_00000000-0000-4000-8000-000000000001',
        variationInstructions: 'Introduce stronger contrast',
        negativePromptUsed: 'flat shading, haze',
      }),
      promptDocument: makePrompt({
        id: 'prm_00000000-0000-4000-8000-000000000002',
        revision: 2,
        revisionNumber: 2,
        promptKind: 'variation',
        finalPrompt: 'High-contrast variation kettle prompt',
        variationInstructions: 'Introduce stronger contrast',
      }),
      parentPromptDocument: makePrompt({
        id: 'prm_00000000-0000-4000-8000-000000000001',
        finalPrompt: 'Original parent kettle prompt',
      }),
    });

    const snapshot = extractHistoricalPromptSnapshot(variationEntry);
    assert.equal(snapshot.hasPromptSnapshot, true);
    assert.equal(snapshot.isVariation, true);
    assert.equal(snapshot.revisionLabel, 'v2');
    assert.equal(snapshot.primaryPromptText, 'High-contrast variation kettle prompt');
    assert.equal(snapshot.parentPromptText, 'Original parent kettle prompt');
    assert.equal(snapshot.variationInstructions, 'Introduce stronger contrast');
    assert.equal(snapshot.negativePromptText, 'flat shading, haze');
  });

  it('computes previous/next navigation bounds across project artworks cleanly', () => {
    const e1 = makeEntry({
      job: makeJob({ id: 'gen_00000000-0000-4000-8000-000000000001' }),
    });
    const e2 = makeEntry({
      job: makeJob({ id: 'gen_00000000-0000-4000-8000-000000000002' }),
    });
    const e3 = makeEntry({
      job: makeJob({ id: 'gen_00000000-0000-4000-8000-000000000003' }),
    });

    const navStart = getPreviewNavigationState([e1, e2, e3], e1.job.id);
    assert.equal(navStart.currentIndex, 0);
    assert.equal(navStart.totalCount, 3);
    assert.equal(navStart.hasPrevious, false);
    assert.equal(navStart.hasNext, true);
    assert.equal(navStart.nextEntry?.job.id, e2.job.id);

    const navMid = getPreviewNavigationState([e1, e2, e3], e2.job.id);
    assert.equal(navMid.currentIndex, 1);
    assert.equal(navMid.previousEntry?.job.id, e1.job.id);
    assert.equal(navMid.nextEntry?.job.id, e3.job.id);

    const navEnd = getPreviewNavigationState([e1, e2, e3], e3.job.id);
    assert.equal(navEnd.hasPrevious, true);
    assert.equal(navEnd.hasNext, false);

    const navMissing = getPreviewNavigationState([e1, e2], 'gen_missing');
    assert.equal(navMissing.currentIndex, -1);
    assert.equal(navMissing.hasPrevious, false);
    assert.equal(navMissing.hasNext, false);
  });

  it('resolves intrinsic image dimensions cleanly from decoded bitmap, artwork record, or job fallback', () => {
    const artwork = makeArtwork({ width: 1024, height: 1024 });
    const job = makeJob({
      resolution: { width: 768, height: 1024, label: 'standard' },
    });

    assert.deepEqual(
      resolveArtworkIntrinsicDimensions(artwork, job, { width: 1344, height: 768 }),
      { width: 1344, height: 768 },
    );
    assert.deepEqual(resolveArtworkIntrinsicDimensions(artwork, job, null), {
      width: 1024,
      height: 1024,
    });
    assert.deepEqual(resolveArtworkIntrinsicDimensions(null, job, null), {
      width: 768,
      height: 1024,
    });
  });
});

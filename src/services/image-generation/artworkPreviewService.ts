import {
  applyActualSizeViewState,
  applyPanDelta,
  applyZoomAtPoint,
  clampPanTranslate,
  clampViewerScale,
  computeCenteredTranslate,
  computeFitScale,
  createFitViewState,
  formatZoomPercent,
  isImagePannable,
  MAX_VIEWER_SCALE,
  MIN_VIEWER_SCALE,
  recalculateOnContainerResize,
  stepZoomScale,
  wheelZoomScale,
  type ViewerDimensions,
  type ViewerMode,
  type ViewerTransformState,
} from '../source-asset/viewerTransform.ts';
import {
  formatFileSize,
  formatSourceFormatLabel,
} from '../source-asset/imageValidation.ts';
import type { EntityId } from '../../types/common.ts';
import type {
  GeneratedArtwork,
  GenerationJob,
  GenerationKind,
  PromptDocument,
} from '../../types/domain.ts';
import {
  getGenerationKindLabel,
  resolveGenerationKind,
  type PersistedGenerationRecordBundle,
} from './generationHistoryService.ts';

export {
  applyActualSizeViewState,
  applyPanDelta,
  applyZoomAtPoint,
  clampPanTranslate,
  clampViewerScale,
  computeCenteredTranslate,
  computeFitScale,
  createFitViewState,
  formatZoomPercent,
  isImagePannable,
  MAX_VIEWER_SCALE,
  MIN_VIEWER_SCALE,
  recalculateOnContainerResize,
  stepZoomScale,
  wheelZoomScale,
  type ViewerDimensions,
  type ViewerMode,
  type ViewerTransformState,
};

export interface ArtworkPreviewMetadata {
  readonly artworkName: string;
  readonly generationId: EntityId;
  readonly generationKind: GenerationKind;
  readonly generationTypeLabel: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly originalPromptReference: string;
  readonly promptDocumentId: EntityId;
  readonly parentPromptReference: string | null;
  readonly parentGenerationId: EntityId | null;
  readonly outputDimensions: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly aspectRatio: string;
  readonly imageFormat: string;
  readonly fileSize: string;
  readonly createdAtIso: string;
  readonly createdAtDisplay: string;
  readonly status: GenerationJob['status'];
  readonly statusLabel: string;
}

export interface HistoricalPromptSnapshot {
  readonly hasPromptSnapshot: boolean;
  readonly promptDocumentId: EntityId;
  readonly revisionLabel: string;
  readonly isVariation: boolean;
  readonly primaryPromptLabel: string;
  readonly primaryPromptText: string | null;
  readonly parentPromptLabel: string | null;
  readonly parentPromptText: string | null;
  readonly variationInstructions: string | null;
  readonly negativePromptText: string | null;
  readonly approvedAtIso: string | null;
}

export interface PreviewNavigationState {
  readonly currentIndex: number;
  readonly totalCount: number;
  readonly previousEntry: PersistedGenerationRecordBundle | null;
  readonly nextEntry: PersistedGenerationRecordBundle | null;
  readonly hasPrevious: boolean;
  readonly hasNext: boolean;
}

/**
 * Resets pan offsets to center the artwork cleanly at the active zoom scale
 * without discarding the user's chosen zoom level.
 */
export function resetPreviewPosition(
  state: ViewerTransformState,
  dims: ViewerDimensions,
): ViewerTransformState {
  const safeScale = clampViewerScale(state.scale);
  const centered = computeCenteredTranslate(dims, safeScale);
  const clamped = clampPanTranslate(
    dims,
    safeScale,
    centered.translateX,
    centered.translateY,
  );
  return {
    ...state,
    scale: safeScale,
    translateX: clamped.translateX,
    translateY: clamped.translateY,
  };
}

/**
 * Reports whether the artwork has been panned away from its centered position.
 */
export function hasPreviewPanOffset(
  state: ViewerTransformState,
  dims: ViewerDimensions,
): boolean {
  const reset = resetPreviewPosition(state, dims);
  return (
    Math.abs(state.translateX - reset.translateX) > 0.75 ||
    Math.abs(state.translateY - reset.translateY) > 0.75
  );
}

function greatestCommonDivisor(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

export function formatAspectRatioLabel(
  jobAspectRatio: string | undefined,
  width: number | null,
  height: number | null,
): string {
  const trimmed = jobAspectRatio?.trim();
  if (trimmed && trimmed.length > 0) {
    return trimmed;
  }
  if (width && height && width > 0 && height > 0) {
    const divisor = greatestCommonDivisor(width, height);
    return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
  }
  return 'Unavailable';
}

export function deriveArtworkDisplayName(params: {
  readonly projectTitle?: string | null;
  readonly job: Pick<GenerationJob, 'id' | 'variationLabel'>;
  readonly generationKind: GenerationKind;
  readonly promptDocument?: Pick<PromptDocument, 'revisionNumber' | 'revision'> | null;
}): string {
  const baseTitle = params.projectTitle?.trim() || 'Study Artwork';
  const kindLabel = getGenerationKindLabel(params.generationKind);
  const variationLabel = params.job.variationLabel?.trim();

  if (params.generationKind === 'variation' && variationLabel) {
    return `${baseTitle} · ${variationLabel}`;
  }

  const revision =
    params.promptDocument?.revisionNumber ?? params.promptDocument?.revision;
  if (typeof revision === 'number' && Number.isFinite(revision)) {
    return `${baseTitle} · ${kindLabel} (v${revision})`;
  }

  return `${baseTitle} · ${kindLabel}`;
}

export function formatGenerationStatusLabel(
  status: GenerationJob['status'],
): string {
  switch (status) {
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    case 'processing':
      return 'Processing';
    case 'pending':
      return 'Pending';
    default:
      return status;
  }
}

function formatSafeTimestamp(iso: string): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) {
    return iso || 'Unavailable';
  }
  return new Date(parsed).toLocaleString();
}

export function buildArtworkPreviewMetadata(
  entry: PersistedGenerationRecordBundle,
  options?: {
    readonly projectTitle?: string | null;
  },
): ArtworkPreviewMetadata {
  const { job, artwork, promptDocument, parentPromptDocument } = entry;
  const generationKind = resolveGenerationKind(job, promptDocument);
  const generationTypeLabel = getGenerationKindLabel(generationKind);

  const width =
    artwork && artwork.width > 0
      ? artwork.width
      : job.resolution.width > 0
        ? job.resolution.width
        : null;
  const height =
    artwork && artwork.height > 0
      ? artwork.height
      : job.resolution.height > 0
        ? job.resolution.height
        : null;

  const outputDimensions =
    artwork && artwork.width > 0 && artwork.height > 0
      ? `${artwork.width} × ${artwork.height} px`
      : width && height
        ? `${width} × ${height} px (Requested)`
        : 'Unavailable';

  const originalPromptReference = promptDocument
    ? `v${promptDocument.revisionNumber ?? promptDocument.revision} · ${promptDocument.id}`
    : job.promptDocumentId
      ? `${job.promptDocumentId} (Snapshot missing)`
      : 'Unavailable';

  const parentPromptReference = parentPromptDocument
    ? `v${parentPromptDocument.revisionNumber ?? parentPromptDocument.revision} · ${parentPromptDocument.id}`
    : job.parentPromptId ?? null;

  const fileSizeBytes =
    entry.fileSizeBytes ??
    (typeof artwork?.fileSizeBytes === 'number' && artwork.fileSizeBytes > 0
      ? artwork.fileSizeBytes
      : null);

  const createdAtIso = artwork?.createdAt ?? job.completedAt ?? job.queuedAt;

  return {
    artworkName: deriveArtworkDisplayName({
      projectTitle: options?.projectTitle,
      job,
      generationKind,
      promptDocument,
    }),
    generationId: job.id,
    generationKind,
    generationTypeLabel,
    providerId: job.providerConfigRef.providerId,
    modelId: artwork?.providerModelId ?? job.providerConfigRef.modelId,
    originalPromptReference,
    promptDocumentId: job.promptDocumentId,
    parentPromptReference,
    parentGenerationId: job.parentGenerationId ?? null,
    outputDimensions,
    width,
    height,
    aspectRatio: formatAspectRatioLabel(job.aspectRatio, width, height),
    imageFormat: artwork?.mimeType
      ? `${formatSourceFormatLabel(artwork.mimeType)} (${artwork.mimeType})`
      : 'Unavailable',
    fileSize:
      fileSizeBytes !== null ? formatFileSize(fileSizeBytes) : 'Unavailable',
    createdAtIso,
    createdAtDisplay: formatSafeTimestamp(createdAtIso),
    status: job.status,
    statusLabel: formatGenerationStatusLabel(job.status),
  };
}

export function extractHistoricalPromptSnapshot(
  entry: PersistedGenerationRecordBundle,
): HistoricalPromptSnapshot {
  const { job, promptDocument, parentPromptDocument } = entry;
  const generationKind = resolveGenerationKind(job, promptDocument);
  const isVariation = generationKind === 'variation';

  const revisionLabel = promptDocument
    ? `v${promptDocument.revisionNumber ?? promptDocument.revision}`
    : 'Unavailable';

  const primaryPromptText =
    promptDocument?.finalPrompt && promptDocument.finalPrompt.trim().length > 0
      ? promptDocument.finalPrompt
      : null;

  const parentPromptText =
    isVariation &&
    parentPromptDocument?.finalPrompt &&
    parentPromptDocument.finalPrompt.trim().length > 0
      ? parentPromptDocument.finalPrompt
      : null;

  const rawVariationInstructions =
    job.variationInstructions ?? promptDocument?.variationInstructions ?? null;
  const variationInstructions =
    rawVariationInstructions && rawVariationInstructions.trim().length > 0
      ? rawVariationInstructions.trim()
      : null;

  const rawNegative =
    (job.negativePromptUsed && job.negativePromptUsed.trim().length > 0
      ? job.negativePromptUsed
      : null) ??
    (promptDocument?.negativePrompt &&
    promptDocument.negativePrompt.trim().length > 0
      ? promptDocument.negativePrompt
      : null);

  return {
    hasPromptSnapshot: promptDocument !== null,
    promptDocumentId: job.promptDocumentId,
    revisionLabel,
    isVariation,
    primaryPromptLabel: isVariation
      ? 'Historical Approved Variation Prompt'
      : 'Historical Approved Master Prompt',
    primaryPromptText,
    parentPromptLabel: parentPromptText ? 'Original Parent Prompt' : null,
    parentPromptText,
    variationInstructions,
    negativePromptText: rawNegative ? rawNegative.trim() : null,
    approvedAtIso: promptDocument?.approvedAt ?? null,
  };
}

export function getPreviewNavigationState(
  entries: readonly PersistedGenerationRecordBundle[],
  activeJobId: EntityId | null,
): PreviewNavigationState {
  if (!activeJobId || entries.length === 0) {
    return {
      currentIndex: -1,
      totalCount: entries.length,
      previousEntry: null,
      nextEntry: null,
      hasPrevious: false,
      hasNext: false,
    };
  }

  const currentIndex = entries.findIndex((item) => item.job.id === activeJobId);
  if (currentIndex === -1) {
    return {
      currentIndex: -1,
      totalCount: entries.length,
      previousEntry: null,
      nextEntry: null,
      hasPrevious: false,
      hasNext: false,
    };
  }

  const previousEntry = currentIndex > 0 ? (entries[currentIndex - 1] ?? null) : null;
  const nextEntry =
    currentIndex < entries.length - 1
      ? (entries[currentIndex + 1] ?? null)
      : null;

  return {
    currentIndex,
    totalCount: entries.length,
    previousEntry,
    nextEntry,
    hasPrevious: previousEntry !== null,
    hasNext: nextEntry !== null,
  };
}

export function resolveArtworkIntrinsicDimensions(
  artwork: Pick<GeneratedArtwork, 'width' | 'height'> | null,
  job: Pick<GenerationJob, 'resolution'>,
  decodedDimensions?: { readonly width: number; readonly height: number } | null,
): { readonly width: number; readonly height: number } {
  if (
    decodedDimensions &&
    decodedDimensions.width > 0 &&
    decodedDimensions.height > 0
  ) {
    return decodedDimensions;
  }
  if (artwork && artwork.width > 0 && artwork.height > 0) {
    return { width: artwork.width, height: artwork.height };
  }
  if (job.resolution.width > 0 && job.resolution.height > 0) {
    return { width: job.resolution.width, height: job.resolution.height };
  }
  return { width: 1024, height: 1024 };
}

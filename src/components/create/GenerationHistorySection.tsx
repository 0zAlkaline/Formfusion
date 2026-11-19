import {
  AlertTriangle,
  Columns2,
  Eye,
  GitBranch,
  History,
  ImageOff,
  RefreshCw,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ImageGenerationProvidersController } from '../../hooks/useImageGenerationProviders.ts';
import {
  filterAndSortGenerationEntries,
  getAvailableHistoryFilters,
  getGenerationKindLabel,
  readStoredComparisonSelection,
  reconcileComparisonSelection,
  resolveGenerationKind,
  writeStoredComparisonSelection,
  type GenerationHistoryFilter,
  type GenerationHistorySortOrder,
  type PersistedGenerationRecordBundle,
} from '../../services/image-generation/generationHistoryService.ts';
import type { PersistedGenerationState } from '../../services/project-storage/browserProjectStorage.ts';
import { formatSourceFormatLabel } from '../../services/source-asset/imageValidation.ts';
import type { EntityId } from '../../types/common.ts';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  EmptyState,
  Select,
  SurfacePanel,
  Typography,
  cn,
} from '../ui/index.ts';
import { ArtworkComparisonView } from './ArtworkComparisonView.tsx';
import { ArtworkPreviewWorkspace } from './ArtworkPreviewWorkspace.tsx';
import { CreateVariationModal } from './CreateVariationModal.tsx';
import { RegenerateArtworkModal } from './RegenerateArtworkModal.tsx';

export interface GenerationHistorySectionProps {
  readonly projectId: EntityId;
  readonly projectTitle?: string | null;
  readonly entries: readonly PersistedGenerationRecordBundle[];
  readonly isLoadingHistory: boolean;
  readonly historyLoadError?: string | null;
  readonly providerController: ImageGenerationProvidersController;
  readonly isGlobalGenerationInFlight: boolean;
  readonly onGlobalGenerationInFlightChange: (inFlight: boolean) => void;
  readonly nextVariationRevisionNumber: number;
  readonly onGenerationPersisted: (state: PersistedGenerationState) => void;
  readonly onNavigate?: (path: string) => void;
}

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
] as const;

export function GenerationHistorySection({
  projectId,
  projectTitle = null,
  entries,
  isLoadingHistory,
  historyLoadError = null,
  providerController,
  isGlobalGenerationInFlight,
  onGlobalGenerationInFlightChange,
  nextVariationRevisionNumber,
  onGenerationPersisted,
  onNavigate,
}: GenerationHistorySectionProps) {
  const [filter, setFilter] = useState<GenerationHistoryFilter>('all');
  const [sortOrder, setSortOrder] =
    useState<GenerationHistorySortOrder>('newest');
  const [selectedCompareIds, setSelectedCompareIds] = useState<
    readonly EntityId[]
  >(() => readStoredComparisonSelection(projectId));
  const [isComparing, setIsComparing] = useState(false);

  const [detailEntryJobId, setDetailEntryJobId] = useState<EntityId | null>(
    null,
  );
  const [regenerateEntryJobId, setRegenerateEntryJobId] =
    useState<EntityId | null>(null);
  const [variationEntryJobId, setVariationEntryJobId] =
    useState<EntityId | null>(null);

  const [previewUrls, setPreviewUrls] = useState<Readonly<Record<EntityId, string>>>(
    {},
  );
  const previewUrlCacheRef = useRef<
    Map<EntityId, { readonly blob: Blob; readonly url: string }>
  >(new Map());

  // Reconcile persisted comparison selection only once history entries are loaded.
  useEffect(() => {
    if (isLoadingHistory || entries.length === 0) {
      return;
    }
    const stored = readStoredComparisonSelection(projectId);
    const reconciled = reconcileComparisonSelection(stored, entries);
    setSelectedCompareIds(reconciled);
    if (reconciled.length !== stored.length) {
      writeStoredComparisonSelection(projectId, reconciled);
    }
    if (reconciled.length < 2) {
      setIsComparing(false);
    }
  }, [projectId, entries, isLoadingHistory]);

  // Synchronize ObjectURL lifecycle cleanly with entries.
  useEffect(() => {
    const cache = previewUrlCacheRef.current;
    const nextCache = new Map<
      EntityId,
      { readonly blob: Blob; readonly url: string }
    >();
    const nextRecord: Record<EntityId, string> = {};

    for (const entry of entries) {
      if (entry.artwork && entry.imageBlob) {
        const existing = cache.get(entry.job.id);
        if (existing && existing.blob === entry.imageBlob) {
          nextCache.set(entry.job.id, existing);
          nextRecord[entry.job.id] = existing.url;
        } else {
          if (existing) {
            URL.revokeObjectURL(existing.url);
          }
          const createdUrl = URL.createObjectURL(entry.imageBlob);
          nextCache.set(entry.job.id, {
            blob: entry.imageBlob,
            url: createdUrl,
          });
          nextRecord[entry.job.id] = createdUrl;
        }
      }
    }

    for (const [jobId, item] of cache.entries()) {
      if (!nextCache.has(jobId)) {
        URL.revokeObjectURL(item.url);
      }
    }

    previewUrlCacheRef.current = nextCache;
    setPreviewUrls(nextRecord);
  }, [entries]);

  useEffect(() => {
    return () => {
      for (const item of previewUrlCacheRef.current.values()) {
        URL.revokeObjectURL(item.url);
      }
      previewUrlCacheRef.current.clear();
    };
  }, []);

  const filterOptions = useMemo(
    () => getAvailableHistoryFilters(entries),
    [entries],
  );

  const visibleEntries = useMemo(
    () => filterAndSortGenerationEntries(entries, { filter, sortOrder }),
    [entries, filter, sortOrder],
  );

  const entryByJobId = useMemo(() => {
    const map = new Map<EntityId, PersistedGenerationRecordBundle>();
    for (const item of entries) {
      map.set(item.job.id, item);
    }
    return map;
  }, [entries]);

  const compareEntries = useMemo(
    () =>
      selectedCompareIds
        .map((id) => entryByJobId.get(id))
        .filter((item): item is PersistedGenerationRecordBundle => Boolean(item)),
    [selectedCompareIds, entryByJobId],
  );

  const handleToggleCompare = (jobId: EntityId) => {
    setSelectedCompareIds((current) => {
      const exists = current.includes(jobId);
      const next = exists
        ? current.filter((id) => id !== jobId)
        : [...current, jobId];
      writeStoredComparisonSelection(projectId, next);
      if (next.length < 2) {
        setIsComparing(false);
      }
      return next;
    });
  };

  const handleClearCompare = () => {
    setSelectedCompareIds([]);
    writeStoredComparisonSelection(projectId, []);
    setIsComparing(false);
  };

  const detailEntry = detailEntryJobId
    ? (entryByJobId.get(detailEntryJobId) ?? null)
    : null;
  const previewNavigableEntries = useMemo(() => {
    if (!detailEntryJobId) {
      return visibleEntries;
    }
    if (isComparing && compareEntries.some((item) => item.job.id === detailEntryJobId)) {
      return compareEntries;
    }
    if (visibleEntries.some((item) => item.job.id === detailEntryJobId)) {
      return visibleEntries;
    }
    return entries;
  }, [detailEntryJobId, isComparing, compareEntries, visibleEntries, entries]);
  const regenerateEntry = regenerateEntryJobId
    ? (entryByJobId.get(regenerateEntryJobId) ?? null)
    : null;
  const variationEntry = variationEntryJobId
    ? (entryByJobId.get(variationEntryJobId) ?? null)
    : null;

  const corruptedCount = entries.filter(
    (item) => item.blobMissingOrCorrupted,
  ).length;

  return (
    <SurfacePanel
      tone="default"
      padding="md"
      className="space-y-5"
      data-testid="generation-history-section"
      aria-labelledby="section-i-heading"
    >
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--ff-color-border)] pb-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <History
              className="h-4 w-4 text-[var(--ff-color-primary)]"
              aria-hidden="true"
            />
            <Typography id="section-i-heading" variant="h3">
              Section I · Generation History, Comparison & Variations
            </Typography>
            <Badge tone="neutral" className="tabular-nums">
              {entries.length} {entries.length === 1 ? 'Record' : 'Records'}
            </Badge>
          </div>
          <Typography variant="caption" muted className="block">
            Inspect persisted artwork lineage, compare outputs side by side, regenerate from original prompts, or branch controlled variations.
          </Typography>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant={isComparing ? 'primary' : 'outline'}
            size="sm"
            leftIcon={<Columns2 className="h-3.5 w-3.5" aria-hidden="true" />}
            disabled={compareEntries.length < 2}
            onClick={() => setIsComparing((prev) => !prev)}
            data-testid="compare-selected-btn"
          >
            {isComparing
              ? 'Viewing Comparison'
              : `Compare Selected (${compareEntries.length})`}
          </Button>
          {compareEntries.length > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleClearCompare}
              data-testid="clear-compare-selection-btn"
            >
              Clear Selection
            </Button>
          ) : null}
        </div>
      </div>

      {historyLoadError ? (
        <Alert
          tone="warning"
          title="History Recovery Warning"
          description={historyLoadError}
        />
      ) : null}

      {corruptedCount > 0 ? (
        <Alert
          tone="warning"
          title={`${corruptedCount} persisted ${corruptedCount === 1 ? 'artwork has' : 'artworks have'} missing image data`}
          description="Metadata and prompt snapshots remain accessible below while affected image thumbnails display recovery placeholders."
        />
      ) : null}

      {isComparing && compareEntries.length >= 2 ? (
        <ArtworkComparisonView
          entries={compareEntries}
          previewUrls={previewUrls}
          onRemoveFromCompare={handleToggleCompare}
          onClearCompare={handleClearCompare}
          onBackToHistory={() => setIsComparing(false)}
          onOpenArtworkDetail={(entry) => setDetailEntryJobId(entry.job.id)}
        />
      ) : (
        <>
          {/* Controls: Filters & Sort */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div
              role="tablist"
              aria-label="Filter generation history"
              className="flex flex-wrap items-center gap-1.5"
              data-testid="history-filter-tabs"
            >
              {filterOptions.map((option) => {
                const isActive = filter === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setFilter(option.id)}
                    data-testid={`history-filter-${option.id}`}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-[var(--ff-radius-sm)] border px-3 py-1.5 text-[12px] font-medium transition-colors cursor-pointer tabular-nums',
                      isActive
                        ? 'border-[var(--ff-color-primary)] bg-[var(--ff-color-info-subtle)] text-[var(--ff-color-primary)]'
                        : 'border-[var(--ff-color-border)] bg-[var(--ff-color-surface)] text-[var(--ff-color-muted-foreground)] hover:bg-[var(--ff-color-surface-elevated)] hover:text-[var(--ff-color-foreground)]',
                    )}
                  >
                    <span>{option.label}</span>
                    <span className="font-mono text-[11px] opacity-80">
                      ({option.count})
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="w-44">
              <Select
                aria-label="Sort generation history"
                value={sortOrder}
                onChange={(e) =>
                  setSortOrder(e.target.value as GenerationHistorySortOrder)
                }
                options={[...SORT_OPTIONS]}
                data-testid="history-sort-select"
              />
            </div>
          </div>

          {/* Comparison Guidance Hint */}
          {entries.filter((e) => e.artwork !== null).length >= 2 &&
          compareEntries.length < 2 ? (
            <Typography
              variant="caption"
              muted
              className="block tabular-nums"
            >
              {compareEntries.length === 1
                ? '1 artwork selected for comparison. Select at least 1 more completed artwork to compare side by side.'
                : 'Select 2 or more completed artworks using Compare to inspect them side by side.'}
            </Typography>
          ) : null}

          {/* History Grid or Empty State */}
          {isLoadingHistory ? (
            <SurfacePanel tone="elevated" padding="md">
              <Typography variant="body-sm" muted>
                Loading generation history from local IndexedDB storage...
              </Typography>
            </SurfacePanel>
          ) : entries.length === 0 ? (
            <EmptyState
              title="No artwork generations recorded yet"
              description="Generate your first artwork in Section H above. Every completed output, regeneration, variation, and failed attempt for this study will be recorded here."
            />
          ) : visibleEntries.length === 0 ? (
            <EmptyState
              title="No matching generations in this filter"
              description="No recorded generation entries match the selected history filter."
              action={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setFilter('all')}
                >
                  Show All Generations
                </Button>
              }
            />
          ) : (
            <div
              className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
              data-testid="generation-history-grid"
            >
              {visibleEntries.map((entry) => {
                const { job, artwork, promptDocument } = entry;
                const generationKind = resolveGenerationKind(job, promptDocument);
                const kindLabel = getGenerationKindLabel(generationKind);
                const previewUrl = previewUrls[job.id] ?? null;
                const isSelected = selectedCompareIds.includes(job.id);
                const canCompare =
                  artwork !== null && job.status === 'completed';
                const canRegenerate =
                  promptDocument?.approvalStatus === 'approved';
                const canCreateVariation =
                  artwork !== null &&
                  job.status === 'completed' &&
                  promptDocument?.approvalStatus === 'approved';

                return (
                  <article
                    key={job.id}
                    data-testid={`history-card-${job.id}`}
                    className={cn(
                      'flex flex-col justify-between rounded-[var(--ff-radius-md)] border bg-[var(--ff-color-surface-elevated)] p-3.5 transition-colors',
                      isSelected
                        ? 'border-[var(--ff-color-primary)] bg-[var(--ff-color-surface)]'
                        : 'border-[var(--ff-color-border)]',
                    )}
                  >
                    <div className="space-y-3">
                      {/* Card Header Badges */}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge
                            tone={
                              generationKind === 'variation'
                                ? 'accent'
                                : generationKind === 'regeneration'
                                  ? 'info'
                                  : 'primary'
                            }
                          >
                            {kindLabel}
                          </Badge>
                          <Badge
                            tone={
                              job.status === 'completed'
                                ? 'success'
                                : 'destructive'
                            }
                          >
                            {job.status === 'completed' ? 'Completed' : 'Failed'}
                          </Badge>
                        </div>

                        {canCompare ? (
                          <Checkbox
                            id={`compare-checkbox-${job.id}`}
                            checked={isSelected}
                            onChange={() => handleToggleCompare(job.id)}
                            label="Compare"
                            aria-label={`Select ${job.id} for comparison`}
                          />
                        ) : null}
                      </div>

                      {/* Thumbnail Preview */}
                      <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-[var(--ff-radius-sm)] border border-[var(--ff-color-border)] bg-[#F6F7F9] p-1.5">
                        {artwork && previewUrl ? (
                          <img
                            src={previewUrl}
                            alt={`Generated artwork thumbnail ${job.id}`}
                            className="max-h-full max-w-full object-contain"
                          />
                        ) : entry.blobMissingOrCorrupted ? (
                          <div className="flex flex-col items-center justify-center gap-1.5 px-3 text-center text-[var(--ff-color-muted-foreground)]">
                            <AlertTriangle
                              className="h-6 w-6 text-[var(--ff-color-warning)]"
                              aria-hidden="true"
                            />
                            <span className="text-[12px] font-medium">
                              Image Binary Missing
                            </span>
                            <span className="text-[11px]">
                              Metadata preserved
                            </span>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center justify-center gap-1.5 px-3 text-center text-[var(--ff-color-muted-foreground)]">
                            <ImageOff className="h-6 w-6" aria-hidden="true" />
                            <span className="text-[12px] font-medium">
                              Generation Failed
                            </span>
                            {job.errorMessage ? (
                              <span className="line-clamp-2 text-[11px]">
                                {job.errorMessage}
                              </span>
                            ) : null}
                          </div>
                        )}
                      </div>

                      {/* Metadata rows */}
                      <dl className="divide-y divide-[var(--ff-color-border)] text-[12px]">
                        <div className="flex items-center justify-between gap-2 py-1.5">
                          <dt className="shrink-0 text-[var(--ff-color-muted-foreground)]">
                            Generation ID
                          </dt>
                          <dd
                            className="truncate text-right font-mono text-[11px] text-[var(--ff-color-foreground)]"
                            title={job.id}
                          >
                            {job.id}
                          </dd>
                        </div>

                        <div className="flex items-center justify-between gap-2 py-1.5">
                          <dt className="shrink-0 text-[var(--ff-color-muted-foreground)]">
                            Timestamp
                          </dt>
                          <dd className="text-right tabular-nums text-[var(--ff-color-foreground)]">
                            {new Date(
                              artwork?.createdAt ?? job.queuedAt,
                            ).toLocaleString()}
                          </dd>
                        </div>

                        <div className="flex items-center justify-between gap-2 py-1.5">
                          <dt className="shrink-0 text-[var(--ff-color-muted-foreground)]">
                            Provider & Model
                          </dt>
                          <dd className="truncate text-right font-mono text-[11px] text-[var(--ff-color-foreground)]">
                            {job.providerConfigRef.providerId} ·{' '}
                            {artwork?.providerModelId ??
                              job.providerConfigRef.modelId}
                          </dd>
                        </div>

                        <div className="flex items-center justify-between gap-2 py-1.5">
                          <dt className="shrink-0 text-[var(--ff-color-muted-foreground)]">
                            Output
                          </dt>
                          <dd className="text-right tabular-nums text-[var(--ff-color-foreground)]">
                            {artwork
                              ? `${artwork.width} × ${artwork.height} · ${formatSourceFormatLabel(artwork.mimeType)}`
                              : `${job.resolution.width} × ${job.resolution.height} · No image`}
                          </dd>
                        </div>

                        <div className="flex items-center justify-between gap-2 py-1.5">
                          <dt className="shrink-0 text-[var(--ff-color-muted-foreground)]">
                            Prompt Ref
                          </dt>
                          <dd className="truncate text-right tabular-nums text-[var(--ff-color-foreground)]">
                            {promptDocument
                              ? `v${promptDocument.revisionNumber ?? promptDocument.revision}`
                              : 'Missing'}
                            {job.variationLabel
                              ? ` · ${job.variationLabel}`
                              : ''}
                          </dd>
                        </div>

                        {job.parentGenerationId ? (
                          <div className="flex items-center justify-between gap-2 py-1.5">
                            <dt className="shrink-0 text-[var(--ff-color-muted-foreground)]">
                              Parent ID
                            </dt>
                            <dd
                              className="truncate text-right font-mono text-[11px] text-[var(--ff-color-foreground)]"
                              title={job.parentGenerationId}
                            >
                              {job.parentGenerationId}
                            </dd>
                          </div>
                        ) : null}
                      </dl>
                    </div>

                    {/* Card Actions */}
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--ff-color-border)] pt-3">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        leftIcon={<Eye className="h-3.5 w-3.5" aria-hidden="true" />}
                        onClick={() => setDetailEntryJobId(job.id)}
                        data-testid={`open-artwork-btn-${job.id}`}
                      >
                        Open Artwork
                      </Button>

                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        leftIcon={
                          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                        }
                        disabled={!canRegenerate || isGlobalGenerationInFlight}
                        onClick={() => setRegenerateEntryJobId(job.id)}
                        data-testid={`regenerate-btn-${job.id}`}
                      >
                        Regenerate
                      </Button>

                      {canCreateVariation ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          leftIcon={
                            <GitBranch
                              className="h-3.5 w-3.5"
                              aria-hidden="true"
                            />
                          }
                          disabled={isGlobalGenerationInFlight}
                          onClick={() => setVariationEntryJobId(job.id)}
                          data-testid={`create-variation-btn-${job.id}`}
                        >
                          Create Variation
                        </Button>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Artwork Preview Workspace */}
      <ArtworkPreviewWorkspace
        open={detailEntry !== null}
        entry={detailEntry}
        navigableEntries={previewNavigableEntries}
        projectTitle={projectTitle}
        isSelectedForCompare={
          detailEntry ? selectedCompareIds.includes(detailEntry.job.id) : false
        }
        isGenerationBusy={isGlobalGenerationInFlight}
        onSelectEntry={(jobId) => setDetailEntryJobId(jobId)}
        onClose={() => setDetailEntryJobId(null)}
        onToggleCompare={handleToggleCompare}
        onRegenerate={(entry) => {
          setDetailEntryJobId(null);
          setRegenerateEntryJobId(entry.job.id);
        }}
        onCreateVariation={(entry) => {
          setDetailEntryJobId(null);
          setVariationEntryJobId(entry.job.id);
        }}
      />

      {/* Regenerate Confirmation Modal */}
      <RegenerateArtworkModal
        open={regenerateEntry !== null}
        projectId={projectId}
        sourceEntry={regenerateEntry}
        providerController={providerController}
        isGlobalGenerationInFlight={isGlobalGenerationInFlight}
        onGlobalGenerationInFlightChange={onGlobalGenerationInFlightChange}
        onClose={() => setRegenerateEntryJobId(null)}
        onRegenerationPersisted={onGenerationPersisted}
        onNavigate={onNavigate}
      />

      {/* Create Variation Modal */}
      <CreateVariationModal
        open={variationEntry !== null}
        projectId={projectId}
        parentEntry={variationEntry}
        parentPreviewUrl={
          variationEntry ? (previewUrls[variationEntry.job.id] ?? null) : null
        }
        nextRevisionNumber={nextVariationRevisionNumber}
        providerController={providerController}
        isGlobalGenerationInFlight={isGlobalGenerationInFlight}
        onGlobalGenerationInFlightChange={onGlobalGenerationInFlightChange}
        onClose={() => setVariationEntryJobId(null)}
        onVariationPersisted={onGenerationPersisted}
        onNavigate={onNavigate}
      />
    </SurfacePanel>
  );
}

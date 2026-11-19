import {
  AlertTriangle,
  ArrowLeft,
  Eye,
  X,
} from 'lucide-react';
import {
  getGenerationKindLabel,
  resolveGenerationKind,
  type PersistedGenerationRecordBundle,
} from '../../services/image-generation/generationHistoryService.ts';
import {
  formatFileSize,
  formatSourceFormatLabel,
} from '../../services/source-asset/imageValidation.ts';
import type { EntityId } from '../../types/common.ts';
import {
  Badge,
  Button,
  SurfacePanel,
  Typography,
} from '../ui/index.ts';

export interface ArtworkComparisonViewProps {
  readonly entries: readonly PersistedGenerationRecordBundle[];
  readonly previewUrls: Readonly<Record<EntityId, string>>;
  readonly onRemoveFromCompare: (jobId: EntityId) => void;
  readonly onClearCompare: () => void;
  readonly onBackToHistory: () => void;
  readonly onOpenArtworkDetail: (entry: PersistedGenerationRecordBundle) => void;
}

export function ArtworkComparisonView({
  entries,
  previewUrls,
  onRemoveFromCompare,
  onClearCompare,
  onBackToHistory,
  onOpenArtworkDetail,
}: ArtworkComparisonViewProps) {
  return (
    <div
      className="space-y-4"
      data-testid="artwork-comparison-view"
      aria-label="Side-by-Side Artwork Comparison"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--ff-radius-md)] border border-[var(--ff-color-border)] bg-[var(--ff-color-surface-elevated)] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            leftIcon={<ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />}
            onClick={onBackToHistory}
            data-testid="comparison-back-to-history-btn"
          >
            Back to Generation History
          </Button>
          <Typography variant="label" className="tabular-nums">
            Comparing {entries.length} Artworks
          </Typography>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClearCompare}
          data-testid="comparison-clear-btn"
        >
          Clear Selection
        </Button>
      </div>

      <div
        className={
          entries.length === 2
            ? 'grid gap-4 md:grid-cols-2'
            : 'grid gap-4 md:grid-cols-2 xl:grid-cols-3'
        }
      >
        {entries.map((entry) => {
          const { job, artwork, promptDocument } = entry;
          const kind = resolveGenerationKind(job, promptDocument);
          const kindLabel = getGenerationKindLabel(kind);
          const previewUrl = previewUrls[job.id] ?? null;

          return (
            <SurfacePanel
              key={job.id}
              tone="default"
              padding="sm"
              className="flex flex-col justify-between space-y-3"
              data-testid={`comparison-card-${job.id}`}
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge
                      tone={
                        kind === 'variation'
                          ? 'accent'
                          : kind === 'regeneration'
                            ? 'info'
                            : 'primary'
                      }
                    >
                      {kindLabel}
                    </Badge>
                    {promptDocument ? (
                      <Badge tone="neutral">
                        v{promptDocument.revisionNumber ?? promptDocument.revision}
                      </Badge>
                    ) : null}
                  </div>

                  <button
                    type="button"
                    onClick={() => onRemoveFromCompare(job.id)}
                    aria-label={`Remove ${job.id} from comparison`}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--ff-radius-sm)] text-[var(--ff-color-muted-foreground)] hover:bg-[var(--ff-color-muted)] hover:text-[var(--ff-color-foreground)] cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>

                {/* Aspect-ratio-preserving image preview (never stretched or cropped) */}
                <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-[var(--ff-radius-sm)] border border-[var(--ff-color-border)] bg-[#F6F7F9] p-2">
                  {previewUrl ? (
                    <img
                      src={previewUrl}
                      alt={`Comparison preview for ${job.id}`}
                      className="max-h-full max-w-full object-contain"
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-1.5 px-3 text-center text-[var(--ff-color-muted-foreground)]">
                      <AlertTriangle
                        className="h-5 w-5 text-[var(--ff-color-warning)]"
                        aria-hidden="true"
                      />
                      <span className="text-[12px] font-medium">
                        Image binary missing or corrupted
                      </span>
                    </div>
                  )}
                </div>

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
                      Provider & Model
                    </dt>
                    <dd className="truncate text-right font-mono text-[11px] text-[var(--ff-color-foreground)]">
                      {job.providerConfigRef.providerId} ·{' '}
                      {artwork?.providerModelId ?? job.providerConfigRef.modelId}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-2 py-1.5">
                    <dt className="shrink-0 text-[var(--ff-color-muted-foreground)]">
                      Timestamp
                    </dt>
                    <dd className="text-right tabular-nums text-[var(--ff-color-foreground)]">
                      {new Date(artwork?.createdAt ?? job.queuedAt).toLocaleString()}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-2 py-1.5">
                    <dt className="shrink-0 text-[var(--ff-color-muted-foreground)]">
                      Prompt Type
                    </dt>
                    <dd className="text-right font-medium text-[var(--ff-color-foreground)]">
                      {kindLabel}
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
                  {artwork ? (
                    <div className="flex items-center justify-between gap-2 py-1.5">
                      <dt className="shrink-0 text-[var(--ff-color-muted-foreground)]">
                        Resolution
                      </dt>
                      <dd className="text-right tabular-nums text-[var(--ff-color-foreground)]">
                        {artwork.width} × {artwork.height} ·{' '}
                        {formatSourceFormatLabel(artwork.mimeType)}
                        {entry.fileSizeBytes !== null
                          ? ` (${formatFileSize(entry.fileSizeBytes)})`
                          : ''}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                leftIcon={<Eye className="h-3.5 w-3.5" aria-hidden="true" />}
                onClick={() => onOpenArtworkDetail(entry)}
                data-testid={`comparison-open-artwork-btn-${job.id}`}
              >
                Open Artwork
              </Button>
            </SurfacePanel>
          );
        })}
      </div>
    </div>
  );
}

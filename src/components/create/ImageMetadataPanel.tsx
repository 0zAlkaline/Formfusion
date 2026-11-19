import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import {
  formatFileSize,
  formatSourceFormatLabel,
} from '../../services/source-asset/imageValidation.ts';
import type { SourceAsset } from '../../types/domain.ts';
import { Typography, cn } from '../ui/index.ts';

export type SourcePersistencePhase =
  | 'restoring'
  | 'not_persisted'
  | 'saving'
  | 'persisted'
  | 'failed';

const PERSISTENCE_STATUS_LABELS: Readonly<Record<SourcePersistencePhase, string>> = {
  restoring: 'Restoring',
  not_persisted: 'Validated — Not Persisted',
  saving: 'Saving',
  persisted: 'Persisted',
  failed: 'Storage Failed',
};

function MetadataRow({
  label,
  value,
  mono = false,
  tabular = false,
  title,
}: {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
  readonly tabular?: boolean;
  readonly title?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-[13px]">
      <dt className="shrink-0 text-[var(--ff-color-muted-foreground)]">{label}</dt>
      <dd
        title={title}
        className={cn(
          'min-w-0 break-words text-right font-medium text-[var(--ff-color-foreground)]',
          mono && 'font-mono text-[12px]',
          tabular && 'tabular-nums',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function StorageStatusValue({ phase }: { readonly phase: SourcePersistencePhase }) {
  const label = PERSISTENCE_STATUS_LABELS[phase];

  if (phase === 'persisted') {
    return (
      <span className="inline-flex items-center gap-1.5 font-medium text-[var(--ff-color-success)]">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>{label}</span>
      </span>
    );
  }

  if (phase === 'failed') {
    return (
      <span className="inline-flex items-center gap-1.5 font-medium text-[var(--ff-color-destructive)]">
        <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>{label}</span>
      </span>
    );
  }

  if (phase === 'saving' || phase === 'restoring') {
    return (
      <span className="inline-flex items-center gap-1.5 font-medium text-[var(--ff-color-primary)]">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
        <span>{label}</span>
      </span>
    );
  }

  return (
    <span className="font-medium text-[var(--ff-color-warning)]">{label}</span>
  );
}

export interface ImageMetadataPanelProps {
  readonly asset: SourceAsset | null;
  readonly persistencePhase: SourcePersistencePhase;
}

export function ImageMetadataPanel({
  asset,
  persistencePhase,
}: ImageMetadataPanelProps) {
  if (!asset) {
    return (
      <div className="space-y-3" data-testid="image-metadata-panel">
        <Typography variant="h3">Source Asset Inspection</Typography>
        <dl className="divide-y divide-[var(--ff-color-border)] border-y border-[var(--ff-color-border)]">
          <div
            data-testid="source-storage-status"
            className="flex items-center justify-between gap-4 py-2 text-[13px]"
          >
            <dt className="shrink-0 text-[var(--ff-color-muted-foreground)]">
              Storage Status
            </dt>
            <dd className="text-right">
              {persistencePhase === 'restoring' ||
              persistencePhase === 'failed' ? (
                <StorageStatusValue phase={persistencePhase} />
              ) : (
                <span className="font-medium text-[var(--ff-color-muted-foreground)]">
                  No Active Asset
                </span>
              )}
            </dd>
          </div>
          <MetadataRow label="Formats" value="JPEG, JPG, PNG, WebP" />
          <MetadataRow
            label="File Integrity"
            value="Signature & decode check"
          />
          <MetadataRow label="Min Resolution" value="256 × 256 px" tabular />
          <MetadataRow
            label="Size Limit"
            value="20 MB · Single image"
            tabular
          />
        </dl>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="image-metadata-panel">
      <Typography variant="h3">Source Asset Inspection</Typography>
      <dl className="divide-y divide-[var(--ff-color-border)] border-y border-[var(--ff-color-border)]">
        <MetadataRow label="Filename" value={asset.originalFileName} />
        <MetadataRow
          label="Format"
          value={formatSourceFormatLabel(asset.mimeType)}
        />
        <MetadataRow label="MIME Type" value={asset.mimeType} mono />
        <MetadataRow
          label="File Size"
          value={formatFileSize(asset.fileSizeBytes)}
          tabular
        />
        <MetadataRow
          label="Natural Width"
          value={`${asset.width} px`}
          tabular
        />
        <MetadataRow
          label="Natural Height"
          value={`${asset.height} px`}
          tabular
        />
        <MetadataRow
          label="Aspect Ratio"
          value={`${asset.aspectRatio.label} (${asset.aspectRatio.numeric})`}
          tabular
        />
        <div className="flex items-center justify-between gap-4 py-2 text-[13px]">
          <dt className="shrink-0 text-[var(--ff-color-muted-foreground)]">
            Validation
          </dt>
          <dd className="inline-flex items-center gap-1.5 font-medium text-[var(--ff-color-success)]">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>Validated</span>
          </dd>
        </div>
        <div
          data-testid="source-storage-status"
          className="flex items-center justify-between gap-4 py-2 text-[13px]"
        >
          <dt className="shrink-0 text-[var(--ff-color-muted-foreground)]">
            Storage Status
          </dt>
          <dd className="text-right">
            <StorageStatusValue phase={persistencePhase} />
          </dd>
        </div>
        {asset.checksumSha256 ? (
          <MetadataRow
            label="SHA-256"
            value={`${asset.checksumSha256.slice(0, 12)}…`}
            title={asset.checksumSha256}
            mono
          />
        ) : null}
        <MetadataRow
          label="Asset ID"
          value={`${asset.id.slice(0, 12)}…${asset.id.slice(-4)}`}
          title={asset.id}
          mono
        />
      </dl>
    </div>
  );
}

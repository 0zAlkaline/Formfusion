import { Copy, Edit3, Play, Trash2 } from 'lucide-react';
import { formatArtStyleCategoryLabel } from '../../services/art-style/contract.ts';
import type { PersonalPreset } from '../../types/domain.ts';
import { Badge, Button, Typography } from '../ui/index.ts';

interface PresetCardProps {
  readonly preset: PersonalPreset;
  readonly isApplying?: boolean;
  readonly isDuplicating?: boolean;
  readonly onApply: (preset: PersonalPreset) => void;
  readonly onEdit: (preset: PersonalPreset) => void;
  readonly onDuplicate: (preset: PersonalPreset) => void;
  readonly onDeleteRequest: (preset: PersonalPreset) => void;
}

export function PresetCard({
  preset,
  isApplying = false,
  isDuplicating = false,
  onApply,
  onEdit,
  onDuplicate,
  onDeleteRequest,
}: PresetCardProps) {
  const snap = preset.creativeDirectionSnapshot;

  return (
    <article
      data-testid={`preset-card-${preset.id}`}
      className="flex flex-col justify-between gap-4 rounded-[var(--ff-radius-lg)] border border-[var(--ff-color-border)] bg-[var(--ff-color-surface)] p-5"
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1">
            <Typography variant="h3" className="leading-snug">
              {preset.name}
            </Typography>
            <p className="text-[12px] text-[var(--ff-color-muted-foreground)] tabular-nums">
              v{preset.version} · Updated{' '}
              {new Date(preset.updatedAt).toLocaleDateString()}
            </p>
          </div>

          <Badge
            tone={
              preset.creativeDirectionMode === 'curated' ? 'info' : 'neutral'
            }
          >
            {preset.creativeDirectionMode === 'curated'
              ? 'Curated Style'
              : 'Manual Direction'}
          </Badge>
        </div>

        {preset.description ? (
          <Typography variant="body-sm" muted className="line-clamp-2">
            {preset.description}
          </Typography>
        ) : null}

        <div className="grid grid-cols-2 gap-2.5 rounded-[var(--ff-radius-md)] border border-[var(--ff-color-border)] bg-[var(--ff-color-surface-elevated)] p-3 text-[12px]">
          <div>
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--ff-color-muted-foreground)]">
              Style Snapshot
            </span>
            <span className="mt-0.5 block font-medium text-[var(--ff-color-foreground)]">
              {snap.styleName}
            </span>
            <span className="block text-[var(--ff-color-muted-foreground)]">
              {formatArtStyleCategoryLabel(snap.styleCategory)}
            </span>
          </div>
          <div>
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--ff-color-muted-foreground)]">
              Output Setup
            </span>
            <span className="mt-0.5 block font-medium text-[var(--ff-color-foreground)] tabular-nums">
              {preset.aspectRatio} · {preset.outputOrientation}
            </span>
            <span className="block text-[var(--ff-color-muted-foreground)]">
              {preset.detailLevel} detail ·{' '}
              {preset.backgroundTreatment.replace(/_/g, ' ')}
            </span>
          </div>
        </div>

        {preset.userCreativeInstructions ? (
          <p className="line-clamp-2 text-[12px] text-[var(--ff-color-foreground)]">
            <span className="font-medium text-[var(--ff-color-muted-foreground)]">
              Instructions:{' '}
            </span>
            {preset.userCreativeInstructions}
          </p>
        ) : null}

        {preset.tags.length > 0 ? (
          <p className="text-[12px] text-[var(--ff-color-muted-foreground)]">
            {preset.tags.map((tag) => `#${tag}`).join('  ')}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--ff-color-border)] pt-3.5">
        <Button
          type="button"
          variant="primary"
          size="sm"
          loading={isApplying}
          data-testid={`apply-preset-btn-${preset.id}`}
          leftIcon={<Play className="h-3.5 w-3.5" aria-hidden="true" />}
          onClick={() => onApply(preset)}
        >
          Apply Preset
        </Button>

        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid={`edit-preset-btn-${preset.id}`}
            leftIcon={<Edit3 className="h-3.5 w-3.5" aria-hidden="true" />}
            onClick={() => onEdit(preset)}
          >
            Edit
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            loading={isDuplicating}
            data-testid={`duplicate-preset-btn-${preset.id}`}
            leftIcon={<Copy className="h-3.5 w-3.5" aria-hidden="true" />}
            onClick={() => onDuplicate(preset)}
          >
            Duplicate
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Delete preset ${preset.name}`}
            data-testid={`delete-preset-btn-${preset.id}`}
            onClick={() => onDeleteRequest(preset)}
          >
            <Trash2 className="h-3.5 w-3.5 text-[#B42318]" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </article>
  );
}

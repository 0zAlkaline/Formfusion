import { Check, Eye, Heart } from 'lucide-react';
import { formatArtStyleCategoryLabel } from '../../services/art-style/contract.ts';
import type { ArtStyle } from '../../types/domain.ts';
import { Badge, Button, Typography, cn } from '../ui/index.ts';
import { StylePreviewThumbnail } from './StylePreviewThumbnail.tsx';

interface StyleCardProps {
  readonly style: ArtStyle;
  readonly isFavorite: boolean;
  readonly isSelected: boolean;
  readonly isSelecting?: boolean;
  readonly onToggleFavorite: (styleId: string) => void;
  readonly onViewDetails: (style: ArtStyle) => void;
  readonly onSelectStyle: (style: ArtStyle) => void;
}

export function StyleCard({
  style,
  isFavorite,
  isSelected,
  isSelecting = false,
  onToggleFavorite,
  onViewDetails,
  onSelectStyle,
}: StyleCardProps) {
  const shortSummary = style.shortDescription ?? style.summary;
  const visibleTags = (style.tags ?? []).slice(0, 3);

  return (
    <article
      data-testid={`style-card-${style.slug}`}
      className={cn(
        'flex flex-col overflow-hidden rounded-[var(--ff-radius-lg)] border bg-[var(--ff-color-surface)] transition-colors duration-150',
        isSelected
          ? 'border-[var(--ff-color-primary)] ring-1 ring-[var(--ff-color-primary)]'
          : 'border-[var(--ff-color-border)] hover:border-[#C9C4B8]',
      )}
    >
      <div className="relative">
        <StylePreviewThumbnail style={style} />

        <button
          type="button"
          data-testid={`favorite-style-btn-${style.slug}`}
          aria-label={
            isFavorite
              ? `Remove ${style.name} from favorites`
              : `Favorite ${style.name}`
          }
          aria-pressed={isFavorite}
          onClick={() => onToggleFavorite(style.id)}
          className={cn(
            'absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full border transition-colors cursor-pointer',
            isFavorite
              ? 'border-[#E6C7C7] bg-[#FFFFFF] text-[#B42318]'
              : 'border-[var(--ff-color-border)] bg-[#FFFFFF]/92 text-[var(--ff-color-muted-foreground)] hover:text-[var(--ff-color-foreground)]',
          )}
        >
          <Heart
            className={cn('h-4 w-4', isFavorite ? 'fill-current' : '')}
            aria-hidden="true"
          />
        </button>
      </div>

      <div className="flex flex-1 flex-col justify-between gap-4 p-5">
        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--ff-color-muted-foreground)]">
              {formatArtStyleCategoryLabel(style.category)} · {style.detailLevel ?? 'balanced'}
            </span>
            {isSelected ? (
              <Badge tone="primary" data-testid={`selected-style-badge-${style.slug}`}>
                Active Style
              </Badge>
            ) : null}
          </div>

          <Typography variant="h3" className="leading-snug">
            {style.name}
          </Typography>

          <Typography variant="body-sm" muted className="line-clamp-2">
            {shortSummary}
          </Typography>

          {visibleTags.length > 0 ? (
            <p className="text-[12px] text-[var(--ff-color-muted-foreground)]">
              {visibleTags.map((tag) => `#${tag}`).join('  ')}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-[var(--ff-color-border)] pt-3.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid={`view-style-details-${style.slug}`}
            leftIcon={<Eye className="h-3.5 w-3.5" aria-hidden="true" />}
            onClick={() => onViewDetails(style)}
          >
            View Details
          </Button>

          <Button
            type="button"
            variant={isSelected ? 'secondary' : 'primary'}
            size="sm"
            loading={isSelecting}
            data-testid={`select-style-btn-${style.slug}`}
            leftIcon={
              isSelected ? (
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
              ) : undefined
            }
            onClick={() => onSelectStyle(style)}
          >
            {isSelected ? 'Use in Studio' : 'Select Style'}
          </Button>
        </div>
      </div>
    </article>
  );
}

import { Check, Heart } from 'lucide-react';
import { formatArtStyleCategoryLabel } from '../../services/art-style/contract.ts';
import type { ArtStyle } from '../../types/domain.ts';
import { Badge, Button, Modal, Typography } from '../ui/index.ts';
import { StylePreviewThumbnail } from './StylePreviewThumbnail.tsx';

interface StyleDetailsModalProps {
  readonly style: ArtStyle | null;
  readonly open: boolean;
  readonly isFavorite: boolean;
  readonly isSelected: boolean;
  readonly isSelecting?: boolean;
  readonly onClose: () => void;
  readonly onToggleFavorite: (styleId: string) => void;
  readonly onSelectStyle: (style: ArtStyle) => void;
}

interface RuleRowProps {
  readonly label: string;
  readonly value?: string;
}

function RuleRow({ label, value }: RuleRowProps) {
  if (!value || !value.trim()) {
    return null;
  }
  return (
    <div className="space-y-0.5 rounded-[var(--ff-radius-sm)] border border-[var(--ff-color-border)] bg-[var(--ff-color-surface-elevated)] p-3">
      <span className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--ff-color-muted-foreground)]">
        {label}
      </span>
      <p className="text-[13px] leading-relaxed text-[var(--ff-color-foreground)]">
        {value}
      </p>
    </div>
  );
}

export function StyleDetailsModal({
  style,
  open,
  isFavorite,
  isSelected,
  isSelecting = false,
  onClose,
  onToggleFavorite,
  onSelectStyle,
}: StyleDetailsModalProps) {
  if (!style) {
    return null;
  }

  const renderingText =
    style.renderingTechnique ??
    style.renderingRules ??
    style.mediumKeywords.join(', ');
  const shadingText = style.shadingRules ?? style.lightingKeywords.join(', ');
  const negativeText =
    style.negativePromptTemplate ?? style.defaultNegativeDirectives.join(', ');

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={style.name}
      description={`${formatArtStyleCategoryLabel(style.category)} · Detail Level: ${style.detailLevel ?? 'balanced'}`}
      size="lg"
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            onClick={() => onToggleFavorite(style.id)}
            leftIcon={
              <Heart
                className={
                  isFavorite
                    ? 'h-4 w-4 fill-[#B42318] text-[#B42318]'
                    : 'h-4 w-4'
                }
                aria-hidden="true"
              />
            }
          >
            {isFavorite ? 'Favorited' : 'Add to Favorites'}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button
            type="button"
            variant="primary"
            loading={isSelecting}
            data-testid="modal-select-this-style-btn"
            leftIcon={
              isSelected ? (
                <Check className="h-4 w-4" aria-hidden="true" />
              ) : undefined
            }
            onClick={() => onSelectStyle(style)}
          >
            Select This Style
          </Button>
        </>
      }
    >
      <div
        data-testid="style-details-modal-content"
        className="max-h-[68vh] space-y-5 overflow-y-auto pr-1"
      >
        <div className="overflow-hidden rounded-[var(--ff-radius-md)] border border-[var(--ff-color-border)]">
          <StylePreviewThumbnail style={style} compact />
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="neutral">
              {formatArtStyleCategoryLabel(style.category)}
            </Badge>
            <Badge tone="info">
              {style.detailLevel ?? 'balanced'} detail
            </Badge>
            {isSelected ? (
              <Badge tone="primary">Currently Active in Project</Badge>
            ) : null}
          </div>

          <Typography variant="body">
            {style.description ?? style.summary}
          </Typography>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <RuleRow
            label="Visual Characteristics"
            value={
              style.visualCharacteristics ?? style.styleDirectives.join('; ')
            }
          />
          <RuleRow label="Rendering Technique" value={renderingText} />
          <RuleRow label="Linework Rules" value={style.lineworkRules} />
          <RuleRow label="Color Rules" value={style.colorRules} />
          <RuleRow label="Texture Rules" value={style.textureRules} />
          <RuleRow label="Shading & Lighting Rules" value={shadingText} />
          <RuleRow label="Composition Rules" value={style.compositionRules} />
          <RuleRow
            label="Recommended Aspect Ratios"
            value={style.recommendedAspectRatios.join(' · ')}
          />
        </div>

        {negativeText ? (
          <RuleRow label="Negative Guidance" value={negativeText} />
        ) : null}

        {style.tags && style.tags.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-[var(--ff-color-border)] pt-3 text-[12px] text-[var(--ff-color-muted-foreground)]">
            <span className="font-semibold uppercase tracking-wider">Tags:</span>
            {style.tags.map((tag) => (
              <span key={tag} className="font-medium text-[var(--ff-color-foreground)]">
                #{tag}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

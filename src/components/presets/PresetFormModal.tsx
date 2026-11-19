import { useEffect, useMemo, useState } from 'react';
import {
  CURATED_ART_STYLES,
  formatArtStyleCategoryLabel,
} from '../../services/art-style/contract.ts';
import {
  buildPresetSnapshotFromArtStyle,
  buildPresetSnapshotFromManual,
  manualInputFromSnapshot,
} from '../../services/presets/presetService.ts';
import {
  createDefaultCompositionPreferences,
  createDefaultManualCreativeDirection,
  deriveOutputOrientation,
} from '../../services/prompt-composer/contract.ts';
import type {
  ArtStyle,
  AspectRatio,
  CreativeDirectionMode,
  PersonalPreset,
  PromptBackgroundTreatment,
  PromptDetailLevel,
  PromptOutputOrientation,
} from '../../types/domain.ts';
import type {
  ManualCreativeDirectionInput,
  SavePersonalPresetInput,
} from '../../types/services.ts';
import {
  Alert,
  Button,
  Modal,
  Select,
  SurfacePanel,
  Textarea,
  TextInput,
  Typography,
  cn,
} from '../ui/index.ts';

export interface PresetFormModalProps {
  readonly open: boolean;
  readonly mode: 'create' | 'edit';
  readonly initialPreset?: PersonalPreset | null;
  readonly initialDraft?: Partial<SavePersonalPresetInput> | null;
  readonly availableStyles?: readonly ArtStyle[];
  readonly isSubmitting?: boolean;
  readonly errorMessage?: string | null;
  readonly onClose: () => void;
  readonly onSubmit: (input: SavePersonalPresetInput) => Promise<void> | void;
}

const STYLE_CATEGORY_OPTIONS = [
  { value: 'illustration', label: 'Illustration' },
  { value: 'graphic_design', label: 'Graphic Design' },
  { value: 'line_art', label: 'Line Art' },
  { value: 'traditional_art', label: 'Traditional Art' },
  { value: 'digital_art', label: 'Digital Art' },
  { value: '3d_art', label: '3D Art' },
  { value: 'painterly', label: 'Painterly' },
  { value: 'mixed_media', label: 'Mixed Media' },
] as const;

const ASPECT_RATIO_OPTIONS: readonly { value: AspectRatio; label: string }[] = [
  { value: '1:1', label: '1:1 (Square)' },
  { value: '4:3', label: '4:3 (Classic Landscape)' },
  { value: '3:4', label: '3:4 (Classic Portrait)' },
  { value: '16:9', label: '16:9 (Widescreen)' },
  { value: '9:16', label: '9:16 (Vertical)' },
  { value: '3:2', label: '3:2 (Editorial Landscape)' },
  { value: '2:3', label: '2:3 (Editorial Portrait)' },
];

const ORIENTATION_OPTIONS: readonly {
  value: PromptOutputOrientation;
  label: string;
}[] = [
  { value: 'square', label: 'Square' },
  { value: 'portrait', label: 'Portrait' },
  { value: 'landscape', label: 'Landscape' },
];

const BACKGROUND_OPTIONS: readonly {
  value: PromptBackgroundTreatment;
  label: string;
}[] = [
  { value: 'preserve_clean', label: 'Preserve Clean Studio Backdrop' },
  { value: 'neutral_studio', label: 'Neutral Seamless Studio' },
  { value: 'editorial_backdrop', label: 'Subtle Editorial Backdrop' },
  { value: 'minimal_gradient', label: 'Minimal Tonal Gradient' },
  { value: 'environmental_match', label: 'Match Described Environment' },
];

const DETAIL_LEVEL_OPTIONS: readonly {
  value: PromptDetailLevel;
  label: string;
}[] = [
  { value: 'minimal', label: 'Minimal' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'high', label: 'High Detail' },
  { value: 'intricate', label: 'Intricate' },
];

export function PresetFormModal({
  open,
  mode,
  initialPreset = null,
  initialDraft = null,
  availableStyles = CURATED_ART_STYLES,
  isSubmitting = false,
  errorMessage = null,
  onClose,
  onSubmit,
}: PresetFormModalProps) {
  const defaultPrefs = createDefaultCompositionPreferences();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [directionMode, setDirectionMode] =
    useState<CreativeDirectionMode>('curated');
  const [selectedStyleId, setSelectedStyleId] = useState<string>(
    availableStyles[0]?.id ?? '',
  );
  const [manualInput, setManualInput] = useState<ManualCreativeDirectionInput>(
    () => createDefaultManualCreativeDirection(),
  );
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>(
    defaultPrefs.aspectRatio,
  );
  const [outputOrientation, setOutputOrientation] =
    useState<PromptOutputOrientation>(defaultPrefs.outputOrientation);
  const [backgroundTreatment, setBackgroundTreatment] =
    useState<PromptBackgroundTreatment>(defaultPrefs.backgroundTreatment);
  const [detailLevel, setDetailLevel] = useState<PromptDetailLevel>(
    defaultPrefs.detailLevel,
  );
  const [compositionDirection, setCompositionDirection] = useState<string>(
    defaultPrefs.compositionDirection,
  );
  const [userCreativeInstructions, setUserCreativeInstructions] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    setLocalError(null);

    if (initialPreset) {
      setName(initialPreset.name);
      setDescription(initialPreset.description);
      setDirectionMode(initialPreset.creativeDirectionMode);
      setSelectedStyleId(
        initialPreset.selectedStyleId ??
          initialPreset.creativeDirectionSnapshot.styleId ??
          availableStyles[0]?.id ??
          '',
      );
      setManualInput(
        initialPreset.creativeDirectionMode === 'manual'
          ? manualInputFromSnapshot(initialPreset.creativeDirectionSnapshot)
          : createDefaultManualCreativeDirection(),
      );
      setAspectRatio(initialPreset.aspectRatio);
      setOutputOrientation(initialPreset.outputOrientation);
      setBackgroundTreatment(initialPreset.backgroundTreatment);
      setDetailLevel(initialPreset.detailLevel);
      setCompositionDirection(initialPreset.compositionDirection);
      setUserCreativeInstructions(initialPreset.userCreativeInstructions);
      setNegativePrompt(initialPreset.negativePrompt);
      setTagsText(initialPreset.tags.join(', '));
      return;
    }

    if (initialDraft) {
      const snap = initialDraft.creativeDirectionSnapshot;
      const draftMode: CreativeDirectionMode =
        initialDraft.creativeDirectionMode ??
        (snap?.source === 'manual' ? 'manual' : 'curated');
      setName(initialDraft.name ?? '');
      setDescription(initialDraft.description ?? '');
      setDirectionMode(draftMode);
      setSelectedStyleId(
        initialDraft.selectedStyleId ??
          snap?.styleId ??
          availableStyles[0]?.id ??
          '',
      );
      setManualInput(
        draftMode === 'manual' && snap
          ? manualInputFromSnapshot(snap)
          : createDefaultManualCreativeDirection(),
      );
      const nextRatio = initialDraft.aspectRatio ?? '1:1';
      setAspectRatio(nextRatio);
      setOutputOrientation(
        initialDraft.outputOrientation ?? deriveOutputOrientation(nextRatio),
      );
      setBackgroundTreatment(
        initialDraft.backgroundTreatment ?? 'preserve_clean',
      );
      setDetailLevel(initialDraft.detailLevel ?? 'balanced');
      setCompositionDirection(
        initialDraft.compositionDirection ?? 'Preserve source framing',
      );
      setUserCreativeInstructions(initialDraft.userCreativeInstructions ?? '');
      setNegativePrompt(initialDraft.negativePrompt ?? '');
      setTagsText((initialDraft.tags ?? []).join(', '));
      return;
    }

    const fallbackStyle = availableStyles[0] ?? null;
    setName('');
    setDescription('');
    setDirectionMode('curated');
    setSelectedStyleId(fallbackStyle?.id ?? '');
    setManualInput(createDefaultManualCreativeDirection());
    setAspectRatio('1:1');
    setOutputOrientation('square');
    setBackgroundTreatment('preserve_clean');
    setDetailLevel(fallbackStyle?.detailLevel ?? 'balanced');
    setCompositionDirection('Preserve source framing');
    setUserCreativeInstructions('');
    setNegativePrompt('');
    setTagsText('');
  }, [open, initialPreset, initialDraft, availableStyles]);

  const selectedCuratedStyle = useMemo(
    () => availableStyles.find((s) => s.id === selectedStyleId) ?? null,
    [availableStyles, selectedStyleId],
  );

  const handleSave = async () => {
    setLocalError(null);
    if (!name.trim()) {
      setLocalError('Preset Name is required.');
      return;
    }

    let snapshot;
    let styleRefId: string | null = null;

    if (directionMode === 'curated') {
      if (selectedCuratedStyle) {
        snapshot = buildPresetSnapshotFromArtStyle(selectedCuratedStyle);
        styleRefId = selectedCuratedStyle.id;
      } else if (
        initialPreset &&
        initialPreset.creativeDirectionMode === 'curated'
      ) {
        // Snapshot isolation fallback if catalog style is no longer listed.
        snapshot = initialPreset.creativeDirectionSnapshot;
        styleRefId = initialPreset.selectedStyleId;
      } else {
        setLocalError('Select a curated Art Style or switch to Manual mode.');
        return;
      }
    } else {
      if (!manualInput.styleName.trim()) {
        setLocalError('Style Name is required in Manual Creative Direction.');
        return;
      }
      const hasManualRule = Boolean(
        manualInput.styleDescription.trim() ||
          manualInput.visualCharacteristics?.trim() ||
          manualInput.renderingRules?.trim() ||
          manualInput.lineworkRules?.trim() ||
          manualInput.colorRules?.trim() ||
          manualInput.textureRules?.trim() ||
          manualInput.shadingRules?.trim() ||
          manualInput.compositionRules?.trim(),
      );
      if (!hasManualRule) {
        setLocalError(
          'Provide a Style Description or at least one artistic rule in Manual Creative Direction.',
        );
        return;
      }
      snapshot = buildPresetSnapshotFromManual(manualInput);
    }

    const parsedTags = tagsText
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    await onSubmit({
      name: name.trim(),
      description: description.trim(),
      creativeDirectionMode: directionMode,
      selectedStyleId: styleRefId,
      creativeDirectionSnapshot: snapshot,
      aspectRatio,
      outputOrientation,
      backgroundTreatment,
      detailLevel,
      compositionDirection:
        compositionDirection.trim() || 'Preserve source framing',
      userCreativeInstructions: userCreativeInstructions.trim(),
      negativePrompt: negativePrompt.trim(),
      tags: parsedTags,
    });
  };

  const displayError = localError ?? errorMessage;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === 'edit' ? 'Edit Personal Preset' : 'Create Personal Preset'}
      description="Save a reusable creative direction snapshot, output preferences, and prompt instructions locally."
      size="lg"
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            loading={isSubmitting}
            data-testid="preset-modal-save-btn"
            onClick={() => void handleSave()}
          >
            {mode === 'edit' ? 'Save Preset Changes' : 'Save Preset'}
          </Button>
        </>
      }
    >
      <div className="max-h-[68vh] space-y-5 overflow-y-auto pr-1">
        {displayError ? (
          <Alert
            tone="destructive"
            title="Unable to save preset"
            description={displayError}
          />
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput
            id="preset-name-input"
            label="Preset Name *"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isSubmitting}
            placeholder="e.g., Editorial Ceramic Study 4:3"
          />
          <TextInput
            id="preset-tags-input"
            label="Tags (comma-separated)"
            value={tagsText}
            onChange={(e) => setTagsText(e.target.value)}
            disabled={isSubmitting}
            placeholder="e.g., editorial, tabletop, warm light"
          />
        </div>

        <Textarea
          id="preset-description-input"
          label="Description"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={isSubmitting}
          placeholder="Short studio note explaining when to apply this preset."
        />

        {/* Creative Direction Mode */}
        <div className="space-y-3 rounded-[var(--ff-radius-md)] border border-[var(--ff-color-border)] bg-[var(--ff-color-surface-elevated)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Typography variant="label">Creative Direction Source</Typography>
            <div className="inline-flex rounded-[var(--ff-radius-md)] border border-[var(--ff-color-border)] bg-[var(--ff-color-surface)] p-0.5">
              <button
                type="button"
                data-testid="preset-mode-curated"
                onClick={() => setDirectionMode('curated')}
                className={cn(
                  'rounded-[var(--ff-radius-sm)] px-3 py-1 text-[12px] font-medium transition-colors cursor-pointer',
                  directionMode === 'curated'
                    ? 'bg-[var(--ff-color-primary)] text-white'
                    : 'text-[var(--ff-color-muted-foreground)] hover:text-[var(--ff-color-foreground)]',
                )}
              >
                Curated Style
              </button>
              <button
                type="button"
                data-testid="preset-mode-manual"
                onClick={() => setDirectionMode('manual')}
                className={cn(
                  'rounded-[var(--ff-radius-sm)] px-3 py-1 text-[12px] font-medium transition-colors cursor-pointer',
                  directionMode === 'manual'
                    ? 'bg-[var(--ff-color-primary)] text-white'
                    : 'text-[var(--ff-color-muted-foreground)] hover:text-[var(--ff-color-foreground)]',
                )}
              >
                Manual Creative Direction
              </button>
            </div>
          </div>

          {directionMode === 'curated' ? (
            <div className="space-y-3">
              <Select
                id="preset-curated-style-select"
                label="Curated Art Style *"
                value={selectedStyleId}
                onChange={(e) => {
                  const nextId = e.target.value;
                  setSelectedStyleId(nextId);
                  const found = availableStyles.find((s) => s.id === nextId);
                  if (found?.detailLevel) {
                    setDetailLevel(found.detailLevel);
                  }
                }}
                disabled={isSubmitting}
                options={availableStyles.map((style) => ({
                  value: style.id,
                  label: `${style.name} (${formatArtStyleCategoryLabel(style.category)})`,
                }))}
              />

              {selectedCuratedStyle ? (
                <SurfacePanel tone="default" padding="sm" className="space-y-1">
                  <Typography variant="caption" muted className="block">
                    Captured Creative Direction Snapshot (isolated from future catalog changes)
                  </Typography>
                  <Typography variant="body-sm">
                    {selectedCuratedStyle.shortDescription ??
                      selectedCuratedStyle.summary}
                  </Typography>
                </SurfacePanel>
              ) : null}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <TextInput
                  id="preset-manual-style-name"
                  label="Style Name *"
                  value={manualInput.styleName}
                  onChange={(e) =>
                    setManualInput((prev) => ({
                      ...prev,
                      styleName: e.target.value,
                    }))
                  }
                  disabled={isSubmitting}
                  placeholder="e.g., Warm Architectural Charcoal"
                />
                <Select
                  id="preset-manual-style-category"
                  label="Style Category"
                  value={manualInput.styleCategory ?? 'illustration'}
                  onChange={(e) =>
                    setManualInput((prev) => ({
                      ...prev,
                      styleCategory: e.target.value,
                    }))
                  }
                  disabled={isSubmitting}
                  options={[...STYLE_CATEGORY_OPTIONS]}
                />
              </div>

              <Textarea
                id="preset-manual-style-description"
                label="Style Description *"
                rows={2}
                value={manualInput.styleDescription}
                onChange={(e) =>
                  setManualInput((prev) => ({
                    ...prev,
                    styleDescription: e.target.value,
                  }))
                }
                disabled={isSubmitting}
                placeholder="Overall aesthetic, medium, and finish."
              />

              <div className="grid gap-3 sm:grid-cols-2">
                <TextInput
                  id="preset-manual-rendering"
                  label="Rendering Technique"
                  value={manualInput.renderingRules ?? ''}
                  onChange={(e) =>
                    setManualInput((prev) => ({
                      ...prev,
                      renderingRules: e.target.value,
                    }))
                  }
                  disabled={isSubmitting}
                  placeholder="e.g., Dry charcoal on laid cotton paper"
                />
                <TextInput
                  id="preset-manual-color"
                  label="Color Rules"
                  value={manualInput.colorRules ?? ''}
                  onChange={(e) =>
                    setManualInput((prev) => ({
                      ...prev,
                      colorRules: e.target.value,
                    }))
                  }
                  disabled={isSubmitting}
                  placeholder="e.g., Warm graphite and ivory"
                />
                <TextInput
                  id="preset-manual-linework"
                  label="Linework Rules"
                  value={manualInput.lineworkRules ?? ''}
                  onChange={(e) =>
                    setManualInput((prev) => ({
                      ...prev,
                      lineworkRules: e.target.value,
                    }))
                  }
                  disabled={isSubmitting}
                  placeholder="e.g., Varied contour weight"
                />
                <TextInput
                  id="preset-manual-shading"
                  label="Shading & Lighting"
                  value={manualInput.shadingRules ?? ''}
                  onChange={(e) =>
                    setManualInput((prev) => ({
                      ...prev,
                      shadingRules: e.target.value,
                    }))
                  }
                  disabled={isSubmitting}
                  placeholder="e.g., Soft studio side-light"
                />
              </div>
            </div>
          )}
        </div>

        {/* Output Preferences */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select
            id="preset-aspect-ratio"
            label="Aspect Ratio"
            value={aspectRatio}
            onChange={(e) => {
              const next = e.target.value as AspectRatio;
              setAspectRatio(next);
              setOutputOrientation(deriveOutputOrientation(next));
            }}
            disabled={isSubmitting}
            options={[...ASPECT_RATIO_OPTIONS]}
          />
          <Select
            id="preset-orientation"
            label="Output Orientation"
            value={outputOrientation}
            onChange={(e) =>
              setOutputOrientation(e.target.value as PromptOutputOrientation)
            }
            disabled={isSubmitting}
            options={[...ORIENTATION_OPTIONS]}
          />
          <Select
            id="preset-background"
            label="Background Treatment"
            value={backgroundTreatment}
            onChange={(e) =>
              setBackgroundTreatment(e.target.value as PromptBackgroundTreatment)
            }
            disabled={isSubmitting}
            options={[...BACKGROUND_OPTIONS]}
          />
          <Select
            id="preset-detail-level"
            label="Detail Level"
            value={detailLevel}
            onChange={(e) =>
              setDetailLevel(e.target.value as PromptDetailLevel)
            }
            disabled={isSubmitting}
            options={[...DETAIL_LEVEL_OPTIONS]}
          />
        </div>

        <TextInput
          id="preset-composition-direction"
          label="Composition Direction"
          value={compositionDirection}
          onChange={(e) => setCompositionDirection(e.target.value)}
          disabled={isSubmitting}
          placeholder="e.g., Preserve source framing with calm left margin"
        />

        <Textarea
          id="preset-user-instructions"
          label="User Creative Instructions"
          rows={2}
          value={userCreativeInstructions}
          onChange={(e) => setUserCreativeInstructions(e.target.value)}
          disabled={isSubmitting}
          placeholder="Reusable creative cues or exclusions to merge into Prompt Composer..."
        />

        <Textarea
          id="preset-negative-prompt"
          label="Default Negative Prompt"
          rows={2}
          value={negativePrompt}
          onChange={(e) => setNegativePrompt(e.target.value)}
          disabled={isSubmitting}
          placeholder="Optional negative directives to load when applying this preset..."
        />
      </div>
    </Modal>
  );
}

import { CheckCircle2, FileEdit, RotateCcw, Save } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  areEditableFieldsEqual,
  extractEditableFieldsFromAnalysis,
  extractEditableFieldsFromDescription,
  formatDelimitedList,
  formatMultiItemList,
  parseDelimitedListInput,
  parseLineOrSemicolonListInput,
  validateEditableDescriptionFields,
} from '../../services/object-description/contract.ts';
import type { ServiceResult } from '../../types/common.ts';
import type { ObjectAnalysis, ObjectDescription } from '../../types/domain.ts';
import type {
  ObjectDescriptionEditableFields,
  ObjectDescriptionFieldErrors,
} from '../../types/services.ts';
import {
  Alert,
  Badge,
  Button,
  ConfirmationDialog,
  SurfacePanel,
  Textarea,
  TextInput,
  Typography,
} from '../ui/index.ts';

export interface EditableObjectDescriptionPanelProps {
  readonly analysis: ObjectAnalysis;
  readonly description: ObjectDescription;
  readonly sourceAssetFileName: string;
  readonly isLocked?: boolean;
  readonly onSaveDescription: (
    draft: ObjectDescriptionEditableFields,
  ) => Promise<ServiceResult<ObjectDescription>>;
  readonly onResetToAnalysis: () => Promise<ServiceResult<ObjectDescription>>;
  readonly onDirtyChange?: (isDirty: boolean) => void;
}

interface EditorDraftStrings {
  readonly objectName: string;
  readonly objectCategory: string;
  readonly primaryDescription: string;
  readonly shapeAndSilhouette: string;
  readonly materialsText: string;
  readonly dominantColorsText: string;
  readonly surfaceDetails: string;
  readonly distinctiveFeaturesText: string;
  readonly composition: string;
  readonly viewingAngle: string;
  readonly preservationPrioritiesText: string;
  readonly uncertainAttributesText: string;
  readonly userNotes: string;
}

function toDraftStrings(
  description: ObjectDescription,
): EditorDraftStrings {
  return {
    objectName: description.objectName,
    objectCategory: description.objectCategory,
    primaryDescription: description.primaryDescription,
    shapeAndSilhouette: description.shapeAndSilhouette,
    materialsText: formatDelimitedList(description.materials),
    dominantColorsText: formatDelimitedList(description.dominantColors),
    surfaceDetails: description.surfaceDetails,
    distinctiveFeaturesText: formatMultiItemList(description.distinctiveFeatures),
    composition: description.composition,
    viewingAngle: description.viewingAngle,
    preservationPrioritiesText: formatMultiItemList(
      description.preservationPriorities,
    ),
    uncertainAttributesText: formatMultiItemList(
      description.uncertainAttributes,
    ),
    userNotes: description.userNotes,
  };
}

function draftStringsToEditableFields(
  draft: EditorDraftStrings,
): ObjectDescriptionEditableFields {
  return {
    objectName: draft.objectName,
    objectCategory: draft.objectCategory,
    primaryDescription: draft.primaryDescription,
    shapeAndSilhouette: draft.shapeAndSilhouette,
    materials: parseDelimitedListInput(draft.materialsText),
    dominantColors: parseDelimitedListInput(draft.dominantColorsText),
    surfaceDetails: draft.surfaceDetails,
    distinctiveFeatures: parseLineOrSemicolonListInput(
      draft.distinctiveFeaturesText,
    ),
    composition: draft.composition,
    viewingAngle: draft.viewingAngle,
    preservationPriorities: parseLineOrSemicolonListInput(
      draft.preservationPrioritiesText,
    ),
    uncertainAttributes: parseLineOrSemicolonListInput(
      draft.uncertainAttributesText,
    ),
    userNotes: draft.userNotes,
  };
}

export function EditableObjectDescriptionPanel({
  analysis,
  description,
  sourceAssetFileName,
  isLocked = false,
  onSaveDescription,
  onResetToAnalysis,
  onDirtyChange,
}: EditableObjectDescriptionPanelProps) {
  const [draft, setDraft] = useState<EditorDraftStrings>(() =>
    toDraftStrings(description),
  );
  const [fieldErrors, setFieldErrors] = useState<ObjectDescriptionFieldErrors>(
    {},
  );
  const [storageError, setStorageError] = useState<string | null>(null);
  const [failedAction, setFailedAction] = useState<'save' | 'reset' | null>(
    null,
  );
  const [isSaving, setIsSaving] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [saveSuccessNotice, setSaveSuccessNotice] = useState<string | null>(null);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);

  // Sync local draft only when switching to a newly saved/restored persisted revision
  useEffect(() => {
    setDraft(toDraftStrings(description));
    setFieldErrors({});
    setStorageError(null);
    setFailedAction(null);
  }, [description]);

  const currentEditableFields = useMemo(
    () => draftStringsToEditableFields(draft),
    [draft],
  );
  const persistedEditableFields = useMemo(
    () => extractEditableFieldsFromDescription(description),
    [description],
  );
  const analysisBaselineFields = useMemo(
    () => extractEditableFieldsFromAnalysis(analysis),
    [analysis],
  );

  const isDirty = useMemo(
    () => !areEditableFieldsEqual(currentEditableFields, persistedEditableFields),
    [currentEditableFields, persistedEditableFields],
  );

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const differsFromAnalysis = useMemo(
    () => !areEditableFieldsEqual(currentEditableFields, analysisBaselineFields),
    [currentEditableFields, analysisBaselineFields],
  );

  const controlsBusy = isLocked || isSaving || isResetting;

  const updateField = <K extends keyof EditorDraftStrings>(
    key: K,
    value: EditorDraftStrings[K],
  ) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setSaveSuccessNotice(null);
    setStorageError(null);
    setFailedAction(null);
    if (
      (key === 'objectName' ||
        key === 'objectCategory' ||
        key === 'primaryDescription') &&
      value.trim().length > 0
    ) {
      setFieldErrors((prev) => ({ ...prev, [key]: undefined }));
    }
  };

  const executeSave = async () => {
    if (controlsBusy) {
      return;
    }

    const validation = validateEditableDescriptionFields(currentEditableFields);
    if (!validation.valid) {
      setFieldErrors(validation.fieldErrors);
      setSaveSuccessNotice(null);
      return;
    }

    setIsSaving(true);
    setStorageError(null);
    setFailedAction(null);
    setSaveSuccessNotice(null);

    try {
      const result = await onSaveDescription(validation.normalized);
      if (!result.ok) {
        setStorageError(result.error.message);
        setFailedAction('save');
        return;
      }

      setDraft(toDraftStrings(result.data));
      setFieldErrors({});
      setSaveSuccessNotice(
        `Saved revision v${result.data.version} to IndexedDB at ${new Date(result.data.updatedAt).toLocaleTimeString()}.`,
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void executeSave();
  };

  const executeReset = async () => {
    if (controlsBusy) {
      return;
    }

    setConfirmResetOpen(false);
    setIsResetting(true);
    setStorageError(null);
    setFailedAction(null);
    setSaveSuccessNotice(null);

    try {
      const result = await onResetToAnalysis();
      if (!result.ok) {
        setStorageError(result.error.message);
        setFailedAction('reset');
        return;
      }

      setDraft(toDraftStrings(result.data));
      setFieldErrors({});
      setSaveSuccessNotice(
        `Restored fields from Original AI Analysis (revision v${result.data.version} saved).`,
      );
    } finally {
      setIsResetting(false);
    }
  };

  const canReset = isDirty || differsFromAnalysis;

  const handleResetClick = () => {
    if (controlsBusy || !canReset) {
      return;
    }
    setConfirmResetOpen(true);
  };

  const hasValidationErrors = Boolean(
    fieldErrors.objectName ||
      fieldErrors.objectCategory ||
      fieldErrors.primaryDescription,
  );

  const statusBadge = isSaving ? (
    <Badge tone="info">Saving...</Badge>
  ) : isResetting ? (
    <Badge tone="info">Resetting...</Badge>
  ) : storageError ? (
    <Badge tone="destructive">Save Failed</Badge>
  ) : isDirty ? (
    <Badge tone="warning" data-testid="description-dirty-badge">
      Unsaved Changes
    </Badge>
  ) : (
    <Badge tone="success" data-testid="description-saved-badge">
      Saved · v{description.version}
    </Badge>
  );

  return (
    <SurfacePanel
      tone="default"
      padding="md"
      className="space-y-5"
      data-testid="editable-object-description-panel"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--ff-color-border)] pb-3.5">
        <div className="flex items-start gap-2.5">
          <FileEdit
            className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ff-color-primary)]"
            aria-hidden="true"
          />
          <div>
            <Typography variant="h3">Editable Object Description</Typography>
            <Typography variant="caption" muted className="block mt-0.5">
              Review and refine the AI-identified object details before continuing to creative direction.
            </Typography>
            <Typography variant="caption" muted className="block mt-1 tabular-nums">
              Source: {sourceAssetFileName} · Revision v{description.version} · Last saved{' '}
              {new Date(description.updatedAt).toLocaleString()}
            </Typography>
          </div>
        </div>

        <div className="flex items-center gap-2">{statusBadge}</div>
      </div>

      {storageError ? (
        <Alert
          tone="destructive"
          title={
            failedAction === 'reset'
              ? 'Could not reset object description'
              : 'Could not save object description'
          }
          description={`${storageError} Your current edits remain intact in the editor.`}
          action={
            <Button
              variant="outline"
              size="sm"
              leftIcon={<RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />}
              disabled={controlsBusy}
              onClick={() =>
                void (failedAction === 'reset' ? executeReset() : executeSave())
              }
            >
              Retry
            </Button>
          }
        />
      ) : null}

      {hasValidationErrors ? (
        <Alert
          tone="destructive"
          title="Required description fields cannot be empty"
          description="Provide non-empty values for Object Name, Object Category, and Primary Description before saving."
        />
      ) : null}

      {saveSuccessNotice && !isDirty && !storageError ? (
        <div
          role="status"
          data-testid="description-save-success"
          className="flex items-center gap-2 rounded-[var(--ff-radius-md)] border border-[#C3DFCF] bg-[var(--ff-color-success-subtle)] px-3.5 py-2.5 text-[13px] font-medium text-[var(--ff-color-success)]"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{saveSuccessNotice}</span>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} noValidate className="space-y-6">
        {/* GROUP A — Object Identity */}
        <section aria-labelledby="group-object-identity" className="space-y-4">
          <div className="border-b border-[var(--ff-color-border)] pb-2">
            <h4
              id="group-object-identity"
              className="text-[13px] font-semibold uppercase tracking-wider text-[var(--ff-color-foreground)]"
            >
              Group A · Object Identity
            </h4>
            <p className="text-[12px] text-[var(--ff-color-muted-foreground)]">
              Core subject identification required before creative prompt composition.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput
              id="field-object-name"
              label="Object Name *"
              value={draft.objectName}
              onChange={(e) => updateField('objectName', e.target.value)}
              error={fieldErrors.objectName}
              disabled={controlsBusy}
              placeholder="e.g., Hand-thrown stoneware pitcher"
            />
            <TextInput
              id="field-object-category"
              label="Object Category *"
              value={draft.objectCategory}
              onChange={(e) => updateField('objectCategory', e.target.value)}
              error={fieldErrors.objectCategory}
              disabled={controlsBusy}
              placeholder="e.g., Ceramic tableware / vessel"
            />
          </div>

          <Textarea
            id="field-primary-description"
            label="Primary Description *"
            rows={3}
            value={draft.primaryDescription}
            onChange={(e) => updateField('primaryDescription', e.target.value)}
            error={fieldErrors.primaryDescription}
            disabled={controlsBusy}
            placeholder="Concise factual description of the main subject."
          />
        </section>

        {/* GROUP B — Physical Characteristics */}
        <section aria-labelledby="group-physical-characteristics" className="space-y-4">
          <div className="border-b border-[var(--ff-color-border)] pb-2">
            <h4
              id="group-physical-characteristics"
              className="text-[13px] font-semibold uppercase tracking-wider text-[var(--ff-color-foreground)]"
            >
              Group B · Physical Characteristics
            </h4>
            <p className="text-[12px] text-[var(--ff-color-muted-foreground)]">
              Refine structural silhouette, materials, palette, and observable surface traits.
            </p>
          </div>

          <Textarea
            id="field-shape-silhouette"
            label="Shape and Silhouette"
            rows={2}
            value={draft.shapeAndSilhouette}
            onChange={(e) => updateField('shapeAndSilhouette', e.target.value)}
            disabled={controlsBusy}
            placeholder="Overall proportions, profile, and contours"
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput
              id="field-materials"
              label="Materials"
              value={draft.materialsText}
              onChange={(e) => updateField('materialsText', e.target.value)}
              disabled={controlsBusy}
              hint="Comma-separated list (e.g., unglazed stoneware, glossy glaze)"
              placeholder="e.g., stoneware clay, matte ceramic glaze"
            />
            <TextInput
              id="field-dominant-colors"
              label="Dominant Colors"
              value={draft.dominantColorsText}
              onChange={(e) => updateField('dominantColorsText', e.target.value)}
              disabled={controlsBusy}
              hint="Comma-separated list (e.g., warm ivory, cobalt blue)"
              placeholder="e.g., warm cream, cobalt blue, raw umber"
            />
          </div>

          <Textarea
            id="field-surface-details"
            label="Surface Details"
            rows={2}
            value={draft.surfaceDetails}
            onChange={(e) => updateField('surfaceDetails', e.target.value)}
            disabled={controlsBusy}
            placeholder="Visible texture, finish, markings, wear, or sheen"
          />

          <Textarea
            id="field-distinctive-features"
            label="Distinctive Features"
            rows={2}
            value={draft.distinctiveFeaturesText}
            onChange={(e) => updateField('distinctiveFeaturesText', e.target.value)}
            disabled={controlsBusy}
            hint="One feature per line or separated by semicolons"
            placeholder="Key visual traits that identify this specific subject"
          />
        </section>

        {/* GROUP C — Visual Composition */}
        <section aria-labelledby="group-visual-composition" className="space-y-4">
          <div className="border-b border-[var(--ff-color-border)] pb-2">
            <h4
              id="group-visual-composition"
              className="text-[13px] font-semibold uppercase tracking-wider text-[var(--ff-color-foreground)]"
            >
              Group C · Visual Composition
            </h4>
            <p className="text-[12px] text-[var(--ff-color-muted-foreground)]">
              Framing, spatial placement, background notes, and camera perspective.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-[1fr_280px]">
            <Textarea
              id="field-composition"
              label="Composition"
              rows={2}
              value={draft.composition}
              onChange={(e) => updateField('composition', e.target.value)}
              disabled={controlsBusy}
              placeholder="Framing, spatial arrangement, and visible background"
            />
            <TextInput
              id="field-viewing-angle"
              label="Viewing Angle"
              value={draft.viewingAngle}
              onChange={(e) => updateField('viewingAngle', e.target.value)}
              disabled={controlsBusy}
              placeholder="e.g., Eye-level three-quarter view"
            />
          </div>
        </section>

        {/* GROUP D — Generation Guidance */}
        <section aria-labelledby="group-generation-guidance" className="space-y-4">
          <div className="border-b border-[var(--ff-color-border)] pb-2">
            <h4
              id="group-generation-guidance"
              className="text-[13px] font-semibold uppercase tracking-wider text-[var(--ff-color-foreground)]"
            >
              Group D · Generation Guidance
            </h4>
            <p className="text-[12px] text-[var(--ff-color-muted-foreground)]">
              Define preservation priorities and retain uncertainty without inventing unseen details.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Textarea
              id="field-preservation-priorities"
              label="Preservation Priorities"
              rows={3}
              value={draft.preservationPrioritiesText}
              onChange={(e) =>
                updateField('preservationPrioritiesText', e.target.value)
              }
              disabled={controlsBusy}
              hint="One priority per line or separated by semicolons"
              placeholder="Core visual traits to keep intact during later style transformation"
            />
            <Textarea
              id="field-uncertain-attributes"
              label="Uncertain / Ambiguous Attributes"
              rows={3}
              value={draft.uncertainAttributesText}
              onChange={(e) =>
                updateField('uncertainAttributesText', e.target.value)
              }
              disabled={controlsBusy}
              hint="One note per line or separated by semicolons"
              placeholder="Details that are obscured, cropped, or uncertain in the photo"
            />
          </div>

          <Textarea
            id="field-user-notes"
            label="Studio Notes"
            rows={2}
            value={draft.userNotes}
            onChange={(e) => updateField('userNotes', e.target.value)}
            disabled={controlsBusy}
            placeholder="Optional factual clarifications for prompt composition"
          />
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--ff-color-border)] pt-4">
          <Typography variant="caption" muted>
            {isDirty
              ? 'Unsaved edits in editor · Click Save Description to persist in IndexedDB.'
              : differsFromAnalysis
                ? 'Edited description persisted in IndexedDB · Original AI Analysis remains intact.'
                : 'Description matches Original AI Analysis baseline.'}
          </Typography>

          <div className="flex flex-wrap items-center gap-2.5">
            <Button
              type="button"
              variant="outline"
              size="md"
              leftIcon={<RotateCcw className="h-4 w-4" aria-hidden="true" />}
              disabled={controlsBusy || !canReset}
              loading={isResetting}
              onClick={handleResetClick}
            >
              Reset to AI Analysis
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="md"
              leftIcon={<Save className="h-4 w-4" aria-hidden="true" />}
              disabled={controlsBusy}
              loading={isSaving}
            >
              Save Description
            </Button>
          </div>
        </div>
      </form>

      <ConfirmationDialog
        open={confirmResetOpen}
        onClose={() => setConfirmResetOpen(false)}
        onConfirm={() => void executeReset()}
        title="Reset Object Description to AI Analysis"
        description="Discard your manual edits and restore all description fields from the stored Original AI Analysis? This does not call Gemini Vision again."
        confirmLabel="Reset Description"
        cancelLabel="Keep Current Edits"
        tone="destructive"
        loading={isResetting}
      />
    </SurfacePanel>
  );
}

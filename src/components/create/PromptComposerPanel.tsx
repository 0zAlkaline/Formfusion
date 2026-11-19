import {
  Bookmark,
  Check,
  CheckCircle2,
  Copy,
  History,
  Lock,
  Palette,
  RefreshCw,
  Save,
  Sparkles,
  Unlock,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStudioServices } from '../../app/providers/AppProviders.tsx';
import {
  CURATED_ART_STYLES,
  formatArtStyleCategoryLabel,
} from '../../services/art-style/contract.ts';
import {
  buildPresetSnapshotFromArtStyle,
  buildPresetSnapshotFromManual,
  manualInputFromSnapshot,
} from '../../services/presets/presetService.ts';
import type { PersistedPromptState } from '../../services/project-storage/browserProjectStorage.ts';
import {
  createDefaultCompositionPreferences,
  createDefaultManualCreativeDirection,
  deriveOutputOrientation,
  markPromptEdited,
  unlockApprovedPromptForNewRevision,
} from '../../services/prompt-composer/contract.ts';
import type { EntityId } from '../../types/common.ts';
import type {
  ArtStyle,
  AspectRatio,
  CreativeDirectionMode,
  ObjectDescription,
  PersonalPreset,
  ProjectCreativeConfiguration,
  PromptBackgroundTreatment,
  PromptCompositionPreferences,
  PromptDetailLevel,
  PromptDocument,
  PromptOutputOrientation,
} from '../../types/domain.ts';
import type {
  ManualCreativeDirectionInput,
  SavePersonalPresetInput,
} from '../../types/services.ts';
import { PresetFormModal } from '../presets/PresetFormModal.tsx';
import {
  Alert,
  Badge,
  Button,
  SurfacePanel,
  Textarea,
  TextInput,
  Select,
  Typography,
  cn,
} from '../ui/index.ts';

export interface PromptComposerPanelProps {
  readonly projectId: EntityId;
  readonly description: ObjectDescription;
  readonly hasUnsavedDescriptionEdits?: boolean;
  readonly selectedStyle?: ArtStyle | null;
  readonly activeCreativeConfiguration?: ProjectCreativeConfiguration | null;
  readonly availableStyles?: readonly ArtStyle[];
  readonly availablePresets?: readonly PersonalPreset[];
  readonly activePrompt: PromptDocument | null;
  readonly promptRevisions: readonly PromptDocument[];
  readonly isWorkspaceBusy?: boolean;
  readonly onSelectStyle?: (
    style: ArtStyle | null,
    nextMode: CreativeDirectionMode,
  ) => Promise<void> | void;
  readonly onApplyPreset?: (presetId: EntityId) => Promise<void> | void;
  readonly onPresetCreated?: () => Promise<void> | void;
  readonly onNavigate?: (path: string) => void;
  readonly onPromptPersisted: (state: PersistedPromptState) => void;
}

const STYLE_CATEGORY_OPTIONS = [
  { value: 'illustration', label: 'Illustration' },
  { value: 'graphic_design', label: 'Graphic Design' },
  { value: 'line_art', label: 'Line Art' },
  { value: 'traditional_art', label: 'Traditional Art' },
  { value: 'digital_art', label: 'Digital Art' },
  { value: '3d_art', label: '3D Art' },
  { value: 'painterly', label: 'Painterly' },
  { value: 'photographic', label: 'Photographic' },
  { value: 'sculptural', label: 'Sculptural' },
  { value: 'architectural', label: 'Architectural' },
  { value: 'digital', label: 'Digital' },
  { value: 'printmaking', label: 'Printmaking' },
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

const BACKGROUND_TREATMENT_OPTIONS: readonly {
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

function directionFromPromptDoc(
  doc: PromptDocument,
): ManualCreativeDirectionInput {
  const dir = doc.creativeDirection;
  if (!dir) {
    return createDefaultManualCreativeDirection();
  }
  return {
    styleName: dir.styleName,
    styleCategory: dir.styleCategory,
    styleDescription: dir.styleDescription,
    visualCharacteristics: dir.visualCharacteristics,
    renderingRules: dir.renderingRules,
    lineworkRules: dir.lineworkRules,
    colorRules: dir.colorRules,
    textureRules: dir.textureRules,
    shadingRules: dir.shadingRules,
    compositionRules: dir.compositionRules,
    detailLevel: dir.detailLevel,
    promptTemplate: dir.promptTemplate ?? '',
    negativePromptTemplate: dir.negativePromptTemplate ?? '',
  };
}

function getApprovalBadgeProps(status: PromptDocument['approvalStatus']): {
  readonly tone: 'info' | 'warning' | 'success' | 'neutral' | 'destructive';
  readonly label: string;
} {
  switch (status) {
    case 'approved':
      return { tone: 'success', label: 'Approved · Locked' };
    case 'edited':
      return { tone: 'warning', label: 'Edited Draft' };
    case 'generated':
      return { tone: 'info', label: 'AI Generated' };
    case 'rejected':
      return { tone: 'destructive', label: 'Rejected' };
    default:
      return { tone: 'neutral', label: 'Draft' };
  }
}

function isCreativeConfigNewerThanPrompt(
  config: ProjectCreativeConfiguration | null | undefined,
  prompt: PromptDocument | null,
): boolean {
  if (!config) {
    return false;
  }
  if (!prompt) {
    return true;
  }
  return config.updatedAt > prompt.updatedAt;
}

export function PromptComposerPanel({
  projectId,
  description,
  hasUnsavedDescriptionEdits = false,
  selectedStyle = null,
  activeCreativeConfiguration = null,
  availableStyles = CURATED_ART_STYLES,
  availablePresets = [],
  activePrompt,
  promptRevisions,
  isWorkspaceBusy = false,
  onSelectStyle,
  onApplyPreset,
  onPresetCreated,
  onNavigate,
  onPromptPersisted,
}: PromptComposerPanelProps) {
  const { promptComposer, promptStorage, presetEngine } = useStudioServices();

  const configTakesPriority = isCreativeConfigNewerThanPrompt(
    activeCreativeConfiguration,
    activePrompt,
  );

  const [directionMode, setDirectionMode] = useState<CreativeDirectionMode>(() => {
    if (activeCreativeConfiguration?.mode) {
      return activeCreativeConfiguration.mode;
    }
    if (selectedStyle) {
      return 'curated';
    }
    if (activePrompt?.creativeDirection) {
      return activePrompt.creativeDirection.isManualCreativeDirection
        ? 'manual'
        : 'curated';
    }
    return 'manual';
  });

  const [manualDirection, setManualDirection] =
    useState<ManualCreativeDirectionInput>(() => {
      if (
        activeCreativeConfiguration?.mode === 'manual' &&
        activeCreativeConfiguration.creativeDirectionSnapshot
      ) {
        return manualInputFromSnapshot(
          activeCreativeConfiguration.creativeDirectionSnapshot,
        );
      }
      if (activePrompt?.creativeDirection?.isManualCreativeDirection) {
        return directionFromPromptDoc(activePrompt);
      }
      return createDefaultManualCreativeDirection();
    });

  const [compositionPrefs, setCompositionPrefs] =
    useState<PromptCompositionPreferences>(() => {
      if (
        configTakesPriority &&
        activeCreativeConfiguration?.compositionPreferences
      ) {
        return activeCreativeConfiguration.compositionPreferences;
      }
      if (activePrompt?.compositionPreferences) {
        return activePrompt.compositionPreferences;
      }
      if (activeCreativeConfiguration?.compositionPreferences) {
        return activeCreativeConfiguration.compositionPreferences;
      }
      return createDefaultCompositionPreferences();
    });

  const [userInstructions, setUserInstructions] = useState<string>(() => {
    if (
      configTakesPriority &&
      activeCreativeConfiguration?.userCreativeInstructions !== undefined
    ) {
      return activeCreativeConfiguration.userCreativeInstructions;
    }
    if (activePrompt) {
      return (
        activePrompt.creativeInstructions ?? activePrompt.userInstructions ?? ''
      );
    }
    return activeCreativeConfiguration?.userCreativeInstructions ?? '';
  });

  const [draftFinalPrompt, setDraftFinalPrompt] = useState<string>(
    () => activePrompt?.finalPrompt ?? '',
  );
  const [draftNegativePrompt, setDraftNegativePrompt] = useState<string>(
    () => activePrompt?.negativePrompt ?? '',
  );
  const [inspectedRevisionId, setInspectedRevisionId] =
    useState<EntityId | null>(null);
  const [presetModalOpen, setPresetModalOpen] = useState(false);
  const [isSavingPreset, setIsSavingPreset] = useState(false);
  const [presetModalError, setPresetModalError] = useState<string | null>(null);
  const [selectedPresetPickerId, setSelectedPresetPickerId] = useState<string>(
    () => activeCreativeConfiguration?.appliedPresetId ?? '',
  );

  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [synthesisError, setSynthesisError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [copiedTarget, setCopiedTarget] = useState<
    'generated' | 'final' | 'negative' | null
  >(null);

  const hydratedPromptIdRef = useRef<EntityId | null>(activePrompt?.id ?? null);
  const hydratedConfigStampRef = useRef<string | null>(
    activeCreativeConfiguration?.updatedAt ?? null,
  );
  const synthesisInFlightRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, []);

  // Hydrate editor fields when switching activePrompt revision (initial restore, compose, regenerate, unlock)
  useEffect(() => {
    const nextId = activePrompt?.id ?? null;
    if (hydratedPromptIdRef.current !== nextId) {
      hydratedPromptIdRef.current = nextId;
      if (activePrompt) {
        setDraftFinalPrompt(activePrompt.finalPrompt);
        setDraftNegativePrompt(activePrompt.negativePrompt);
        if (activePrompt.creativeDirection?.isManualCreativeDirection) {
          setManualDirection(directionFromPromptDoc(activePrompt));
        }
        if (activePrompt.compositionPreferences) {
          setCompositionPrefs(activePrompt.compositionPreferences);
        }
        setUserInstructions(
          activePrompt.creativeInstructions ?? activePrompt.userInstructions ?? '',
        );
      } else {
        setDraftFinalPrompt('');
        setDraftNegativePrompt('');
      }
      setSaveError(null);
    }
  }, [activePrompt]);

  // Hydrate Creative Direction and Preset state when project creative configuration updates externally
  useEffect(() => {
    const stamp = activeCreativeConfiguration?.updatedAt ?? null;
    if (stamp && hydratedConfigStampRef.current !== stamp) {
      hydratedConfigStampRef.current = stamp;
      if (activeCreativeConfiguration?.mode) {
        setDirectionMode(activeCreativeConfiguration.mode);
      }
      if (
        activeCreativeConfiguration?.mode === 'manual' &&
        activeCreativeConfiguration.creativeDirectionSnapshot
      ) {
        setManualDirection(
          manualInputFromSnapshot(
            activeCreativeConfiguration.creativeDirectionSnapshot,
          ),
        );
      }
      if (activeCreativeConfiguration?.appliedPresetId) {
        setSelectedPresetPickerId(activeCreativeConfiguration.appliedPresetId);
        if (activeCreativeConfiguration.compositionPreferences) {
          setCompositionPrefs(activeCreativeConfiguration.compositionPreferences);
        }
        if (activeCreativeConfiguration.userCreativeInstructions !== undefined) {
          setUserInstructions(
            activeCreativeConfiguration.userCreativeInstructions,
          );
        }
        if (
          activeCreativeConfiguration.negativePromptOverride &&
          activePrompt?.approvalStatus !== 'approved'
        ) {
          setDraftNegativePrompt(
            activeCreativeConfiguration.negativePromptOverride,
          );
        }
      }
    }
  }, [activeCreativeConfiguration, activePrompt?.approvalStatus]);

  const effectiveCuratedStyle =
    directionMode === 'curated' ? selectedStyle ?? null : null;

  const composeRequest = useMemo(
    () => ({
      projectId,
      description,
      artStyle: effectiveCuratedStyle,
      manualCreativeDirection:
        directionMode === 'manual' ? manualDirection : null,
      userInstructions,
      compositionPreferences: compositionPrefs,
      previousRevision: promptRevisions.reduce(
        (maxRev, item) =>
          Math.max(maxRev, item.revisionNumber ?? item.revision ?? 0),
        0,
      ),
    }),
    [
      projectId,
      description,
      effectiveCuratedStyle,
      directionMode,
      manualDirection,
      userInstructions,
      compositionPrefs,
      promptRevisions,
    ],
  );

  const validationReport = useMemo(() => {
    const result = promptComposer.validatePromptInputs(composeRequest);
    if (!result.ok) {
      return {
        valid: false,
        fieldErrors: { creativeDirection: result.error.message },
        missingRequirements: [result.error.message],
        potentialConflicts: [] as readonly string[],
      };
    }
    return result.data;
  }, [promptComposer, composeRequest]);

  const isApprovedLocked = activePrompt?.approvalStatus === 'approved';
  const hasUnsavedPromptEdits =
    activePrompt !== null &&
    !isApprovedLocked &&
    (draftFinalPrompt.trim() !== activePrompt.finalPrompt.trim() ||
      draftNegativePrompt.trim() !== activePrompt.negativePrompt.trim());

  const differsFromGeneratedBaseline =
    activePrompt !== null &&
    (draftFinalPrompt.trim() !== activePrompt.generatedPrompt.trim() ||
      activePrompt.approvalStatus === 'edited');

  const controlsBusy =
    isWorkspaceBusy || isSynthesizing || isSaving || isApproving;

  const inspectedRevision = useMemo(
    () =>
      inspectedRevisionId
        ? promptRevisions.find((rev) => rev.id === inspectedRevisionId) ?? null
        : null,
    [inspectedRevisionId, promptRevisions],
  );

  const updateManualField = <K extends keyof ManualCreativeDirectionInput>(
    key: K,
    value: ManualCreativeDirectionInput[K],
  ) => {
    setManualDirection((prev) => ({ ...prev, [key]: value }));
    setSynthesisError(null);
    setStatusNotice(null);
  };

  const handleAspectRatioChange = (nextRatio: AspectRatio) => {
    setCompositionPrefs((prev) => ({
      ...prev,
      aspectRatio: nextRatio,
      outputOrientation: deriveOutputOrientation(nextRatio),
    }));
    setSynthesisError(null);
  };

  const runSynthesis = async (mode: 'compose' | 'regenerate') => {
    if (synthesisInFlightRef.current || controlsBusy) {
      return;
    }
    if (!validationReport.valid) {
      setSynthesisError(
        validationReport.missingRequirements[0] ??
          'Complete required Editable Object Description and Creative Direction fields before composing.',
      );
      return;
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    synthesisInFlightRef.current = true;
    setIsSynthesizing(true);
    setSynthesisError(null);
    setSaveError(null);
    setStatusNotice(null);

    try {
      const result =
        mode === 'regenerate'
          ? await promptComposer.regeneratePrompt({
              ...composeRequest,
              abortSignal: abortController.signal,
            })
          : await promptComposer.synthesizeMasterPrompt({
              ...composeRequest,
              abortSignal: abortController.signal,
            });

      if (!isMountedRef.current) {
        return;
      }

      if (!result.ok) {
        if (result.error.details?.cancelled === true) {
          setStatusNotice('Prompt synthesis cancelled.');
          return;
        }
        setSynthesisError(result.error.message);
        return;
      }

      const persisted = await promptStorage.savePromptDocumentRevision(
        result.data,
      );

      if (!isMountedRef.current) {
        return;
      }

      if (!persisted.ok) {
        setSynthesisError(
          `Prompt synthesized but could not be saved to IndexedDB: ${persisted.error.message}`,
        );
        return;
      }

      hydratedPromptIdRef.current = persisted.data.activePrompt?.id ?? null;
      if (persisted.data.activePrompt) {
        setDraftFinalPrompt(persisted.data.activePrompt.finalPrompt);
        setDraftNegativePrompt(persisted.data.activePrompt.negativePrompt);
      }
      onPromptPersisted(persisted.data);
      setInspectedRevisionId(null);
      setStatusNotice(
        mode === 'regenerate'
          ? `Generated and saved new prompt revision v${persisted.data.activePrompt?.revisionNumber ?? persisted.data.activePrompt?.revision ?? 1}.`
          : `Synthesized Master Prompt revision v${persisted.data.activePrompt?.revisionNumber ?? persisted.data.activePrompt?.revision ?? 1}.`,
      );
    } finally {
      synthesisInFlightRef.current = false;
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
      }
      if (isMountedRef.current) {
        setIsSynthesizing(false);
      }
    }
  };

  const handleCancelSynthesis = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  };

  const handleSaveDraft = async () => {
    if (!activePrompt || controlsBusy || isApprovedLocked) {
      return;
    }

    const editedResult = markPromptEdited(activePrompt, {
      finalPrompt: draftFinalPrompt,
      negativePrompt: draftNegativePrompt,
    });
    if (!editedResult.ok) {
      setSaveError(editedResult.error.message);
      return;
    }

    const validatedSave = promptComposer.savePromptDocument(
      editedResult.data,
      activePrompt,
    );
    if (!validatedSave.ok) {
      setSaveError(validatedSave.error.message);
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    setStatusNotice(null);

    try {
      const persisted = await promptStorage.savePromptDocumentRevision(
        validatedSave.data,
      );
      if (!isMountedRef.current) {
        return;
      }
      if (!persisted.ok) {
        setSaveError(persisted.error.message);
        return;
      }

      onPromptPersisted(persisted.data);
      setStatusNotice(
        `Saved Final Master Prompt draft (revision v${validatedSave.data.revisionNumber ?? validatedSave.data.revision}) to IndexedDB.`,
      );
    } finally {
      if (isMountedRef.current) {
        setIsSaving(false);
      }
    }
  };

  const handleApproveFinalPrompt = async () => {
    if (!activePrompt || controlsBusy || isApprovedLocked) {
      return;
    }

    const approvedResult = promptComposer.approveFinalPrompt({
      promptDocument: activePrompt,
      finalPrompt: draftFinalPrompt,
      negativePrompt: draftNegativePrompt,
    });
    if (!approvedResult.ok) {
      setSaveError(approvedResult.error.message);
      return;
    }

    setIsApproving(true);
    setSaveError(null);
    setStatusNotice(null);

    try {
      const persisted = await promptStorage.savePromptDocumentRevision(
        approvedResult.data,
      );
      if (!isMountedRef.current) {
        return;
      }
      if (!persisted.ok) {
        setSaveError(persisted.error.message);
        return;
      }

      onPromptPersisted(persisted.data);
      setStatusNotice(
        `Final Master Prompt (revision v${approvedResult.data.revisionNumber ?? approvedResult.data.revision}) approved and locked.`,
      );
    } finally {
      if (isMountedRef.current) {
        setIsApproving(false);
      }
    }
  };

  const handleUnlockNewRevision = async () => {
    if (!activePrompt || controlsBusy || !isApprovedLocked) {
      return;
    }

    const maxRev = promptRevisions.reduce(
      (max, item) => Math.max(max, item.revisionNumber ?? item.revision ?? 0),
      activePrompt.revisionNumber ?? activePrompt.revision ?? 1,
    );
    const unlocked = unlockApprovedPromptForNewRevision(activePrompt, maxRev);
    if (!unlocked.ok) {
      setSaveError(unlocked.error.message);
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    setStatusNotice(null);

    try {
      const persisted = await promptStorage.savePromptDocumentRevision(
        unlocked.data,
      );
      if (!isMountedRef.current) {
        return;
      }
      if (!persisted.ok) {
        setSaveError(persisted.error.message);
        return;
      }

      hydratedPromptIdRef.current = persisted.data.activePrompt?.id ?? null;
      onPromptPersisted(persisted.data);
      setStatusNotice(
        `Created editable revision v${unlocked.data.revisionNumber ?? unlocked.data.revision}. Earlier approved revision remains preserved in Revision History.`,
      );
    } finally {
      if (isMountedRef.current) {
        setIsSaving(false);
      }
    }
  };

  const handleCopyText = async (
    target: 'generated' | 'final' | 'negative',
    text: string,
  ) => {
    if (!text.trim()) {
      return;
    }
    try {
      if (
        typeof navigator !== 'undefined' &&
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === 'function'
      ) {
        await navigator.clipboard.writeText(text);
        setCopiedTarget(target);
        setTimeout(() => {
          if (isMountedRef.current) {
            setCopiedTarget((prev) => (prev === target ? null : prev));
          }
        }, 1800);
      }
    } catch {
      setSaveError(
        'Clipboard access was blocked by the browser. Select the text inside the field to copy manually.',
      );
    }
  };

  const handleModeSwitch = (nextMode: CreativeDirectionMode) => {
    if (controlsBusy || nextMode === directionMode) {
      return;
    }
    setDirectionMode(nextMode);
    setSynthesisError(null);
    setStatusNotice(null);
  };

  const handleQuickStylePick = async (styleId: string) => {
    if (!styleId || controlsBusy) {
      return;
    }
    const found = availableStyles.find((item) => item.id === styleId) ?? null;
    if (!found) {
      return;
    }
    setDirectionMode('curated');
    if (found.detailLevel) {
      setCompositionPrefs((prev) => ({ ...prev, detailLevel: found.detailLevel! }));
    }
    await onSelectStyle?.(found, 'curated');
    setSynthesisError(null);
    setStatusNotice(`Selected curated style "${found.name}".`);
  };

  const handleClearCuratedStyle = async () => {
    if (controlsBusy) {
      return;
    }
    await onSelectStyle?.(null, 'manual');
    setDirectionMode('manual');
    setSynthesisError(null);
    setStatusNotice('Cleared curated style selection. Switched to Manual Creative Direction.');
  };

  const handleInlineApplyPreset = async (presetId: string) => {
    setSelectedPresetPickerId(presetId);
    if (!presetId || controlsBusy) {
      return;
    }
    const preset = availablePresets.find((p) => p.id === presetId);
    if (!preset) {
      return;
    }
    setDirectionMode(preset.creativeDirectionMode);
    if (preset.creativeDirectionMode === 'manual') {
      setManualDirection(
        manualInputFromSnapshot(preset.creativeDirectionSnapshot),
      );
    }
    setCompositionPrefs({
      aspectRatio: preset.aspectRatio,
      compositionDirection: preset.compositionDirection,
      backgroundTreatment: preset.backgroundTreatment,
      detailLevel: preset.detailLevel,
      outputOrientation: preset.outputOrientation,
    });
    setUserInstructions(preset.userCreativeInstructions);
    if (preset.negativePrompt && activePrompt?.approvalStatus !== 'approved') {
      setDraftNegativePrompt(preset.negativePrompt);
    }
    await onApplyPreset?.(preset.id);
    setSynthesisError(null);
    setStatusNotice(
      `Applied preset "${preset.name}" without altering source image, object description, or prompt revision history.`,
    );
  };

  const presetDraftForModal = useMemo((): Partial<SavePersonalPresetInput> => {
    const snap =
      directionMode === 'curated' && effectiveCuratedStyle
        ? buildPresetSnapshotFromArtStyle(effectiveCuratedStyle)
        : buildPresetSnapshotFromManual(manualDirection);
    return {
      creativeDirectionMode:
        directionMode === 'curated' && effectiveCuratedStyle
          ? 'curated'
          : 'manual',
      selectedStyleId:
        directionMode === 'curated' && effectiveCuratedStyle
          ? effectiveCuratedStyle.id
          : null,
      creativeDirectionSnapshot: snap,
      aspectRatio: compositionPrefs.aspectRatio,
      outputOrientation: compositionPrefs.outputOrientation,
      backgroundTreatment: compositionPrefs.backgroundTreatment,
      detailLevel: compositionPrefs.detailLevel,
      compositionDirection: compositionPrefs.compositionDirection,
      userCreativeInstructions: userInstructions,
      negativePrompt: draftNegativePrompt,
    };
  }, [
    directionMode,
    effectiveCuratedStyle,
    manualDirection,
    compositionPrefs,
    userInstructions,
    draftNegativePrompt,
  ]);

  const handleSaveAsPresetSubmit = async (input: SavePersonalPresetInput) => {
    setIsSavingPreset(true);
    setPresetModalError(null);
    const res = await presetEngine.createPreset(input);
    setIsSavingPreset(false);

    if (!res.ok) {
      setPresetModalError(res.error.message);
      return;
    }

    setPresetModalOpen(false);
    setSelectedPresetPickerId(res.data.id);
    setStatusNotice(`Saved reusable preset "${res.data.name}" to My Presets.`);
    await onPresetCreated?.();
  };

  const activeBadge = activePrompt
    ? getApprovalBadgeProps(
        hasUnsavedPromptEdits ? 'edited' : activePrompt.approvalStatus,
      )
    : { tone: 'neutral' as const, label: 'Not Composed' };

  const activeDirectionLabel =
    directionMode === 'curated'
      ? effectiveCuratedStyle
        ? effectiveCuratedStyle.name
        : 'Curated Style (None Selected)'
      : manualDirection.styleName.trim() ||
        'Manual Creative Direction (Incomplete)';

  return (
    <SurfacePanel
      tone="default"
      padding="md"
      className="space-y-6"
      data-testid="prompt-composer-panel"
    >
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--ff-color-border)] pb-3.5">
        <div className="flex items-start gap-2.5">
          <Sparkles
            className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ff-color-primary)]"
            aria-hidden="true"
          />
          <div>
            <Typography variant="h3">
              AI-Powered Prompt Composer
            </Typography>
            <Typography variant="caption" muted className="block mt-0.5">
              Synthesize your Editable Object Description, Creative Direction, and creative instructions into a provider-independent Master Prompt. Text-only boundary enforced.
            </Typography>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {activeCreativeConfiguration?.appliedPresetName ? (
            <Badge tone="info" data-testid="active-preset-badge">
              Preset: {activeCreativeConfiguration.appliedPresetName}
            </Badge>
          ) : null}
          {activePrompt ? (
            <Badge tone="neutral" data-testid="prompt-revision-badge">
              Revision v{activePrompt.revisionNumber ?? activePrompt.revision}
            </Badge>
          ) : null}
          <Badge tone={activeBadge.tone} data-testid="prompt-status-badge">
            {activeBadge.label}
          </Badge>
        </div>
      </div>

      {/* SECTION A — Prompt Input Summary */}
      <section
        aria-labelledby="section-prompt-input-summary"
        data-testid="prompt-input-summary"
        className="space-y-3 rounded-[var(--ff-radius-md)] border border-[var(--ff-color-border)] bg-[var(--ff-color-surface-elevated)] p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4
            id="section-prompt-input-summary"
            className="text-[13px] font-semibold uppercase tracking-wider text-[var(--ff-color-foreground)]"
          >
            Section A · Prompt Input Summary
          </h4>
          <Badge tone={validationReport.valid ? 'success' : 'warning'}>
            {validationReport.valid ? 'Inputs Ready' : 'Missing Requirements'}
          </Badge>
        </div>

        {hasUnsavedDescriptionEdits ? (
          <Alert
            tone="warning"
            title="Unsaved changes in Editable Object Description"
            description={`Prompt Composer currently reads saved revision v${description.version}. Click Save Description above to include your latest object edits.`}
          />
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-[13px]">
          <div className="rounded-[var(--ff-radius-sm)] border border-[var(--ff-color-border)] bg-[var(--ff-color-surface)] p-3">
            <span className="block text-[11px] font-medium uppercase tracking-wider text-[var(--ff-color-muted-foreground)]">
              Authoritative Subject
            </span>
            <span className="mt-1 block font-medium text-[var(--ff-color-foreground)]">
              {description.objectName}
            </span>
            <span className="mt-0.5 block text-[12px] text-[var(--ff-color-muted-foreground)]">
              {description.objectCategory} · Description v{description.version}
            </span>
          </div>

          <div className="rounded-[var(--ff-radius-sm)] border border-[var(--ff-color-border)] bg-[var(--ff-color-surface)] p-3">
            <span className="block text-[11px] font-medium uppercase tracking-wider text-[var(--ff-color-muted-foreground)]">
              Creative Direction
            </span>
            <span className="mt-1 block font-medium text-[var(--ff-color-foreground)]">
              {activeDirectionLabel}
            </span>
            <span className="mt-0.5 block text-[12px] text-[var(--ff-color-muted-foreground)]">
              {directionMode === 'curated'
                ? 'Curated Style Library Mode'
                : 'Manual Creative Direction Mode'}
            </span>
          </div>

          <div className="rounded-[var(--ff-radius-sm)] border border-[var(--ff-color-border)] bg-[var(--ff-color-surface)] p-3">
            <span className="block text-[11px] font-medium uppercase tracking-wider text-[var(--ff-color-muted-foreground)]">
              Composition & Output
            </span>
            <span className="mt-1 block font-medium text-[var(--ff-color-foreground)] tabular-nums">
              {compositionPrefs.aspectRatio} · {compositionPrefs.outputOrientation}
            </span>
            <span className="mt-0.5 block text-[12px] text-[var(--ff-color-muted-foreground)]">
              {compositionPrefs.detailLevel} detail · {compositionPrefs.backgroundTreatment.replace(/_/g, ' ')}
            </span>
          </div>

          <div className="rounded-[var(--ff-radius-sm)] border border-[var(--ff-color-border)] bg-[var(--ff-color-surface)] p-3">
            <span className="block text-[11px] font-medium uppercase tracking-wider text-[var(--ff-color-muted-foreground)]">
              User Creative Instructions
            </span>
            <span className="mt-1 block line-clamp-2 text-[12px] text-[var(--ff-color-foreground)]">
              {userInstructions.trim() || 'None added (optional)'}
            </span>
          </div>
        </div>
      </section>

      {/* SECTION B — Creative Direction & Composition Preferences */}
      <section
        aria-labelledby="section-creative-direction"
        data-testid="prompt-creative-direction"
        className="space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--ff-color-border)] pb-3">
          <div>
            <h4
              id="section-creative-direction"
              className="text-[13px] font-semibold uppercase tracking-wider text-[var(--ff-color-foreground)]"
            >
              Section B · Creative Direction & Output Preferences
            </h4>
            <p className="text-[12px] text-[var(--ff-color-muted-foreground)]">
              Switch seamlessly between a Curated Style Library entry and custom Manual Creative Direction without losing unsaved edits.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {availablePresets.length > 0 ? (
              <div className="min-w-[190px]">
                <Select
                  id="composer-apply-preset-select"
                  aria-label="Apply saved preset"
                  value={selectedPresetPickerId}
                  onChange={(e) => void handleInlineApplyPreset(e.target.value)}
                  disabled={controlsBusy}
                  options={[
                    { value: '', label: 'Apply Saved Preset...' },
                    ...availablePresets.map((p) => ({
                      value: p.id,
                      label: p.name,
                    })),
                  ]}
                />
              </div>
            ) : null}

            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="save-as-preset-btn"
              leftIcon={<Bookmark className="h-3.5 w-3.5" aria-hidden="true" />}
              disabled={controlsBusy}
              onClick={() => {
                setPresetModalError(null);
                setPresetModalOpen(true);
              }}
            >
              Save as Preset
            </Button>
          </div>
        </div>

        {/* Mode Switcher */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--ff-radius-md)] border border-[var(--ff-color-border)] bg-[var(--ff-color-surface-elevated)] px-3.5 py-2.5">
          <div className="inline-flex rounded-[var(--ff-radius-md)] border border-[var(--ff-color-border)] bg-[var(--ff-color-surface)] p-0.5">
            <button
              type="button"
              data-testid="mode-curated-btn"
              disabled={controlsBusy}
              onClick={() => handleModeSwitch('curated')}
              className={cn(
                'rounded-[var(--ff-radius-sm)] px-3 py-1.5 text-[12px] font-medium transition-colors cursor-pointer disabled:cursor-not-allowed',
                directionMode === 'curated'
                  ? 'bg-[var(--ff-color-primary)] text-white'
                  : 'text-[var(--ff-color-muted-foreground)] hover:text-[var(--ff-color-foreground)]',
              )}
            >
              Curated Style
            </button>
            <button
              type="button"
              data-testid="mode-manual-btn"
              disabled={controlsBusy}
              onClick={() => handleModeSwitch('manual')}
              className={cn(
                'rounded-[var(--ff-radius-sm)] px-3 py-1.5 text-[12px] font-medium transition-colors cursor-pointer disabled:cursor-not-allowed',
                directionMode === 'manual'
                  ? 'bg-[var(--ff-color-primary)] text-white'
                  : 'text-[var(--ff-color-muted-foreground)] hover:text-[var(--ff-color-foreground)]',
              )}
            >
              Manual Creative Direction
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {onNavigate ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onNavigate('/presets')}
              >
                Manage Presets
              </Button>
            ) : null}
            {onNavigate ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                leftIcon={<Palette className="h-3.5 w-3.5" aria-hidden="true" />}
                onClick={() => onNavigate('/styles')}
              >
                Open Style Library
              </Button>
            ) : null}
          </div>
        </div>

        {directionMode === 'curated' ? (
          effectiveCuratedStyle ? (
            <SurfacePanel
              tone="muted"
              padding="md"
              data-testid="curated-style-active-card"
              className="space-y-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Typography variant="h3">
                      {effectiveCuratedStyle.name}
                    </Typography>
                    <Badge tone="info">
                      {formatArtStyleCategoryLabel(effectiveCuratedStyle.category)}
                    </Badge>
                    <Badge tone="neutral">
                      {effectiveCuratedStyle.detailLevel ?? 'balanced'} detail
                    </Badge>
                  </div>
                  <Typography variant="body-sm" muted>
                    {effectiveCuratedStyle.shortDescription ??
                      effectiveCuratedStyle.summary}
                  </Typography>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {onNavigate ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      data-testid="change-style-btn"
                      onClick={() => onNavigate('/styles')}
                    >
                      Change Style
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    data-testid="clear-style-selection-btn"
                    disabled={controlsBusy}
                    onClick={() => void handleClearCuratedStyle()}
                  >
                    Clear Selection
                  </Button>
                </div>
              </div>

              <div className="grid gap-2.5 border-t border-[var(--ff-color-border)] pt-3 text-[12px] sm:grid-cols-3">
                <div>
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--ff-color-muted-foreground)]">
                    Rendering Technique
                  </span>
                  <span className="mt-0.5 block text-[var(--ff-color-foreground)]">
                    {effectiveCuratedStyle.renderingTechnique ??
                      effectiveCuratedStyle.renderingRules ??
                      effectiveCuratedStyle.mediumKeywords.join(', ')}
                  </span>
                </div>
                <div>
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--ff-color-muted-foreground)]">
                    Linework & Color
                  </span>
                  <span className="mt-0.5 block text-[var(--ff-color-foreground)]">
                    {[
                      effectiveCuratedStyle.lineworkRules,
                      effectiveCuratedStyle.colorRules,
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'Curated palette'}
                  </span>
                </div>
                <div>
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--ff-color-muted-foreground)]">
                    Shading & Texture
                  </span>
                  <span className="mt-0.5 block text-[var(--ff-color-foreground)]">
                    {[
                      effectiveCuratedStyle.shadingRules,
                      effectiveCuratedStyle.textureRules,
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'Balanced studio finish'}
                  </span>
                </div>
              </div>
            </SurfacePanel>
          ) : (
            <SurfacePanel
              tone="muted"
              padding="md"
              data-testid="curated-style-empty-card"
              className="space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <Typography variant="label">
                    No Curated Style Selected Yet
                  </Typography>
                  <Typography variant="body-sm" muted className="mt-0.5">
                    Pick a curated style below or browse the visual Style Library to configure this mode.
                  </Typography>
                </div>
                {onNavigate ? (
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    data-testid="browse-styles-from-composer-btn"
                    leftIcon={<Palette className="h-3.5 w-3.5" aria-hidden="true" />}
                    onClick={() => onNavigate('/styles')}
                  >
                    Browse Style Library
                  </Button>
                ) : null}
              </div>

              <Select
                id="composer-quick-style-select"
                label="Quick Pick Curated Style"
                value=""
                onChange={(e) => void handleQuickStylePick(e.target.value)}
                disabled={controlsBusy}
                options={[
                  { value: '', label: 'Select a curated style...' },
                  ...availableStyles.map((style) => ({
                    value: style.id,
                    label: `${style.name} (${formatArtStyleCategoryLabel(style.category)})`,
                  })),
                ]}
              />
            </SurfacePanel>
          )
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <TextInput
                id="prompt-style-name"
                label="Style Name *"
                value={manualDirection.styleName}
                onChange={(e) => updateManualField('styleName', e.target.value)}
                error={validationReport.fieldErrors.styleName}
                disabled={controlsBusy}
                placeholder="e.g., Architectural Ink & Watercolor Study"
              />
              <Select
                id="prompt-style-category"
                label="Style Category"
                value={manualDirection.styleCategory ?? 'illustration'}
                onChange={(e) =>
                  updateManualField('styleCategory', e.target.value)
                }
                disabled={controlsBusy}
                options={[...STYLE_CATEGORY_OPTIONS]}
              />
            </div>

            <Textarea
              id="prompt-style-description"
              label="Style Description *"
              rows={2}
              value={manualDirection.styleDescription}
              onChange={(e) =>
                updateManualField('styleDescription', e.target.value)
              }
              error={validationReport.fieldErrors.styleDescription}
              disabled={controlsBusy}
              placeholder="Describe the overall artistic aesthetic, medium, and studio look."
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <TextInput
                id="prompt-visual-characteristics"
                label="Visual Characteristics"
                value={manualDirection.visualCharacteristics ?? ''}
                onChange={(e) =>
                  updateManualField('visualCharacteristics', e.target.value)
                }
                disabled={controlsBusy}
                placeholder="e.g., Crisp editorial clarity, tactile paper grain"
              />
              <TextInput
                id="prompt-rendering-rules"
                label="Rendering Technique"
                value={manualDirection.renderingRules ?? ''}
                onChange={(e) =>
                  updateManualField('renderingRules', e.target.value)
                }
                disabled={controlsBusy}
                placeholder="e.g., Hand-inked fountain pen with layered translucent washes"
              />
              <TextInput
                id="prompt-linework-rules"
                label="Linework"
                value={manualDirection.lineworkRules ?? ''}
                onChange={(e) =>
                  updateManualField('lineworkRules', e.target.value)
                }
                disabled={controlsBusy}
                placeholder="e.g., Fine architectural contour lines, varied line weight"
              />
              <TextInput
                id="prompt-color-rules"
                label="Color Treatment"
                value={manualDirection.colorRules ?? ''}
                onChange={(e) =>
                  updateManualField('colorRules', e.target.value)
                }
                disabled={controlsBusy}
                placeholder="e.g., Muted mineral pigments, restrained warm ochre accents"
              />
              <TextInput
                id="prompt-texture-rules"
                label="Texture"
                value={manualDirection.textureRules ?? ''}
                onChange={(e) =>
                  updateManualField('textureRules', e.target.value)
                }
                disabled={controlsBusy}
                placeholder="e.g., Cold-press cotton paper surface, subtle pigment granulation"
              />
              <TextInput
                id="prompt-shading-rules"
                label="Shading & Lighting"
                value={manualDirection.shadingRules ?? ''}
                onChange={(e) =>
                  updateManualField('shadingRules', e.target.value)
                }
                disabled={controlsBusy}
                placeholder="e.g., Soft diffused top-left daylight with delicate cross-hatching"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <TextInput
                id="prompt-style-composition-rules"
                label="Style Composition Rules"
                value={manualDirection.compositionRules ?? ''}
                onChange={(e) =>
                  updateManualField('compositionRules', e.target.value)
                }
                disabled={controlsBusy}
                placeholder="e.g., Centered hero framing with generous breathing room"
              />
              <TextInput
                id="prompt-style-negative-directives"
                label="Style Negative Directives"
                value={manualDirection.negativePromptTemplate ?? ''}
                onChange={(e) =>
                  updateManualField('negativePromptTemplate', e.target.value)
                }
                disabled={controlsBusy}
                hint="Optional exclusions grounded strictly in your creative direction"
                placeholder="e.g., neon glare, plastic sheen, cluttered text overlays"
              />
            </div>
          </div>
        )}

        <div className="grid gap-4 border-t border-[var(--ff-color-border)] pt-4 sm:grid-cols-2 lg:grid-cols-4">
          <Select
            id="prompt-aspect-ratio"
            label="Aspect Ratio"
            value={compositionPrefs.aspectRatio}
            onChange={(e) =>
              handleAspectRatioChange(e.target.value as AspectRatio)
            }
            disabled={controlsBusy}
            options={[...ASPECT_RATIO_OPTIONS]}
          />
          <Select
            id="prompt-output-orientation"
            label="Output Orientation"
            value={compositionPrefs.outputOrientation}
            onChange={(e) =>
              setCompositionPrefs((prev) => ({
                ...prev,
                outputOrientation: e.target.value as PromptOutputOrientation,
              }))
            }
            disabled={controlsBusy}
            options={[...ORIENTATION_OPTIONS]}
          />
          <Select
            id="prompt-background-treatment"
            label="Background Treatment"
            value={compositionPrefs.backgroundTreatment}
            onChange={(e) =>
              setCompositionPrefs((prev) => ({
                ...prev,
                backgroundTreatment: e.target.value as PromptBackgroundTreatment,
              }))
            }
            disabled={controlsBusy}
            options={[...BACKGROUND_TREATMENT_OPTIONS]}
          />
          <Select
            id="prompt-detail-level"
            label="Detail Level"
            value={compositionPrefs.detailLevel}
            onChange={(e) =>
              setCompositionPrefs((prev) => ({
                ...prev,
                detailLevel: e.target.value as PromptDetailLevel,
              }))
            }
            disabled={controlsBusy}
            options={[...DETAIL_LEVEL_OPTIONS]}
          />
        </div>

        <TextInput
          id="prompt-composition-direction"
          label="Composition Direction"
          value={compositionPrefs.compositionDirection}
          onChange={(e) =>
            setCompositionPrefs((prev) => ({
              ...prev,
              compositionDirection: e.target.value,
            }))
          }
          disabled={controlsBusy}
          placeholder="e.g., Preserve source three-quarter view with generous negative space"
        />
      </section>

      {/* SECTION C — User Creative Instructions */}
      <section aria-labelledby="section-user-instructions" className="space-y-3">
        <div className="border-b border-[var(--ff-color-border)] pb-2">
          <h4
            id="section-user-instructions"
            className="text-[13px] font-semibold uppercase tracking-wider text-[var(--ff-color-foreground)]"
          >
            Section C · User Creative Instructions
          </h4>
        </div>

        <Textarea
          id="prompt-user-instructions"
          label="Creative Instructions & Mood Adjustments"
          rows={3}
          value={userInstructions}
          onChange={(e) => {
            setUserInstructions(e.target.value);
            setSynthesisError(null);
          }}
          disabled={controlsBusy}
          hint="Add framing nuances, atmosphere cues, or explicit exclusions (e.g., 'Avoid dramatic shadows')."
          placeholder="Describe creative adjustments or atmosphere nuances to weave into the Master Prompt..."
        />
      </section>

      {/* SECTION D — Compose Master Prompt */}
      <section
        aria-labelledby="section-compose-prompt"
        className="space-y-3 border-t border-[var(--ff-color-border)] pt-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4
              id="section-compose-prompt"
              className="text-[13px] font-semibold uppercase tracking-wider text-[var(--ff-color-foreground)]"
            >
              Section D · Master Prompt Synthesis
            </h4>
            <p className="text-[12px] text-[var(--ff-color-muted-foreground)]">
              Calls Gemini server-side using only text descriptions and creative direction rules.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isSynthesizing ? (
              <Button
                type="button"
                variant="outline"
                size="md"
                leftIcon={<X className="h-4 w-4" aria-hidden="true" />}
                onClick={handleCancelSynthesis}
              >
                Cancel Synthesis
              </Button>
            ) : null}

            <Button
              type="button"
              variant="primary"
              size="md"
              data-testid="compose-master-prompt-btn"
              leftIcon={<Sparkles className="h-4 w-4" aria-hidden="true" />}
              disabled={!validationReport.valid || controlsBusy}
              loading={isSynthesizing}
              onClick={() => void runSynthesis('compose')}
            >
              Compose Master Prompt
            </Button>
          </div>
        </div>

        {validationReport.potentialConflicts.length > 0 ? (
          <Alert
            tone="warning"
            title="Potential creative conflicts detected in current inputs"
            description={validationReport.potentialConflicts.join(' ')}
          />
        ) : null}

        {activePrompt?.unresolvedConflicts &&
        activePrompt.unresolvedConflicts.length > 0 ? (
          <Alert
            tone="warning"
            title="Unresolved creative conflicts flagged by Gemini"
            description={activePrompt.unresolvedConflicts.join(' ')}
          />
        ) : null}

        {synthesisError ? (
          <Alert
            tone="destructive"
            title="Prompt synthesis failed"
            description={synthesisError}
            action={
              <Button
                variant="outline"
                size="sm"
                leftIcon={<RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
                disabled={!validationReport.valid || controlsBusy}
                onClick={() => void runSynthesis('compose')}
              >
                Retry
              </Button>
            }
          />
        ) : null}
      </section>

      {/* SECTION E, F, G, H — Output, Editing, Negative Prompt & Actions */}
      {activePrompt ? (
        <div className="space-y-6 border-t border-[var(--ff-color-border)] pt-5">
          {saveError ? (
            <Alert
              tone="destructive"
              title="Prompt action failed"
              description={saveError}
            />
          ) : null}

          {statusNotice && !saveError ? (
            <div
              role="status"
              data-testid="prompt-status-notice"
              className="flex items-center gap-2 rounded-[var(--ff-radius-md)] border border-[#C3DFCF] bg-[var(--ff-color-success-subtle)] px-3.5 py-2.5 text-[13px] font-medium text-[var(--ff-color-success)]"
            >
              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{statusNotice}</span>
            </div>
          ) : null}

          {/* SECTION E — Generated Prompt (Read-Only AI Baseline) */}
          <section
            aria-labelledby="section-generated-prompt"
            className="space-y-2.5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h4
                  id="section-generated-prompt"
                  className="text-[13px] font-semibold uppercase tracking-wider text-[var(--ff-color-foreground)]"
                >
                  Section E · Generated Prompt
                </h4>
                <Badge
                  tone="info"
                  data-testid="generated-prompt-readonly-badge"
                >
                  AI Baseline · Read-Only
                </Badge>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                leftIcon={
                  copiedTarget === 'generated' ? (
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  )
                }
                onClick={() =>
                  void handleCopyText(
                    'generated',
                    activePrompt.generatedPrompt,
                  )
                }
              >
                {copiedTarget === 'generated' ? 'Copied' : 'Copy Generated Prompt'}
              </Button>
            </div>

            <Textarea
              id="prompt-generated-prompt"
              label="Generated Prompt (Immutable AI Baseline)"
              rows={4}
              readOnly
              value={activePrompt.generatedPrompt}
              hint={`Synthesized from Description v${activePrompt.sourceDescriptionRevision ?? description.version} via ${activePrompt.modelId ?? 'gemini'}.`}
              className="bg-[var(--ff-color-muted)] text-[var(--ff-color-muted-foreground)] cursor-default"
            />
          </section>

          {/* SECTION F — Final Master Prompt (Editable) */}
          <section
            aria-labelledby="section-final-prompt"
            className="space-y-2.5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h4
                  id="section-final-prompt"
                  className="text-[13px] font-semibold uppercase tracking-wider text-[var(--ff-color-foreground)]"
                >
                  Section F · Final Master Prompt
                </h4>
                {isApprovedLocked ? (
                  <Badge tone="success" data-testid="final-prompt-locked-badge">
                    <Lock className="mr-1 h-3 w-3" aria-hidden="true" />
                    Approved & Locked
                  </Badge>
                ) : differsFromGeneratedBaseline || hasUnsavedPromptEdits ? (
                  <Badge tone="warning" data-testid="final-prompt-edited-badge">
                    Edited
                  </Badge>
                ) : (
                  <Badge tone="neutral">Matches AI Baseline</Badge>
                )}
              </div>

              <div className="flex items-center gap-2">
                {isApprovedLocked ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-testid="unlock-approved-prompt-btn"
                    leftIcon={<Unlock className="h-3.5 w-3.5" aria-hidden="true" />}
                    disabled={controlsBusy}
                    onClick={() => void handleUnlockNewRevision()}
                  >
                    Unlock & Create New Revision
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  leftIcon={
                    copiedTarget === 'final' ? (
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    )
                  }
                  onClick={() => void handleCopyText('final', draftFinalPrompt)}
                >
                  {copiedTarget === 'final'
                    ? 'Copied'
                    : 'Copy Final Master Prompt'}
                </Button>
              </div>
            </div>

            <Textarea
              id="prompt-final-prompt"
              label="Final Master Prompt"
              rows={5}
              readOnly={isApprovedLocked}
              disabled={controlsBusy && !isApprovedLocked}
              value={draftFinalPrompt}
              onChange={(e) => {
                setDraftFinalPrompt(e.target.value);
                setSaveError(null);
                setStatusNotice(null);
              }}
              hint={
                isApprovedLocked
                  ? `Approved at ${activePrompt.approvedAt ? new Date(activePrompt.approvedAt).toLocaleString() : 'saved timestamp'}. Unlock to create a new revision without altering this approved record.`
                  : 'Refine wording freely. Editing never alters the read-only Generated Prompt baseline above.'
              }
            />
          </section>

          {/* SECTION G — Negative Prompt */}
          <section
            aria-labelledby="section-negative-prompt"
            className="space-y-2.5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4
                id="section-negative-prompt"
                className="text-[13px] font-semibold uppercase tracking-wider text-[var(--ff-color-foreground)]"
              >
                Section G · Negative Prompt
              </h4>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!draftNegativePrompt.trim()}
                leftIcon={
                  copiedTarget === 'negative' ? (
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  )
                }
                onClick={() =>
                  void handleCopyText('negative', draftNegativePrompt)
                }
              >
                {copiedTarget === 'negative' ? 'Copied' : 'Copy Negative Prompt'}
              </Button>
            </div>

            <Textarea
              id="prompt-negative-prompt"
              label="Negative Prompt (Optional Exclusions)"
              rows={2}
              readOnly={isApprovedLocked}
              disabled={controlsBusy && !isApprovedLocked}
              value={draftNegativePrompt}
              onChange={(e) => {
                setDraftNegativePrompt(e.target.value);
                setSaveError(null);
                setStatusNotice(null);
              }}
              placeholder="No negative directives required."
              hint="Populated only from active Creative Direction negative rules or explicit user exclusions; downstream image-generation provider support varies cleanly."
            />
          </section>

          {/* SECTION H — Prompt Actions & Revision History */}
          <section
            aria-labelledby="section-prompt-actions"
            className="space-y-4 border-t border-[var(--ff-color-border)] pt-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="md"
                  data-testid="regenerate-prompt-btn"
                  leftIcon={
                    <RefreshCw className="h-4 w-4" aria-hidden="true" />
                  }
                  disabled={!validationReport.valid || controlsBusy}
                  loading={isSynthesizing}
                  onClick={() => void runSynthesis('regenerate')}
                >
                  Regenerate
                </Button>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <Button
                  type="button"
                  variant="outline"
                  size="md"
                  data-testid="save-prompt-draft-btn"
                  leftIcon={<Save className="h-4 w-4" aria-hidden="true" />}
                  disabled={
                    controlsBusy ||
                    isApprovedLocked ||
                    !draftFinalPrompt.trim()
                  }
                  loading={isSaving}
                  onClick={() => void handleSaveDraft()}
                >
                  Save Draft
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="md"
                  data-testid="approve-final-prompt-btn"
                  leftIcon={
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  }
                  disabled={
                    controlsBusy ||
                    isApprovedLocked ||
                    !draftFinalPrompt.trim()
                  }
                  loading={isApproving}
                  onClick={() => void handleApproveFinalPrompt()}
                >
                  {isApprovedLocked ? 'Approved' : 'Approve Final Prompt'}
                </Button>
              </div>
            </div>

            {promptRevisions.length > 0 ? (
              <div
                data-testid="prompt-revision-history"
                className="space-y-3 rounded-[var(--ff-radius-md)] border border-[var(--ff-color-border)] bg-[var(--ff-color-surface-elevated)] p-3.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <History
                      className="h-4 w-4 text-[var(--ff-color-muted-foreground)]"
                      aria-hidden="true"
                    />
                    <Typography variant="label">
                      Revision History ({promptRevisions.length})
                    </Typography>
                  </div>
                  <Typography variant="caption" muted>
                    Earlier revisions stay preserved in IndexedDB
                  </Typography>
                </div>

                <ul className="divide-y divide-[var(--ff-color-border)]">
                  {promptRevisions.map((rev) => {
                    const revNum = rev.revisionNumber ?? rev.revision;
                    const isCurrent = rev.id === activePrompt.id;
                    const isInspected = rev.id === inspectedRevisionId;
                    const badgeProps = getApprovalBadgeProps(rev.approvalStatus);

                    return (
                      <li
                        key={rev.id}
                        data-testid={`prompt-revision-item-v${revNum}`}
                        className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13px]"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-[var(--ff-color-foreground)] tabular-nums">
                            v{revNum}
                          </span>
                          <Badge tone={badgeProps.tone}>
                            {badgeProps.label}
                          </Badge>
                          {isCurrent ? (
                            <Badge tone="primary">Active</Badge>
                          ) : null}
                          <span className="text-[12px] text-[var(--ff-color-muted-foreground)] tabular-nums">
                            {new Date(rev.updatedAt).toLocaleString()} ·{' '}
                            {rev.creativeDirection?.styleName ?? 'Manual Style'}
                          </span>
                        </div>

                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setInspectedRevisionId(isInspected ? null : rev.id)
                          }
                        >
                          {isInspected ? 'Hide Preview' : 'Inspect'}
                        </Button>
                      </li>
                    );
                  })}
                </ul>

                {inspectedRevision ? (
                  <SurfacePanel
                    tone="default"
                    padding="sm"
                    className="space-y-2"
                    data-testid="prompt-revision-preview"
                  >
                    <div className="flex items-center justify-between">
                      <Typography variant="label">
                        Inspecting Revision v
                        {inspectedRevision.revisionNumber ??
                          inspectedRevision.revision}
                      </Typography>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setInspectedRevisionId(null)}
                      >
                        Close
                      </Button>
                    </div>
                    <div>
                      <Typography variant="caption" muted className="block">
                        Generated Prompt Baseline:
                      </Typography>
                      <Typography variant="body-sm" className="mt-0.5">
                        {inspectedRevision.generatedPrompt}
                      </Typography>
                    </div>
                    <div>
                      <Typography variant="caption" muted className="block">
                        Final Master Prompt:
                      </Typography>
                      <Typography variant="body-sm" className="mt-0.5">
                        {inspectedRevision.finalPrompt}
                      </Typography>
                    </div>
                    {inspectedRevision.negativePrompt ? (
                      <div>
                        <Typography variant="caption" muted className="block">
                          Negative Prompt:
                        </Typography>
                        <Typography variant="body-sm" className="mt-0.5">
                          {inspectedRevision.negativePrompt}
                        </Typography>
                      </div>
                    ) : null}
                  </SurfacePanel>
                ) : null}
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      <PresetFormModal
        open={presetModalOpen}
        mode="create"
        initialDraft={presetDraftForModal}
        availableStyles={availableStyles}
        isSubmitting={isSavingPreset}
        errorMessage={presetModalError}
        onClose={() => {
          if (!isSavingPreset) {
            setPresetModalOpen(false);
          }
        }}
        onSubmit={handleSaveAsPresetSubmit}
      />
    </SurfacePanel>
  );
}

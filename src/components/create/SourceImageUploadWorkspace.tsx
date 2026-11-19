import { FolderKanban, ImagePlus, Upload } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react';
import { useStudioServices } from '../../app/providers/AppProviders.tsx';
import { useImageGenerationProviders } from '../../hooks/useImageGenerationProviders.ts';
import type { PersistedGenerationRecordBundle } from '../../services/image-generation/generationHistoryService.ts';
import {
  normalizeRawVisionToObjectAnalysis,
} from '../../services/object-description/contract.ts';
import type {
  PersistedGenerationState,
  PersistedPromptState,
  ProjectGenerationHistorySnapshot,
} from '../../services/project-storage/browserProjectStorage.ts';
import {
  readStoredActiveProjectId,
  writeStoredActiveProjectId,
} from '../../services/project-storage/browserProjectStorage.ts';
import { validateSelectedImageFile } from '../../services/source-asset/browserImageValidation.ts';
import {
  formatFileSize,
  formatSourceFormatLabel,
} from '../../services/source-asset/imageValidation.ts';
import { errResult, okResult, type EntityId, type ServiceResult } from '../../types/common.ts';
import type {
  ArtStyle,
  CreativeDirectionMode,
  ObjectAnalysis,
  ObjectDescription,
  PersonalPreset,
  Project,
  ProjectCreativeConfiguration,
  PromptDocument,
  SourceAsset,
} from '../../types/domain.ts';
import type { RawVisionAnalysisResult } from '../../types/providers.ts';
import type { ObjectDescriptionEditableFields } from '../../types/services.ts';
import {
  executeVisionAnalysisFromStorage,
  type VisionAnalysisRequestPhase,
} from '../../services/object-identification/visionAnalysisClient.ts';
import { CURATED_ART_STYLES } from '../../services/art-style/contract.ts';
import { artStyleFromSnapshot } from '../../services/presets/presetService.ts';
import { createEntityId } from '../../utils/ids.ts';
import {
  Alert,
  Badge,
  Button,
  LoadingState,
  SurfacePanel,
  Typography,
  WorkspacePanel,
  cn,
} from '../ui/index.ts';
import { EditableObjectDescriptionPanel } from './EditableObjectDescriptionPanel.tsx';
import { GenerationHistorySection } from './GenerationHistorySection.tsx';
import { ImageGenerationSection } from './ImageGenerationSection.tsx';
import {
  ImageMetadataPanel,
  type SourcePersistencePhase,
} from './ImageMetadataPanel.tsx';
import { ObjectAnalysisPreviewPanel } from './ObjectAnalysisPreviewPanel.tsx';
import { PromptComposerPanel } from './PromptComposerPanel.tsx';
import { SourceAssetActions } from './SourceAssetActions.tsx';
import { SourceImageViewer } from './SourceImageViewer.tsx';

interface ActiveSourceAssetView {
  readonly sourceAsset: SourceAsset;
  readonly previewUrl: string;
  readonly binaryBlob: Blob;
}

const WORKFLOW_STAGES = [
  { id: '01', label: '01. Source Upload & Inspection', active: true },
  { id: '02', label: '02. Object Identification (Vision)', active: false },
  { id: '03', label: '03. Editable Object Description', active: false },
  { id: '04', label: '04. Curated Art Style Selection', active: false },
  { id: '05', label: '05. Prompt Composition & Approval', active: false },
  { id: '06', label: '06. Text-Only Artwork Generation', active: false },
] as const;

const ACCEPTED_FILE_INPUT =
  '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp';

async function verifyObjectUrlDecodable(objectUrl: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const img = new Image();
    img.onload = async () => {
      try {
        if (typeof img.decode === 'function') {
          await img.decode();
        }
        resolve(img.naturalWidth > 0 && img.naturalHeight > 0);
      } catch {
        resolve(false);
      }
    };
    img.onerror = () => resolve(false);
    img.src = objectUrl;
  });
}

export interface SourceImageUploadWorkspaceProps {
  readonly onNavigate?: (path: string) => void;
}

export function SourceImageUploadWorkspace({
  onNavigate,
}: SourceImageUploadWorkspaceProps = {}) {
  const {
    artStyle,
    presetEngine,
    sourceAssetStorage,
    objectDescription,
    objectDescriptionStorage,
    promptStorage,
    generationStorage,
    creativeStateStorage,
  } = useStudioServices();

  const [projectId, setProjectId] = useState<EntityId>(
    () => readStoredActiveProjectId() ?? createEntityId('prj'),
  );
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [missingProjectRecoveryNotice, setMissingProjectRecoveryNotice] =
    useState<string | null>(null);
  const [activeAsset, setActiveAsset] = useState<ActiveSourceAssetView | null>(
    null,
  );
  const [persistencePhase, setPersistencePhase] =
    useState<SourcePersistencePhase>('restoring');
  const [isValidating, setIsValidating] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);

  const [analysisPhase, setAnalysisPhase] =
    useState<VisionAnalysisRequestPhase>('idle');
  const [rawAnalysisResult, setRawAnalysisResult] =
    useState<RawVisionAnalysisResult | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [activeAnalysis, setActiveAnalysis] = useState<ObjectAnalysis | null>(
    null,
  );
  const [activeDescription, setActiveDescription] =
    useState<ObjectDescription | null>(null);
  const [analysisPersistError, setAnalysisPersistError] = useState<
    string | null
  >(null);
  const [pendingAnalysisSave, setPendingAnalysisSave] = useState<{
    readonly analysis: ObjectAnalysis;
    readonly description: ObjectDescription;
  } | null>(null);
  const [hasUnsavedDescriptionEdits, setHasUnsavedDescriptionEdits] =
    useState(false);
  const [activePrompt, setActivePrompt] = useState<PromptDocument | null>(null);
  const [promptRevisions, setPromptRevisions] = useState<
    readonly PromptDocument[]
  >([]);
  const [availableStyles, setAvailableStyles] =
    useState<readonly ArtStyle[]>(CURATED_ART_STYLES);
  const [selectedStyle, setSelectedStyle] = useState<ArtStyle | null>(null);
  const [activeCreativeConfiguration, setActiveCreativeConfiguration] =
    useState<ProjectCreativeConfiguration | null>(null);
  const [availablePresets, setAvailablePresets] = useState<
    readonly PersonalPreset[]
  >([]);
  const [restoredGenerationState, setRestoredGenerationState] =
    useState<PersistedGenerationState | null>(null);
  const [generationRestoreError, setGenerationRestoreError] = useState<
    string | null
  >(null);
  const [historyEntries, setHistoryEntries] = useState<
    readonly PersistedGenerationRecordBundle[]
  >([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyLoadError, setHistoryLoadError] = useState<string | null>(null);
  const [isGenerationInFlight, setIsGenerationInFlight] = useState(false);

  const providerController = useImageGenerationProviders();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const promptComposerSectionRef = useRef<HTMLDivElement | null>(null);
  const isBusyRef = useRef(true);
  const isAnalyzingRef = useRef(false);
  const analysisAbortControllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);
  const dragDepthRef = useRef(0);
  const activePreviewUrlRef = useRef<string | null>(null);
  const activeAssetRef = useRef<ActiveSourceAssetView | null>(null);
  const persistencePhaseRef = useRef<SourcePersistencePhase>('restoring');

  const applyHistorySnapshot = (snapshot: ProjectGenerationHistorySnapshot | null) => {
    if (!snapshot) {
      setHistoryEntries([]);
      setRestoredGenerationState(null);
      return;
    }
    setHistoryEntries(snapshot.entries);
    setRestoredGenerationState({
      project: snapshot.project,
      latestJob: snapshot.activeJob,
      artwork: snapshot.activeArtwork,
      imageBlob: snapshot.activeImageBlob,
      jobHistory: snapshot.entries.map((item) => item.job),
    });
  };

  const refreshProjectGenerationHistory = async (targetProjectId: EntityId) => {
    setIsLoadingHistory(true);
    const historyRes =
      await generationStorage.getProjectGenerationHistory(targetProjectId);
    if (!isMountedRef.current) {
      return;
    }
    setIsLoadingHistory(false);
    if (!historyRes.ok) {
      setHistoryLoadError(historyRes.error.message);
      return;
    }
    setHistoryLoadError(null);
    if (historyRes.data) {
      setHistoryEntries(historyRes.data.entries);
    }
  };

  const resetAnalysisState = () => {
    if (analysisAbortControllerRef.current) {
      analysisAbortControllerRef.current.abort();
      analysisAbortControllerRef.current = null;
    }
    isAnalyzingRef.current = false;
    setAnalysisPhase('idle');
    setRawAnalysisResult(null);
    setAnalysisError(null);
    setActiveAnalysis(null);
    setActiveDescription(null);
    setAnalysisPersistError(null);
    setPendingAnalysisSave(null);
    setHasUnsavedDescriptionEdits(false);
    setActivePrompt(null);
    setPromptRevisions([]);
    setRestoredGenerationState(null);
    setGenerationRestoreError(null);
    setHistoryEntries([]);
    setHistoryLoadError(null);
  };

  const updateActiveAsset = (next: ActiveSourceAssetView | null) => {
    activeAssetRef.current = next;
    setActiveAsset(next);
  };

  const updatePersistencePhase = (next: SourcePersistencePhase) => {
    persistencePhaseRef.current = next;
    setPersistencePhase(next);
  };

  const revokePreviewUrl = (url: string | null | undefined) => {
    if (url) {
      URL.revokeObjectURL(url);
      if (activePreviewUrlRef.current === url) {
        activePreviewUrlRef.current = null;
      }
    }
  };

  useEffect(() => {
    isMountedRef.current = true;
    let cancelled = false;

    const restore = async () => {
      isBusyRef.current = true;
      updatePersistencePhase('restoring');
      const preferredProjectId = readStoredActiveProjectId();
      const [restored, stylesRes, presetsRes] = await Promise.all([
        sourceAssetStorage.restoreActiveSourceAsset(preferredProjectId),
        artStyle.listStyles(),
        presetEngine.listPresets(),
      ]);

      if (cancelled || !isMountedRef.current) {
        return;
      }

      const loadedStyles =
        stylesRes.ok && stylesRes.data.length > 0
          ? stylesRes.data
          : CURATED_ART_STYLES;
      setAvailableStyles(loadedStyles);
      if (presetsRes.ok) {
        setAvailablePresets(presetsRes.data);
      }

      if (!restored.ok) {
        const failedProjectId = restored.error.details?.projectId;
        if (typeof failedProjectId === 'string') {
          setProjectId(failedProjectId);
          writeStoredActiveProjectId(failedProjectId);
        }
        updateActiveAsset(null);
        updatePersistencePhase('failed');
        setWorkspaceError(restored.error.message);
        isBusyRef.current = false;
        return;
      }

      if (!restored.data) {
        setActiveProject(null);
        if (preferredProjectId) {
          writeStoredActiveProjectId(null);
          setProjectId(createEntityId('prj'));
          setMissingProjectRecoveryNotice(
            'The previously selected project is no longer in local storage. Choose a study in My Projects or upload a source image to start a fresh study.',
          );
        } else {
          setMissingProjectRecoveryNotice(null);
        }
        updateActiveAsset(null);
        updatePersistencePhase('not_persisted');
        setWorkspaceError(null);
        isBusyRef.current = false;
        return;
      }

      const restoredProject = restored.data.project;
      setActiveProject(restoredProject);
      setProjectId(restoredProject.id);
      writeStoredActiveProjectId(restoredProject.id);
      if (preferredProjectId && restoredProject.id !== preferredProjectId) {
        setMissingProjectRecoveryNotice(
          `The previously active project could not be found in local storage. Switched to "${restoredProject.title}".`,
        );
      } else {
        setMissingProjectRecoveryNotice(null);
      }

      const creativeConfig = restoredProject.activeCreativeConfiguration ?? null;
      setActiveCreativeConfiguration(creativeConfig);
      const effectiveStyleId =
        creativeConfig?.mode === 'manual'
          ? null
          : restoredProject.selectedStyleId ??
            creativeConfig?.selectedStyleId ??
            null;

      if (effectiveStyleId) {
        const matchedStyle =
          loadedStyles.find((item) => item.id === effectiveStyleId) ??
          (creativeConfig?.creativeDirectionSnapshot
            ? artStyleFromSnapshot(creativeConfig.creativeDirectionSnapshot)
            : null);
        setSelectedStyle(matchedStyle);
      } else {
        setSelectedStyle(null);
      }

      if (!restored.data.sourceAsset || !restored.data.blob) {
        updateActiveAsset(null);
        updatePersistencePhase('not_persisted');
        setWorkspaceError(null);
        isBusyRef.current = false;
        return;
      }

      const objectUrl = URL.createObjectURL(restored.data.blob);
      const decodedOk = await verifyObjectUrlDecodable(objectUrl);

      if (cancelled || !isMountedRef.current) {
        URL.revokeObjectURL(objectUrl);
        return;
      }

      if (!decodedOk) {
        URL.revokeObjectURL(objectUrl);
        updateActiveAsset(null);
        updatePersistencePhase('failed');
        setWorkspaceError(
          'Saved source image Blob could not be decoded in this browser. Upload a replacement image to recover the study.',
        );
        isBusyRef.current = false;
        return;
      }

      revokePreviewUrl(activePreviewUrlRef.current);
      activePreviewUrlRef.current = objectUrl;
      updateActiveAsset({
        sourceAsset: restored.data.sourceAsset,
        previewUrl: objectUrl,
        binaryBlob: restored.data.blob,
      });
      updatePersistencePhase('persisted');
      setWorkspaceError(null);

      // Restore persisted ObjectAnalysis and ObjectDescription for the active study
      const analysisState =
        await objectDescriptionStorage.getProjectObjectAnalysisState(
          restored.data.project.id,
        );

      if (cancelled || !isMountedRef.current) {
        return;
      }

      if (!analysisState.ok) {
        setAnalysisPersistError(analysisState.error.message);
      } else if (analysisState.data?.analysis) {
        const restoredAnalysis = analysisState.data.analysis;
        let restoredDescription = analysisState.data.description;

        if (!restoredDescription) {
          const initialized = objectDescription.createFromAnalysis(restoredAnalysis);
          if (initialized.ok) {
            const savedInit =
              await objectDescriptionStorage.saveEditedObjectDescription(
                initialized.data,
              );
            if (!cancelled && isMountedRef.current && savedInit.ok) {
              restoredDescription = savedInit.data.description;
            }
          }
        }

        if (!cancelled && isMountedRef.current) {
          setActiveAnalysis(restoredAnalysis);
          setActiveDescription(restoredDescription);
          setAnalysisPhase('success');
        }

        const [promptState, historyState] = await Promise.all([
          promptStorage.getProjectPromptState(restored.data.project.id),
          generationStorage.getProjectGenerationHistory(
            restored.data.project.id,
          ),
        ]);
        if (!cancelled && isMountedRef.current) {
          if (promptState.ok && promptState.data) {
            setActivePrompt(promptState.data.activePrompt);
            setPromptRevisions(promptState.data.revisions);
          }
          if (!historyState.ok) {
            setGenerationRestoreError(historyState.error.message);
            setHistoryLoadError(historyState.error.message);
          } else {
            setGenerationRestoreError(null);
            setHistoryLoadError(null);
            applyHistorySnapshot(historyState.data);
          }
        }
      }

      isBusyRef.current = false;
    };

    void restore();

    return () => {
      cancelled = true;
      isMountedRef.current = false;
      if (analysisAbortControllerRef.current) {
        analysisAbortControllerRef.current.abort();
        analysisAbortControllerRef.current = null;
      }
      if (activePreviewUrlRef.current) {
        URL.revokeObjectURL(activePreviewUrlRef.current);
        activePreviewUrlRef.current = null;
      }
    };
  }, [
    sourceAssetStorage,
    objectDescription,
    objectDescriptionStorage,
    promptStorage,
    generationStorage,
    artStyle,
    presetEngine,
  ]);

  const openFilePicker = () => {
    if (isBusyRef.current || isAnalyzingRef.current) {
      return;
    }
    fileInputRef.current?.click();
  };

  const persistValidatedUpload = async (
    targetProjectId: EntityId,
    candidateAsset: SourceAsset,
    candidateUrl: string,
    candidateBlob: Blob,
    hadPersistedPrevious: boolean,
    previousView: ActiveSourceAssetView | null,
  ) => {
    updatePersistencePhase('saving');
    const saveResult = await sourceAssetStorage.saveOrReplaceProjectSourceAsset({
      projectId: targetProjectId,
      validatedAsset: candidateAsset,
      binaryBlob: candidateBlob,
    });

    if (!isMountedRef.current) {
      URL.revokeObjectURL(candidateUrl);
      return;
    }

    if (!saveResult.ok) {
      if (hadPersistedPrevious && previousView) {
        URL.revokeObjectURL(candidateUrl);
        updateActiveAsset(previousView);
        updatePersistencePhase('persisted');
        setWorkspaceError(
          `Replacement could not be saved: ${saveResult.error.message} Your previous image remains safely preserved.`,
        );
      } else {
        revokePreviewUrl(activePreviewUrlRef.current);
        activePreviewUrlRef.current = candidateUrl;
        updateActiveAsset({
          sourceAsset: {
            ...candidateAsset,
            localBlobKey: null,
            storageStatus: 'persist_failed',
          },
          previewUrl: candidateUrl,
          binaryBlob: candidateBlob,
        });
        updatePersistencePhase('failed');
        setWorkspaceError(saveResult.error.message);
      }
      return;
    }

    writeStoredActiveProjectId(saveResult.data.project.id);
    setProjectId(saveResult.data.project.id);
    setActiveProject(saveResult.data.project);
    setMissingProjectRecoveryNotice(null);

    if (previousView && previousView.previewUrl !== candidateUrl) {
      revokePreviewUrl(previousView.previewUrl);
    }
    activePreviewUrlRef.current = candidateUrl;
    updateActiveAsset({
      sourceAsset: saveResult.data.sourceAsset,
      previewUrl: candidateUrl,
      binaryBlob: candidateBlob,
    });
    updatePersistencePhase('persisted');
    setWorkspaceError(null);
    resetAnalysisState();
  };

  const processFileList = async (files: FileList | null) => {
    if (!files || files.length === 0) {
      return;
    }

    if (isBusyRef.current || isAnalyzingRef.current) {
      return;
    }

    if (files.length > 1) {
      setWorkspaceError(
        'Only one active source image is allowed per study. Please select a single image file.',
      );
      return;
    }

    const file = files[0];
    if (!file) {
      return;
    }

    isBusyRef.current = true;
    setIsValidating(true);
    setWorkspaceError(null);

    try {
      const validationResult = await validateSelectedImageFile(file, projectId);

      if (!isMountedRef.current) {
        if (validationResult.ok) {
          URL.revokeObjectURL(validationResult.data.previewUrl);
        }
        return;
      }

      if (!validationResult.ok) {
        setWorkspaceError(validationResult.error.message);
        return;
      }

      setIsValidating(false);

      const previousView = activeAssetRef.current;
      const hadPersistedPrevious =
        previousView !== null && persistencePhaseRef.current === 'persisted';

      if (!hadPersistedPrevious) {
        if (previousView) {
          revokePreviewUrl(previousView.previewUrl);
        }
        activePreviewUrlRef.current = validationResult.data.previewUrl;
        updateActiveAsset({
          sourceAsset: validationResult.data.sourceAsset,
          previewUrl: validationResult.data.previewUrl,
          binaryBlob: validationResult.data.binaryBlob,
        });
        updatePersistencePhase('not_persisted');
      }

      await persistValidatedUpload(
        projectId,
        validationResult.data.sourceAsset,
        validationResult.data.previewUrl,
        validationResult.data.binaryBlob,
        hadPersistedPrevious,
        previousView,
      );
    } finally {
      isBusyRef.current = false;
      if (isMountedRef.current) {
        setIsValidating(false);
      }
    }
  };

  const handleRetrySave = async () => {
    const current = activeAssetRef.current;
    if (!current || isBusyRef.current) {
      return;
    }
    isBusyRef.current = true;
    setWorkspaceError(null);
    try {
      await persistValidatedUpload(
        projectId,
        current.sourceAsset,
        current.previewUrl,
        current.binaryBlob,
        false,
        current,
      );
    } finally {
      isBusyRef.current = false;
    }
  };

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = event.target.files;
    void processFileList(selectedFiles).finally(() => {
      event.target.value = '';
    });
  };

  const handleRemoveImage = async () => {
    if (isBusyRef.current || isAnalyzingRef.current) {
      return;
    }

    const current = activeAssetRef.current;
    if (!current) {
      return;
    }

    if (
      persistencePhaseRef.current === 'failed' &&
      current.sourceAsset.storageStatus !== 'persisted'
    ) {
      revokePreviewUrl(current.previewUrl);
      updateActiveAsset(null);
      updatePersistencePhase('not_persisted');
      setWorkspaceError(null);
      resetAnalysisState();
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      return;
    }

    isBusyRef.current = true;
    updatePersistencePhase('saving');
    setWorkspaceError(null);

    try {
      const removeResult =
        await sourceAssetStorage.removeProjectSourceAsset(projectId);

      if (!isMountedRef.current) {
        return;
      }

      if (!removeResult.ok) {
        updatePersistencePhase('failed');
        setWorkspaceError(
          `Source image could not be removed from storage: ${removeResult.error.message}`,
        );
        return;
      }

      revokePreviewUrl(current.previewUrl);
      updateActiveAsset(null);
      updatePersistencePhase('not_persisted');
      setWorkspaceError(null);
      resetAnalysisState();
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } finally {
      isBusyRef.current = false;
    }
  };

  const handleAnalyzeObject = async () => {
    if (isBusyRef.current || isAnalyzingRef.current) {
      return;
    }

    const current = activeAssetRef.current;
    if (!current || persistencePhaseRef.current !== 'persisted') {
      setAnalysisPhase('error');
      setAnalysisError(
        'Upload and persist a validated source image before running object analysis.',
      );
      return;
    }

    const abortController = new AbortController();
    analysisAbortControllerRef.current = abortController;
    isAnalyzingRef.current = true;
    setAnalysisError(null);
    setAnalysisPersistError(null);
    setPendingAnalysisSave(null);
    setAnalysisPhase('validating');

    try {
      const result = await executeVisionAnalysisFromStorage({
        projectId,
        expectedAsset: current.sourceAsset,
        sourceAssetStorage,
        abortSignal: abortController.signal,
        onPhaseChange: (nextPhase) => {
          if (isMountedRef.current) {
            setAnalysisPhase(nextPhase);
          }
        },
      });

      if (!isMountedRef.current) {
        return;
      }

      if (result.ok) {
        const normalizedAnalysis = normalizeRawVisionToObjectAnalysis(result.data);
        const initialDescResult =
          objectDescription.createFromAnalysis(normalizedAnalysis);

        setRawAnalysisResult(result.data);

        if (!initialDescResult.ok) {
          setAnalysisPhase('error');
          setAnalysisError(initialDescResult.error.message);
          return;
        }

        const persistResult =
          await objectDescriptionStorage.saveAnalysisAndInitialDescription({
            projectId,
            analysis: normalizedAnalysis,
            description: initialDescResult.data,
          });

        if (!isMountedRef.current) {
          return;
        }

        if (!persistResult.ok) {
          setPendingAnalysisSave({
            analysis: normalizedAnalysis,
            description: initialDescResult.data,
          });
          setAnalysisPersistError(persistResult.error.message);
          setAnalysisPhase('success');
          return;
        }

        setPendingAnalysisSave(null);
        setAnalysisPersistError(null);
        setActiveAnalysis(persistResult.data.analysis);
        setActiveDescription(persistResult.data.description);
        setAnalysisError(null);
        setAnalysisPhase('success');
        return;
      }

      if (result.error.details?.cancelled === true) {
        setAnalysisPhase('cancelled');
        setAnalysisError(null);
        return;
      }

      setAnalysisPhase('error');
      setAnalysisError(result.error.message);
    } finally {
      if (analysisAbortControllerRef.current === abortController) {
        analysisAbortControllerRef.current = null;
      }
      isAnalyzingRef.current = false;
    }
  };

  const handleRetryPersistAnalysis = async () => {
    if (!pendingAnalysisSave) {
      return;
    }
    const persistResult =
      await objectDescriptionStorage.saveAnalysisAndInitialDescription({
        projectId,
        analysis: pendingAnalysisSave.analysis,
        description: pendingAnalysisSave.description,
      });

    if (!isMountedRef.current) {
      return;
    }

    if (!persistResult.ok) {
      setAnalysisPersistError(persistResult.error.message);
      return;
    }

    setPendingAnalysisSave(null);
    setAnalysisPersistError(null);
    setActiveAnalysis(persistResult.data.analysis);
    setActiveDescription(persistResult.data.description);
  };

  const handleSaveDescription = async (
    draft: ObjectDescriptionEditableFields,
  ): Promise<ServiceResult<ObjectDescription>> => {
    if (!activeAnalysis || !activeDescription) {
      return errResult(
        'NOT_FOUND',
        'No active AI analysis record is available to associate with this description.',
      );
    }

    const normalizedResult = objectDescription.normalizeAndValidate({
      projectId,
      analysis: activeAnalysis,
      existingDescription: activeDescription,
      draft,
    });

    if (!normalizedResult.ok) {
      return normalizedResult;
    }

    const saveResult =
      await objectDescriptionStorage.saveEditedObjectDescription(
        normalizedResult.data,
      );

    if (!isMountedRef.current) {
      return errResult('STORAGE_ERROR', 'Workspace unmounted before save completed.');
    }

    if (!saveResult.ok) {
      return saveResult;
    }

    setActiveAnalysis(saveResult.data.analysis);
    setActiveDescription(saveResult.data.description);
    return okResult(saveResult.data.description);
  };

  const handleResetDescription = async (): Promise<
    ServiceResult<ObjectDescription>
  > => {
    if (!activeAnalysis) {
      return errResult(
        'NOT_FOUND',
        'Original AI Analysis record is missing and cannot be restored.',
      );
    }

    const resetResult = objectDescription.resetFromAnalysis(
      activeAnalysis,
      activeDescription,
    );
    if (!resetResult.ok) {
      return resetResult;
    }

    const persistResult =
      await objectDescriptionStorage.resetObjectDescriptionFromAnalysis({
        projectId,
        analysisId: activeAnalysis.id,
        resetDescription: resetResult.data,
      });

    if (!isMountedRef.current) {
      return errResult('STORAGE_ERROR', 'Workspace unmounted before reset completed.');
    }

    if (!persistResult.ok) {
      return persistResult;
    }

    setActiveAnalysis(persistResult.data.analysis);
    setActiveDescription(persistResult.data.description);
    return okResult(persistResult.data.description);
  };

  const handleCancelAnalysis = () => {
    if (analysisAbortControllerRef.current) {
      analysisAbortControllerRef.current.abort();
      analysisAbortControllerRef.current = null;
    }
  };

  const handleSelectStyleForProject = async (
    nextStyle: ArtStyle | null,
    mode: CreativeDirectionMode,
  ) => {
    setSelectedStyle(nextStyle);
    const res = await creativeStateStorage.setProjectSelectedStyle(
      projectId,
      nextStyle?.id ?? null,
      mode,
    );
    if (res.ok && isMountedRef.current) {
      setActiveCreativeConfiguration(res.data.activeCreativeConfiguration ?? null);
    }
  };

  const handleApplyPresetToCurrentProject = async (presetId: EntityId) => {
    const res = await presetEngine.applyPresetToProject(projectId, presetId);
    if (!res.ok || !isMountedRef.current) {
      return;
    }

    const updatedProject = res.data.project;
    const config = updatedProject.activeCreativeConfiguration ?? null;
    setActiveCreativeConfiguration(config);

    if (config?.mode === 'curated' && config.selectedStyleId) {
      const matched =
        availableStyles.find((s) => s.id === config.selectedStyleId) ??
        (config.creativeDirectionSnapshot
          ? artStyleFromSnapshot(config.creativeDirectionSnapshot)
          : null);
      setSelectedStyle(matched);
    } else {
      setSelectedStyle(null);
    }
  };

  const handleRefreshPresets = async () => {
    const presetsRes = await presetEngine.listPresets();
    if (presetsRes.ok && isMountedRef.current) {
      setAvailablePresets(presetsRes.data);
    }
  };

  const handleViewerImageLoadError = () => {
    updatePersistencePhase('failed');
    setWorkspaceError(
      'The source image preview could not be rendered. Try replacing the image or reloading the study.',
    );
  };

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current += 1;
    if (!isBusyRef.current && !isAnalyzingRef.current) {
      setIsDragActive(true);
    }
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const locked = isBusyRef.current || isAnalyzingRef.current;
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = locked ? 'none' : 'copy';
    }
    if (!locked && !isDragActive) {
      setIsDragActive(true);
    }
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragActive(false);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setIsDragActive(false);
    void processFileList(event.dataTransfer?.files ?? null);
  };

  const asset = activeAsset?.sourceAsset ?? null;
  const isAnalyzing =
    analysisPhase === 'validating' ||
    analysisPhase === 'uploading' ||
    analysisPhase === 'analyzing';
  const isBusy =
    isValidating ||
    persistencePhase === 'saving' ||
    persistencePhase === 'restoring';
  const canAnalyze =
    asset !== null &&
    asset.validationStatus === 'validated' &&
    persistencePhase === 'persisted' &&
    !isBusy &&
    !isAnalyzing;
  const showRetrySave =
    asset !== null &&
    persistencePhase === 'failed' &&
    asset.storageStatus !== 'persisted';

  return (
    <WorkspacePanel
      title="Source Image Workspace"
      subtitle="Stage 01 · Non-destructive source image inspection and local IndexedDB persistence"
      toolbar={
        activeAsset && asset ? (
          <Typography
            variant="caption"
            muted
            className="hidden sm:inline tabular-nums"
          >
            {formatSourceFormatLabel(asset.mimeType)} · {asset.width} ×{' '}
            {asset.height} px · {formatFileSize(asset.fileSizeBytes)}
          </Typography>
        ) : (
          <Button
            key="browse-files-btn"
            variant="primary"
            size="sm"
            leftIcon={<Upload className="h-3.5 w-3.5" aria-hidden="true" />}
            disabled={isBusy}
            onClick={openFilePicker}
          >
            Browse Files
          </Button>
        )
      }
      aside={
        <div className="space-y-5">
          <ImageMetadataPanel
            asset={asset}
            persistencePhase={persistencePhase}
          />

          {asset ? (
            <SourceAssetActions
              fileName={asset.originalFileName}
              isBusy={isBusy}
              isAnalyzing={isAnalyzing}
              canAnalyze={canAnalyze}
              analysisLabel={
                analysisPhase === 'error'
                  ? 'Retry Analysis'
                  : analysisPhase === 'success'
                    ? 'Re-analyze Object'
                    : 'Analyze Object'
              }
              showRetrySave={showRetrySave}
              onAnalyzeObject={() => void handleAnalyzeObject()}
              onReplace={openFilePicker}
              onConfirmRemove={handleRemoveImage}
              onRetrySave={handleRetrySave}
            />
          ) : null}

          <div className="space-y-2">
            <Typography variant="h3">Studio Workflow</Typography>
            <ul className="space-y-1 border-t border-[var(--ff-color-border)] pt-2.5 text-[13px]">
              {WORKFLOW_STAGES.map((stage) => {
                const isStageActive =
                  stage.active ||
                  (stage.id === '02' &&
                    (isAnalyzing ||
                      analysisPhase === 'success' ||
                      activeAnalysis !== null)) ||
                  (stage.id === '03' &&
                    activeAnalysis !== null &&
                    activeDescription !== null) ||
                  (stage.id === '04' &&
                    (selectedStyle !== null ||
                      activeCreativeConfiguration !== null ||
                      activePrompt !== null ||
                      activeDescription !== null)) ||
                  (stage.id === '05' && activePrompt !== null) ||
                  (stage.id === '06' &&
                    (activePrompt?.approvalStatus === 'approved' ||
                      Boolean(restoredGenerationState?.artwork)));
                return (
                  <li
                    key={stage.id}
                    className={cn(
                      isStageActive
                        ? 'font-medium text-[var(--ff-color-primary)]'
                        : 'text-[var(--ff-color-muted-foreground)]',
                    )}
                  >
                    {stage.label}
                  </li>
                );
              })}
            </ul>
          </div>

          <SurfacePanel tone="muted" padding="sm">
            <Typography variant="caption" muted className="block">
              Boundary Enforcement
            </Typography>
            <Typography variant="body-sm" className="mt-1">
              Original source Blobs remain unmodified and isolated in local IndexedDB storage.
            </Typography>
          </SurfacePanel>
        </div>
      }
    >
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_FILE_INPUT}
        aria-label="Select source image file"
        className="sr-only"
        onChange={handleFileInputChange}
      />

      <div
        data-testid="source-upload-dropzone"
        data-drag-active={isDragActive ? 'true' : 'false'}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className="space-y-4"
      >
        {activeProject ? (
          <div
            data-testid="active-project-banner"
            className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--ff-radius-md)] border border-[var(--ff-color-border)] bg-[var(--ff-color-surface-elevated)] px-3.5 py-2.5 text-[13px]"
          >
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="text-[var(--ff-color-muted-foreground)]">
                Active Project:
              </span>
              <span className="truncate font-semibold text-[var(--ff-color-foreground)]">
                {activeProject.title}
              </span>
              {activeProject.status === 'archived' ? (
                <Badge tone="warning">Archived</Badge>
              ) : null}
            </div>
            {onNavigate ? (
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<FolderKanban className="h-3.5 w-3.5" aria-hidden="true" />}
                onClick={() => onNavigate('/projects')}
              >
                My Projects
              </Button>
            ) : null}
          </div>
        ) : null}

        {missingProjectRecoveryNotice ? (
          <Alert
            tone="warning"
            data-testid="missing-project-recovery-alert"
            title="Active project unavailable"
            description={missingProjectRecoveryNotice}
            action={
              <div className="flex items-center gap-2">
                {onNavigate ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onNavigate('/projects')}
                  >
                    Open My Projects
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setMissingProjectRecoveryNotice(null)}
                >
                  Dismiss
                </Button>
              </div>
            }
          />
        ) : null}

        {workspaceError ? (
          <Alert
            tone="destructive"
            title="Source image operation failed"
            description={workspaceError}
            action={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setWorkspaceError(null)}
              >
                Dismiss
              </Button>
            }
          />
        ) : null}

        {persistencePhase === 'restoring' ? (
          <LoadingState
            label="Restoring active study..."
            description="Checking local IndexedDB storage for a previously saved source image."
          />
        ) : isValidating ? (
          <LoadingState
            label="Validating source image..."
            description="Inspecting binary signature, dimensions, and image integrity."
          />
        ) : activeAsset && asset ? (
          <div className="space-y-4">
            <div className="space-y-3">
              <SourceImageViewer
                assetId={asset.id}
                src={activeAsset.previewUrl}
                alt={`Source preview: ${asset.originalFileName}`}
                naturalWidth={asset.width}
                naturalHeight={asset.height}
                isDragReplaceActive={isDragActive}
                onImageLoadError={handleViewerImageLoadError}
              />

              <div className="flex flex-wrap items-center justify-between gap-3 text-[13px]">
                <div className="min-w-0 truncate font-medium text-[var(--ff-color-foreground)]">
                  {asset.originalFileName}
                  <span className="ml-2 font-normal text-[var(--ff-color-muted-foreground)] tabular-nums">
                    · {formatSourceFormatLabel(asset.mimeType)} · {asset.width} ×{' '}
                    {asset.height} px · {formatFileSize(asset.fileSizeBytes)}
                  </span>
                </div>
                <Typography variant="caption" muted>
                  {persistencePhase === 'persisted'
                    ? 'Persisted locally in IndexedDB · Drop a new file to replace'
                    : persistencePhase === 'saving'
                      ? 'Saving image and metadata to IndexedDB...'
                      : persistencePhase === 'failed'
                        ? 'Storage failed · Retry save or remove'
                        : 'Validated in memory · Preparing storage'}
                </Typography>
              </div>
            </div>

            <ObjectAnalysisPreviewPanel
              phase={analysisPhase}
              result={rawAnalysisResult}
              persistedAnalysis={activeAnalysis}
              errorMessage={analysisError}
              persistenceError={analysisPersistError}
              canAnalyze={canAnalyze}
              onAnalyze={() => void handleAnalyzeObject()}
              onCancel={handleCancelAnalysis}
              onRetryPersistAnalysis={
                pendingAnalysisSave ? () => void handleRetryPersistAnalysis() : undefined
              }
            />

            {activeAnalysis && activeDescription ? (
              <>
                <EditableObjectDescriptionPanel
                  analysis={activeAnalysis}
                  description={activeDescription}
                  sourceAssetFileName={asset.originalFileName}
                  isLocked={isBusy || isAnalyzing}
                  onSaveDescription={handleSaveDescription}
                  onResetToAnalysis={handleResetDescription}
                  onDirtyChange={setHasUnsavedDescriptionEdits}
                />

                <div ref={promptComposerSectionRef} id="prompt-composer-section">
                  <PromptComposerPanel
                    projectId={projectId}
                    description={activeDescription}
                    hasUnsavedDescriptionEdits={hasUnsavedDescriptionEdits}
                    selectedStyle={selectedStyle}
                    activeCreativeConfiguration={activeCreativeConfiguration}
                    availableStyles={availableStyles}
                    availablePresets={availablePresets}
                    activePrompt={activePrompt}
                    promptRevisions={promptRevisions}
                    isWorkspaceBusy={isBusy || isAnalyzing}
                    onSelectStyle={handleSelectStyleForProject}
                    onApplyPreset={handleApplyPresetToCurrentProject}
                    onPresetCreated={handleRefreshPresets}
                    onNavigate={onNavigate}
                    onPromptPersisted={(persistedState: PersistedPromptState) => {
                      setActivePrompt(persistedState.activePrompt);
                      setPromptRevisions(persistedState.revisions);
                    }}
                  />
                </div>

                <ImageGenerationSection
                  projectId={projectId}
                  activePrompt={activePrompt}
                  selectedStyle={selectedStyle}
                  isWorkspaceBusy={isBusy || isAnalyzing}
                  restoredGenerationState={restoredGenerationState}
                  generationRestoreError={generationRestoreError}
                  providerController={providerController}
                  isGlobalGenerationInFlight={isGenerationInFlight}
                  onGlobalGenerationInFlightChange={setIsGenerationInFlight}
                  onGenerationPersisted={(savedState) => {
                    setRestoredGenerationState(savedState);
                    setGenerationRestoreError(null);
                    void refreshProjectGenerationHistory(projectId);
                  }}
                  onJumpToPromptComposer={() => {
                    promptComposerSectionRef.current?.scrollIntoView({
                      behavior: 'smooth',
                      block: 'start',
                    });
                  }}
                  onNavigate={onNavigate}
                />

                <GenerationHistorySection
                  projectId={projectId}
                  projectTitle={restoredGenerationState?.project.title ?? null}
                  entries={historyEntries}
                  isLoadingHistory={isLoadingHistory}
                  historyLoadError={historyLoadError}
                  providerController={providerController}
                  isGlobalGenerationInFlight={isGenerationInFlight}
                  onGlobalGenerationInFlightChange={setIsGenerationInFlight}
                  nextVariationRevisionNumber={historyEntries.length + 1}
                  onGenerationPersisted={(savedState) => {
                    setRestoredGenerationState(savedState);
                    setGenerationRestoreError(null);
                    void refreshProjectGenerationHistory(projectId);
                  }}
                  onNavigate={onNavigate}
                />
              </>
            ) : null}
          </div>
        ) : (
          <div
            className={cn(
              'flex min-h-[400px] flex-col items-center justify-center rounded-[var(--ff-radius-md)] border border-dashed px-6 py-12 text-center transition-colors duration-150',
              isDragActive
                ? 'border-[var(--ff-color-primary)] bg-[var(--ff-color-info-subtle)]'
                : 'border-[var(--ff-color-input)] bg-[var(--ff-color-surface-elevated)]',
            )}
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-[var(--ff-radius-md)] border border-[var(--ff-color-border)] bg-[var(--ff-color-surface)] text-[var(--ff-color-muted-foreground)]">
              <ImagePlus className="h-5 w-5" aria-hidden="true" />
            </div>
            <Typography variant="h3" className="mt-4">
              {isDragActive
                ? 'Drop source image to validate'
                : 'Upload Source Image'}
            </Typography>
            <Typography variant="body-sm" muted className="mt-1.5 max-w-md">
              Drag and drop a single reference image into this workspace, or browse files on your computer to begin validation.
            </Typography>
            <div className="mt-5">
              <Button
                variant="primary"
                size="md"
                leftIcon={<Upload className="h-4 w-4" aria-hidden="true" />}
                onClick={openFilePicker}
              >
                Select Source Image
              </Button>
            </div>
            <Typography variant="caption" muted className="mt-4 tabular-nums">
              JPEG, JPG, PNG, WebP · Minimum 256 × 256 px · Maximum 20 MB
            </Typography>
          </div>
        )}
      </div>
    </WorkspacePanel>
  );
}

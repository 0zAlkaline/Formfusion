import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Cpu,
  HardDrive,
  Image as ImageIcon,
  Lock,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useStudioServices } from '../../app/providers/AppProviders.tsx';
import {
  buildTextOnlyExecutePayload,
  executeTextToImageGeneration,
  getFreeTierAccessLabel,
  isProviderReadyWithSelection,
  resolveSupportedOutputSpec,
  validateGenerationReadiness,
  type ImageGenerationWorkflowState,
} from '../../services/image-generation/imageGenerationClient.ts';
import {
  fetchRegisteredImageGenerationProviders,
  testImageGenerationProviderConnection,
} from '../../services/image-generation/providerStatusClient.ts';
import type { PersistedGenerationState } from '../../services/project-storage/browserProjectStorage.ts';
import {
  formatFileSize,
  formatSourceFormatLabel,
} from '../../services/source-asset/imageValidation.ts';
import type { EntityId } from '../../types/common.ts';
import type {
  ArtStyle,
  GeneratedArtwork,
  GenerationJob,
  PromptDocument,
} from '../../types/domain.ts';
import type { ImageGenerationProvidersController } from '../../hooks/useImageGenerationProviders.ts';
import type {
  ImageGenerationProviderStatusValue,
  RegisteredImageGenerationProviderSummary,
} from '../../types/providers.ts';
import {
  Alert,
  Badge,
  type BadgeTone,
  Button,
  Checkbox,
  Modal,
  SurfacePanel,
  Typography,
  cn,
} from '../ui/index.ts';

export interface ImageGenerationSectionProps {
  readonly projectId: EntityId;
  readonly activePrompt: PromptDocument | null;
  readonly selectedStyle: ArtStyle | null;
  readonly isWorkspaceBusy: boolean;
  readonly restoredGenerationState: PersistedGenerationState | null;
  readonly generationRestoreError?: string | null;
  readonly providerController?: ImageGenerationProvidersController;
  readonly isGlobalGenerationInFlight?: boolean;
  readonly onGlobalGenerationInFlightChange?: (inFlight: boolean) => void;
  readonly onGenerationPersisted?: (state: PersistedGenerationState) => void;
  readonly onJumpToPromptComposer?: () => void;
  readonly onNavigate?: (path: string) => void;
}

interface ActiveArtworkDisplay {
  readonly artwork: GeneratedArtwork;
  readonly job: GenerationJob;
  readonly blob: Blob;
  readonly previewUrl: string;
  readonly isPersisted: boolean;
  readonly providerName: string;
}

const WORKFLOW_STATE_BADGES: Record<
  ImageGenerationWorkflowState,
  { readonly label: string; readonly tone: BadgeTone }
> = {
  idle: { label: 'Idle', tone: 'neutral' },
  validating: { label: 'Validating', tone: 'info' },
  confirming: { label: 'Confirming', tone: 'warning' },
  generating: { label: 'Generating', tone: 'info' },
  completed: { label: 'Completed', tone: 'success' },
  failed: { label: 'Failed', tone: 'destructive' },
  rate_limited: { label: 'Rate Limited', tone: 'warning' },
  uncertain: { label: 'Uncertain', tone: 'warning' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

const PROVIDER_CONNECTION_BADGES: Record<
  ImageGenerationProviderStatusValue,
  { readonly label: string; readonly tone: BadgeTone }
> = {
  not_configured: { label: 'Not Configured', tone: 'warning' },
  configured: { label: 'Configured', tone: 'info' },
  verifying: { label: 'Verifying', tone: 'info' },
  connected: { label: 'Connected', tone: 'success' },
  error: { label: 'Error', tone: 'destructive' },
  rate_limited: { label: 'Rate Limited', tone: 'warning' },
  unavailable: { label: 'Unavailable', tone: 'destructive' },
};

function getPromptApprovalBadge(
  prompt: PromptDocument | null,
): { readonly label: string; readonly tone: BadgeTone } {
  if (!prompt) {
    return { label: 'No Prompt Synthesized', tone: 'warning' };
  }
  switch (prompt.approvalStatus) {
    case 'approved':
      return { label: 'Approved & Locked', tone: 'success' };
    case 'edited':
      return { label: 'Edited Draft (Unapproved)', tone: 'warning' };
    default:
      return { label: 'Draft (Unapproved)', tone: 'warning' };
  }
}

export function ImageGenerationSection({
  projectId,
  activePrompt,
  selectedStyle,
  isWorkspaceBusy,
  restoredGenerationState,
  generationRestoreError = null,
  providerController,
  isGlobalGenerationInFlight = false,
  onGlobalGenerationInFlightChange,
  onGenerationPersisted,
  onJumpToPromptComposer,
  onNavigate,
}: ImageGenerationSectionProps) {
  const { generationStorage } = useStudioServices();

  const [localProviders, setLocalProviders] = useState<
    readonly RegisteredImageGenerationProviderSummary[]
  >([]);
  const [localSelectedProviderId, setLocalSelectedProviderId] = useState<string>('');
  const [localLoadingProviders, setLocalLoadingProviders] = useState(
    !providerController,
  );
  const [localProviderLoadError, setLocalProviderLoadError] = useState<
    string | null
  >(null);
  const [localTestingHealth, setLocalTestingHealth] = useState(false);

  const [localAllowAnonymousFreeTier, setLocalAllowAnonymousFreeTier] =
    useState(false);

  const providers = providerController
    ? providerController.providers
    : localProviders;
  const selectedProviderId = providerController
    ? providerController.selectedProviderId
    : localSelectedProviderId;
  const loadingProviders = providerController
    ? providerController.loadingProviders
    : localLoadingProviders;
  const providerLoadError = providerController
    ? providerController.providerLoadError
    : localProviderLoadError;
  const testingHealth = providerController
    ? providerController.testingHealth
    : localTestingHealth;
  const allowAnonymousFreeTier = providerController
    ? providerController.allowAnonymousFreeTier
    : localAllowAnonymousFreeTier;

  const setSelectedProviderId = (id: string) => {
    if (providerController) {
      providerController.setSelectedProviderId(id);
    } else {
      setLocalSelectedProviderId(id);
    }
  };

  const setAllowAnonymousFreeTier = (allow: boolean) => {
    if (providerController) {
      providerController.setAllowAnonymousFreeTier(allow);
    } else {
      setLocalAllowAnonymousFreeTier(allow);
    }
  };

  const [includeNegativePrompt, setIncludeNegativePrompt] = useState(true);

  const [workflowState, setWorkflowState] =
    useState<ImageGenerationWorkflowState>('idle');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const [displayResult, setDisplayResult] =
    useState<ActiveArtworkDisplay | null>(null);
  const [latestJob, setLatestJob] = useState<GenerationJob | null>(null);

  const inFlightRef = useRef(false);
  const isMountedRef = useRef(true);
  const activePreviewUrlRef = useRef<string | null>(null);
  const displayedArtworkIdRef = useRef<EntityId | null>(null);
  const displayedIsPersistedRef = useRef(false);

  const revokeActivePreview = useCallback((url: string | null | undefined) => {
    if (url) {
      URL.revokeObjectURL(url);
      if (activePreviewUrlRef.current === url) {
        activePreviewUrlRef.current = null;
      }
    }
  }, []);

  const replaceDisplayResult = useCallback(
    (next: ActiveArtworkDisplay | null) => {
      const prevUrl = activePreviewUrlRef.current;
      if (prevUrl && prevUrl !== next?.previewUrl) {
        URL.revokeObjectURL(prevUrl);
      }
      activePreviewUrlRef.current = next?.previewUrl ?? null;
      displayedArtworkIdRef.current = next?.artwork.id ?? null;
      displayedIsPersistedRef.current = Boolean(next?.isPersisted);
      setDisplayResult(next);
    },
    [],
  );

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (activePreviewUrlRef.current) {
        URL.revokeObjectURL(activePreviewUrlRef.current);
        activePreviewUrlRef.current = null;
      }
    };
  }, []);

  const loadRegisteredProviders = useCallback(async () => {
    if (providerController) {
      await providerController.loadRegisteredProviders();
      return;
    }
    setLocalLoadingProviders(true);
    setLocalProviderLoadError(null);
    const response = await fetchRegisteredImageGenerationProviders();
    if (!isMountedRef.current) {
      return;
    }

    if (!response.ok || !response.data) {
      setLocalProviders([]);
      setLocalProviderLoadError(
        response.error?.message ??
          'Unable to load registered image generation providers.',
      );
      setLocalLoadingProviders(false);
      return;
    }

    const list = response.data.providers;
    setLocalProviders(list);
    setLocalSelectedProviderId((current) => {
      if (current && list.some((item) => item.capabilities.providerId === current)) {
        return current;
      }
      return (
        response.data?.activeProviderId ??
        list[0]?.capabilities.providerId ??
        ''
      );
    });
    setLocalLoadingProviders(false);
  }, [providerController]);

  useEffect(() => {
    if (!providerController) {
      void loadRegisteredProviders();
    }
  }, [loadRegisteredProviders, providerController]);

  // Restore previously persisted generated artwork from IndexedDB cleanly on mount/project reload.
  useEffect(() => {
    if (inFlightRef.current) {
      return;
    }

    if (!restoredGenerationState) {
      replaceDisplayResult(null);
      setLatestJob(null);
      setWorkflowState('idle');
      setPersistenceError(null);
      return;
    }

    setLatestJob(restoredGenerationState.latestJob);

    if (restoredGenerationState.artwork && restoredGenerationState.imageBlob) {
      if (
        displayedArtworkIdRef.current === restoredGenerationState.artwork.id &&
        displayedIsPersistedRef.current
      ) {
        return;
      }
      const objectUrl = URL.createObjectURL(restoredGenerationState.imageBlob);
      const matchingJob =
        restoredGenerationState.latestJob &&
        restoredGenerationState.latestJob.id ===
          restoredGenerationState.artwork.generationJobId
          ? restoredGenerationState.latestJob
          : {
              id: restoredGenerationState.artwork.generationJobId,
              projectId: restoredGenerationState.artwork.projectId,
              promptDocumentId: restoredGenerationState.artwork.promptDocumentId,
              providerConfigRef: {
                providerId: 'ovhcloud',
                modelId: restoredGenerationState.artwork.providerModelId,
              },
              aspectRatio: '1:1' as const,
              resolution: {
                width: restoredGenerationState.artwork.width,
                height: restoredGenerationState.artwork.height,
                label: 'standard' as const,
              },
              modelParameters: {},
              status: 'completed' as const,
              artworkIds: [restoredGenerationState.artwork.id],
              errorCode: null,
              errorMessage: null,
              queuedAt: restoredGenerationState.artwork.createdAt,
              startedAt: restoredGenerationState.artwork.createdAt,
              completedAt: restoredGenerationState.artwork.createdAt,
              createdAt: restoredGenerationState.artwork.createdAt,
              updatedAt: restoredGenerationState.artwork.updatedAt,
            };

      const matchedProvider = providers.find(
        (p) =>
          p.capabilities.providerId === matchingJob.providerConfigRef.providerId ||
          p.capabilities.modelId === restoredGenerationState.artwork?.providerModelId,
      );

      replaceDisplayResult({
        artwork: restoredGenerationState.artwork,
        job: matchingJob,
        blob: restoredGenerationState.imageBlob,
        previewUrl: objectUrl,
        isPersisted: true,
        providerName:
          matchedProvider?.capabilities.providerName ?? 'OVHcloud AI Endpoints',
      });
      setWorkflowState('completed');
      setErrorBanner(null);
      setStatusMessage(
        'Restored persisted generated artwork from local IndexedDB storage.',
      );
      return;
    }

    replaceDisplayResult(null);
    setWorkflowState('idle');
  }, [restoredGenerationState, providers, replaceDisplayResult]);

  useEffect(() => {
    if (workflowState !== 'generating') {
      setElapsedSeconds(0);
      return;
    }
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.max(1, Math.floor((Date.now() - startedAt) / 1000)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [workflowState]);

  const selectedProvider =
    providers.find(
      (item) => item.capabilities.providerId === selectedProviderId,
    ) ??
    providers[0] ??
    null;

  const isGenerating =
    workflowState === 'validating' ||
    workflowState === 'generating' ||
    isGlobalGenerationInFlight;

  const readiness = validateGenerationReadiness({
    projectId,
    promptDocument: activePrompt,
    providerSummary: selectedProvider,
    allowAnonymousFreeTier,
    isGenerating: isGenerating || inFlightRef.current || isGlobalGenerationInFlight,
  });

  const handleCheckProviderConnection = async () => {
    if (providerController) {
      await providerController.checkProviderConnection();
      return;
    }
    if (!selectedProvider || testingHealth) {
      return;
    }
    setLocalTestingHealth(true);
    setLocalProviderLoadError(null);
    const res = await testImageGenerationProviderConnection({
      ...(allowAnonymousFreeTier ? { allowAnonymousFreeTier: true } : {}),
    });
    if (!isMountedRef.current) {
      return;
    }

    if (res.data?.status && res.data?.capabilities) {
      const updatedStatus = res.data.status;
      const updatedCapabilities = res.data.capabilities;
      setLocalProviders((prev) =>
        prev.map((item) =>
          item.capabilities.providerId === updatedCapabilities.providerId
            ? {
                ...item,
                capabilities: updatedCapabilities,
                status: updatedStatus,
              }
            : item,
        ),
      );
    }
    if (!res.ok) {
      setLocalProviderLoadError(
        res.error?.message ?? 'Provider connection test failed.',
      );
    }
    setLocalTestingHealth(false);
  };

  const handleRequestGenerateClick = () => {
    if (
      inFlightRef.current ||
      isGenerating ||
      isGlobalGenerationInFlight ||
      isWorkspaceBusy
    ) {
      return;
    }

    setErrorBanner(null);
    setStatusMessage(null);
    setWorkflowState('validating');

    const check = validateGenerationReadiness({
      projectId,
      promptDocument: activePrompt,
      providerSummary: selectedProvider,
      allowAnonymousFreeTier,
      isGenerating: false,
    });

    if (!check.ready || !activePrompt || !selectedProvider) {
      setWorkflowState('failed');
      setErrorBanner(
        check.message ??
          'Approve your Final Master Prompt and verify provider availability before generating artwork.',
      );
      return;
    }

    const dryPayloadCheck = buildTextOnlyExecutePayload({
      projectId,
      promptDocument: activePrompt,
      providerSummary: selectedProvider,
      includeNegativePrompt,
      allowAnonymousFreeTier,
    });

    if (!dryPayloadCheck.ok) {
      setWorkflowState('failed');
      setErrorBanner(dryPayloadCheck.error.message);
      return;
    }

    setWorkflowState('confirming');
  };

  const handleCancelConfirmation = () => {
    if (inFlightRef.current) {
      return;
    }
    setWorkflowState('cancelled');
    setErrorBanner(null);
    setStatusMessage(
      'Generation cancelled before submission. No external request was sent.',
    );
  };

  const persistCompletedGeneration = useCallback(
    async (
      job: GenerationJob,
      artwork: GeneratedArtwork,
      imageBlob: Blob,
      previewUrl: string,
      providerName: string,
    ) => {
      setPersistenceError(null);
      const saveRes = await generationStorage.saveGeneratedArtworkResult({
        job,
        artwork,
        imageBlob,
      });

      if (!isMountedRef.current) {
        revokeActivePreview(previewUrl);
        return;
      }

      if (!saveRes.ok) {
        setPersistenceError(
          `Artwork was generated, but local IndexedDB saving failed: ${saveRes.error.message}. Use Retry Saving Locally without re-generating.`,
        );
        replaceDisplayResult({
          artwork,
          job,
          blob: imageBlob,
          previewUrl,
          isPersisted: false,
          providerName,
        });
        return;
      }

      replaceDisplayResult({
        artwork,
        job,
        blob: imageBlob,
        previewUrl,
        isPersisted: true,
        providerName,
      });
      setStatusMessage(
        'Generated artwork and execution record persisted locally in IndexedDB.',
      );
      onGenerationPersisted?.(saveRes.data);
    },
    [
      generationStorage,
      onGenerationPersisted,
      replaceDisplayResult,
      revokeActivePreview,
    ],
  );

  const handleRetryPersistLocally = async () => {
    if (!displayResult || displayResult.isPersisted || inFlightRef.current) {
      return;
    }
    await persistCompletedGeneration(
      displayResult.job,
      displayResult.artwork,
      displayResult.blob,
      displayResult.previewUrl,
      displayResult.providerName,
    );
  };

  const handleConfirmGenerate = async () => {
    if (
      inFlightRef.current ||
      isGlobalGenerationInFlight ||
      !activePrompt ||
      !selectedProvider ||
      workflowState !== 'confirming'
    ) {
      return;
    }

    inFlightRef.current = true;
    onGlobalGenerationInFlightChange?.(true);
    setErrorBanner(null);
    setPersistenceError(null);
    setStatusMessage(null);
    setWorkflowState('generating');

    try {
      const outcome = await executeTextToImageGeneration({
        projectId,
        promptDocument: activePrompt,
        providerSummary: selectedProvider,
        includeNegativePrompt,
        allowAnonymousFreeTier,
        lineage: {
          generationKind: 'original',
        },
      });

      if (!isMountedRef.current) {
        return;
      }

      if (outcome.job) {
        setLatestJob(outcome.job);
      }

      if (
        outcome.outcomeState === 'completed' &&
        outcome.job &&
        outcome.artwork &&
        outcome.imageBlob
      ) {
        const previewUrl = URL.createObjectURL(outcome.imageBlob);
        setWorkflowState('completed');
        await persistCompletedGeneration(
          outcome.job,
          outcome.artwork,
          outcome.imageBlob,
          previewUrl,
          selectedProvider.capabilities.providerName,
        );
        return;
      }

      if (outcome.job) {
        const historySave = await generationStorage.saveGenerationHistoryEntry(
          outcome.job,
        );
        if (historySave.ok && isMountedRef.current) {
          onGenerationPersisted?.(historySave.data);
        }
      }

      if (!isMountedRef.current) {
        return;
      }

      setWorkflowState(outcome.outcomeState);
      if (outcome.outcomeState === 'cancelled') {
        setErrorBanner(null);
        setStatusMessage(
          outcome.errorMessage ?? 'Image generation cancelled before dispatch.',
        );
      } else {
        setErrorBanner(
          outcome.errorMessage ?? 'Image generation failed unexpectedly.',
        );
      }
    } finally {
      inFlightRef.current = false;
      onGlobalGenerationInFlightChange?.(false);
    }
  };

  const promptBadge = getPromptApprovalBadge(activePrompt);
  const workflowBadge = WORKFLOW_STATE_BADGES[workflowState];
  const promptApproved =
    activePrompt !== null && activePrompt.approvalStatus === 'approved';

  const outputSpec = selectedProvider
    ? resolveSupportedOutputSpec(selectedProvider.capabilities)
    : { width: 1024, height: 1024, aspectRatio: '1:1' as const, label: '1024 × 1024' };

  const providerReady = isProviderReadyWithSelection(
    selectedProvider,
    allowAnonymousFreeTier,
  );

  const needsExplicitAnonymousOptIn = Boolean(
    selectedProvider &&
      !selectedProvider.status.tokenConfigured &&
      !selectedProvider.status.anonymousFreeTierEnabled &&
      selectedProvider.capabilities.supportsAnonymousFreeTier,
  );

  const creativeDirectionName =
    activePrompt?.creativeDirection?.styleName ??
    selectedStyle?.name ??
    'Manual Direction';

  const freeTierAccessLabel = getFreeTierAccessLabel(
    selectedProvider?.status,
    allowAnonymousFreeTier,
  );

  return (
    <SurfacePanel
      tone="default"
      padding="md"
      className="space-y-6"
      data-testid="image-generation-section"
      data-workflow-state={workflowState}
      aria-labelledby="section-h-heading"
    >
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--ff-color-border)] pb-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Sparkles
              className="h-4 w-4 text-[var(--ff-color-primary)]"
              aria-hidden="true"
            />
            <Typography id="section-h-heading" variant="h3">
              Section H · Text-to-Image Generation
            </Typography>
            <Badge tone={workflowBadge.tone} data-testid="generation-state-badge">
              {workflowBadge.label}
            </Badge>
          </div>
          <Typography variant="caption" muted className="block">
            Synthesize square 1024 × 1024 artwork strictly from your approved text Master Prompt.
          </Typography>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Typography
            variant="caption"
            muted
            className="font-mono text-[11px] tabular-nums"
          >
            Study {projectId}
          </Typography>
        </div>
      </div>

      {generationRestoreError ? (
        <Alert
          tone="warning"
          title="Previous generated artwork could not be restored"
          description={generationRestoreError}
        />
      ) : null}

      {/* SUBSECTION A — Approved Prompt Summary */}
      <section
        aria-labelledby="subsection-a-heading"
        className="space-y-3 rounded-[var(--ff-radius-md)] border border-[var(--ff-color-border)] bg-[var(--ff-color-surface-elevated)] p-4"
        data-testid="approved-prompt-summary"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Typography id="subsection-a-heading" variant="label">
              A. Approved Prompt Summary
            </Typography>
            <Badge tone={promptBadge.tone} data-testid="prompt-approval-summary-badge">
              {promptBadge.label}
            </Badge>
            {activePrompt ? (
              <Badge tone="neutral">
                Revision v{activePrompt.revisionNumber ?? activePrompt.revision}
              </Badge>
            ) : null}
          </div>

          {onJumpToPromptComposer ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onJumpToPromptComposer}
              data-testid="jump-to-prompt-composer-btn"
            >
              Back to Prompt Composer
            </Button>
          ) : null}
        </div>

        {!promptApproved ? (
          <Alert
            tone="warning"
            title="Approve your Final Master Prompt before generating artwork."
            description={
              activePrompt
                ? 'Your active Master Prompt revision is still in draft/edited state. Review and lock your approval in Prompt Composer before generating.'
                : 'Synthesize and approve a Final Master Prompt in Prompt Composer above before generating artwork.'
            }
          />
        ) : null}

        {activePrompt ? (
          <div className="space-y-2.5 text-[13px]">
            <div className="grid gap-2 text-[12px] text-[var(--ff-color-muted-foreground)] sm:grid-cols-3">
              <div>
                <span className="font-medium text-[var(--ff-color-foreground)]">
                  Creative Direction:
                </span>{' '}
                {creativeDirectionName}
              </div>
              <div className="tabular-nums">
                <span className="font-medium text-[var(--ff-color-foreground)]">
                  Prompt ID:
                </span>{' '}
                <span className="font-mono text-[11px]">{activePrompt.id}</span>
              </div>
              <div className="tabular-nums">
                <span className="font-medium text-[var(--ff-color-foreground)]">
                  Character Length:
                </span>{' '}
                {activePrompt.finalPrompt.trim().length}
                {selectedProvider
                  ? ` / ${selectedProvider.capabilities.maxPromptLength}`
                  : ''}
              </div>
            </div>

            <div className="rounded-[var(--ff-radius-sm)] border border-[var(--ff-color-border)] bg-[var(--ff-color-surface)] p-3">
              <Typography variant="caption" muted className="mb-1 block">
                Final Master Prompt
              </Typography>
              <p
                className="whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--ff-color-foreground)]"
                data-testid="generation-final-prompt-preview"
              >
                {activePrompt.finalPrompt}
              </p>
            </div>
          </div>
        ) : null}
      </section>

      {/* SUBSECTION B — Provider Selection */}
      <section
        aria-labelledby="subsection-b-heading"
        className="space-y-3"
        data-testid="provider-selection-section"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Cpu
              className="h-4 w-4 text-[var(--ff-color-muted-foreground)]"
              aria-hidden="true"
            />
            <Typography id="subsection-b-heading" variant="label">
              B. Image Generation Provider Selection
            </Typography>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              leftIcon={<RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
              disabled={loadingProviders || isGenerating}
              onClick={() => void loadRegisteredProviders()}
            >
              Refresh
            </Button>
            {onNavigate ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                rightIcon={<ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />}
                onClick={() => onNavigate('/settings')}
              >
                Provider Settings
              </Button>
            ) : null}
          </div>
        </div>

        {providerLoadError ? (
          <Alert
            tone="warning"
            title="Provider status alert"
            description={providerLoadError}
          />
        ) : null}

        {loadingProviders ? (
          <SurfacePanel tone="elevated" padding="sm">
            <Typography variant="body-sm" muted>
              Inspecting registered image generation providers...
            </Typography>
          </SurfacePanel>
        ) : providers.length === 0 ? (
          <Alert
            tone="destructive"
            title="No image generation providers registered"
            description="Verify server-side provider registration in /settings before generating artwork."
          />
        ) : (
          <div className="space-y-3">
            {providers.map((item) => {
              const { capabilities, status } = item;
              const isSelected =
                selectedProvider?.capabilities.providerId ===
                capabilities.providerId;
              const effectiveStatus: ImageGenerationProviderStatusValue =
                testingHealth && isSelected ? 'verifying' : status.connectionStatus;
              const connBadge = PROVIDER_CONNECTION_BADGES[effectiveStatus];
              const itemReady = isProviderReadyWithSelection(
                item,
                allowAnonymousFreeTier,
              );

              return (
                <div
                  key={capabilities.providerId}
                  data-testid={`provider-card-${capabilities.providerId}`}
                  className={cn(
                    'rounded-[var(--ff-radius-md)] border p-4 transition-colors',
                    isSelected
                      ? 'border-[var(--ff-color-primary)] bg-[var(--ff-color-surface)]'
                      : 'border-[var(--ff-color-border)] bg-[var(--ff-color-surface-elevated)]',
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          id={`provider-radio-${capabilities.providerId}`}
                          type="radio"
                          name="image-generation-provider"
                          checked={isSelected}
                          disabled={isGenerating}
                          onChange={() =>
                            setSelectedProviderId(capabilities.providerId)
                          }
                          className="h-4 w-4 accent-[var(--ff-color-primary)] cursor-pointer"
                        />
                        <label
                          htmlFor={`provider-radio-${capabilities.providerId}`}
                          className="text-[14px] font-semibold text-[var(--ff-color-foreground)] cursor-pointer"
                        >
                          {capabilities.providerName}
                        </label>
                        {capabilities.isFreeTierModel ? (
                          <Badge tone="accent">Free Tier</Badge>
                        ) : null}
                        <Badge tone={connBadge.tone}>{connBadge.label}</Badge>
                        <Badge tone={itemReady ? 'success' : 'warning'}>
                          {itemReady ? 'Available' : 'Action Required'}
                        </Badge>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-6 text-[12px] text-[var(--ff-color-muted-foreground)] tabular-nums">
                        <span>
                          Model:{' '}
                          <span className="font-mono text-[var(--ff-color-foreground)]">
                            {capabilities.modelId}
                          </span>
                        </span>
                        <span>
                          Supported Output:{' '}
                          <span className="font-medium text-[var(--ff-color-foreground)]">
                            {capabilities.supportedOutputSizes
                              .map((size) => size.label)
                              .join(', ')}
                          </span>
                        </span>
                        <span>Task: Text-to-Image only</span>
                      </div>
                    </div>

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      leftIcon={<Activity className="h-3.5 w-3.5" aria-hidden="true" />}
                      loading={testingHealth && isSelected}
                      disabled={isGenerating}
                      onClick={() => void handleCheckProviderConnection()}
                      data-testid="test-provider-connection-btn"
                    >
                      Test Connection
                    </Button>
                  </div>

                  <p className="mt-2.5 pl-6 text-[12px] leading-relaxed text-[var(--ff-color-muted-foreground)]">
                    {status.statusMessage}
                  </p>

                  {isSelected && needsExplicitAnonymousOptIn ? (
                    <div className="mt-3 ml-6 rounded-[var(--ff-radius-sm)] border border-[#EAD7B6] bg-[var(--ff-color-warning-subtle)] p-3">
                      <Checkbox
                        id="gen-allow-anonymous-free-tier"
                        checked={allowAnonymousFreeTier}
                        disabled={isGenerating}
                        onChange={(e) =>
                          setAllowAnonymousFreeTier(e.target.checked)
                        }
                        label="Allow explicit anonymous free-tier request mode"
                        description="No server token is detected. Anonymous requests are subject to OVHcloud's strict 2 requests/minute rate limit."
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* SUBSECTION C — Generation Settings (Capability-Aware Only) */}
      <section
        aria-labelledby="subsection-c-heading"
        className="space-y-3 rounded-[var(--ff-radius-md)] border border-[var(--ff-color-border)] bg-[var(--ff-color-surface-elevated)] p-4"
        data-testid="generation-settings-section"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Typography id="subsection-c-heading" variant="label">
            C. Generation Settings
          </Typography>
          <Badge tone="neutral">Capability-Enforced</Badge>
        </div>

        <div className="grid gap-3 sm:grid-cols-4">
          <div className="rounded-[var(--ff-radius-sm)] border border-[var(--ff-color-border)] bg-[var(--ff-color-surface)] px-3 py-2.5">
            <Typography variant="caption" muted className="block">
              Output Resolution
            </Typography>
            <Typography variant="body-sm" className="mt-0.5 font-medium tabular-nums">
              {outputSpec.width} × {outputSpec.height} px
            </Typography>
          </div>
          <div className="rounded-[var(--ff-radius-sm)] border border-[var(--ff-color-border)] bg-[var(--ff-color-surface)] px-3 py-2.5">
            <Typography variant="caption" muted className="block">
              Aspect Ratio
            </Typography>
            <Typography variant="body-sm" className="mt-0.5 font-medium tabular-nums">
              {outputSpec.aspectRatio}
            </Typography>
          </div>
          <div className="rounded-[var(--ff-radius-sm)] border border-[var(--ff-color-border)] bg-[var(--ff-color-surface)] px-3 py-2.5">
            <Typography variant="caption" muted className="block">
              Image Format
            </Typography>
            <Typography variant="body-sm" className="mt-0.5 font-medium">
              PNG
            </Typography>
          </div>
          <div className="rounded-[var(--ff-radius-sm)] border border-[var(--ff-color-border)] bg-[var(--ff-color-surface)] px-3 py-2.5">
            <Typography variant="caption" muted className="block">
              Number of Images
            </Typography>
            <Typography variant="body-sm" className="mt-0.5 font-medium tabular-nums">
              1 (Single Output)
            </Typography>
          </div>
        </div>

        <Typography variant="caption" muted className="block">
          Your selected provider currently generates square 1024 × 1024 artwork.
        </Typography>

        {selectedProvider?.capabilities.supportsNegativePrompt ? (
          <div className="border-t border-[var(--ff-color-border)] pt-3">
            <Checkbox
              id="gen-include-negative-prompt"
              checked={includeNegativePrompt}
              disabled={isGenerating}
              onChange={(e) => setIncludeNegativePrompt(e.target.checked)}
              label="Include Negative Prompt Exclusions"
              description={
                activePrompt?.negativePrompt.trim()
                  ? `Will include: "${activePrompt.negativePrompt.trim()}"`
                  : 'Active Master Prompt does not define negative exclusions.'
              }
            />
          </div>
        ) : null}
      </section>

      {/* SUBSECTION D — Generation Cost and Safety Notice */}
      <section
        aria-labelledby="subsection-d-heading"
        className="rounded-[var(--ff-radius-md)] border border-[#C8D4F6] bg-[var(--ff-color-info-subtle)] p-4"
        data-testid="generation-safety-notice"
      >
        <div className="flex items-start gap-3">
          <ShieldCheck
            className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ff-color-info)]"
            aria-hidden="true"
          />
          <div className="space-y-1">
            <Typography id="subsection-d-heading" variant="label">
              D. Generation Cost and Safety Notice
            </Typography>
            <p className="text-[13px] leading-relaxed text-[var(--ff-color-foreground)]">
              Generation requests are sent to the selected external provider. The
              original source image is not sent. Only the approved text prompt and
              supported text parameters are transmitted.
            </p>
            <p className="text-[12px] text-[var(--ff-color-muted-foreground)]">
              Verified tier: {freeTierAccessLabel} · Subject to provider quotas (2
              RPM anonymous / 400 RPM authenticated) with no automatic paid
              fallback.
            </p>
          </div>
        </div>
      </section>

      {/* Workflow Error / Status Alerts */}
      {errorBanner ? (
        <Alert
          tone={
            workflowState === 'rate_limited' || workflowState === 'uncertain'
              ? 'warning'
              : 'destructive'
          }
          title={
            workflowState === 'rate_limited'
              ? 'Provider rate limit reached'
              : workflowState === 'uncertain'
                ? 'Generation status uncertain'
                : 'Image generation could not complete'
          }
          description={errorBanner}
          action={
            workflowState === 'rate_limited' && onNavigate ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onNavigate('/settings')}
              >
                Open Settings
              </Button>
            ) : undefined
          }
        />
      ) : null}

      {statusMessage && !errorBanner ? (
        <Alert
          tone={workflowState === 'completed' ? 'success' : 'info'}
          title={
            workflowState === 'completed'
              ? 'Artwork Ready'
              : workflowState === 'cancelled'
                ? 'Generation Cancelled'
                : 'Generation Status'
          }
          description={statusMessage}
        />
      ) : null}

      {persistenceError ? (
        <Alert
          tone="warning"
          title="Generated Artwork Not Saved Locally"
          description={persistenceError}
          action={
            displayResult && !displayResult.isPersisted ? (
              <Button
                type="button"
                variant="primary"
                size="sm"
                leftIcon={<HardDrive className="h-3.5 w-3.5" aria-hidden="true" />}
                onClick={() => void handleRetryPersistLocally()}
                data-testid="retry-save-artwork-btn"
              >
                Retry Saving Locally
              </Button>
            ) : undefined
          }
        />
      ) : null}

      {/* Primary Action Footer */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--ff-color-border)] pt-4">
        <div className="flex items-center gap-2 text-[12px] text-[var(--ff-color-muted-foreground)]">
          <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            {!promptApproved
              ? 'Approve your Final Master Prompt above to unlock artwork generation.'
              : !providerReady
                ? 'Enable anonymous free-tier opt-in or configure server token in Settings.'
                : 'Explicit confirmation required before dispatching any external generation request.'}
          </span>
        </div>

        <Button
          type="button"
          variant="primary"
          size="md"
          leftIcon={<Sparkles className="h-4 w-4" aria-hidden="true" />}
          disabled={!readiness.ready || isWorkspaceBusy || isGenerating}
          loading={workflowState === 'validating'}
          onClick={handleRequestGenerateClick}
          data-testid="generate-artwork-btn"
        >
          Generate Artwork
        </Button>
      </div>

      {/* Generating Indeterminate Progress Indicator */}
      {workflowState === 'generating' ? (
        <div
          role="status"
          aria-live="polite"
          data-testid="generation-progress-panel"
          className="space-y-3 rounded-[var(--ff-radius-md)] border border-[#C8D4F6] bg-[var(--ff-color-info-subtle)] p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Clock
                className="h-4 w-4 text-[var(--ff-color-primary)]"
                aria-hidden="true"
              />
              <Typography variant="label">
                Generating artwork via{' '}
                {selectedProvider?.capabilities.providerName ??
                  'OVHcloud AI Endpoints'}
                ...
              </Typography>
            </div>
            <span
              className="font-mono text-[12px] font-medium text-[var(--ff-color-primary)] tabular-nums"
              data-testid="generation-elapsed-timer"
            >
              Elapsed: {elapsedSeconds}s
            </span>
          </div>

          <div className="h-2 w-full overflow-hidden rounded-[var(--ff-radius-sm)] bg-[#DCE3FA]">
            <div className="h-full w-2/5 animate-pulse rounded-[var(--ff-radius-sm)] bg-[var(--ff-color-primary)]" />
          </div>

          <Typography variant="caption" muted className="block">
            Transmitting approved text prompt only ({outputSpec.width} ×{' '}
            {outputSpec.height} SDXL). Do not reload while the provider processes your request.
          </Typography>
        </div>
      ) : null}

      {/* GENERATED ARTWORK RESULT PANEL (strictly separate from Original Source Image) */}
      {displayResult ? (
        <section
          aria-labelledby="generated-artwork-heading"
          data-testid="generated-artwork-result-panel"
          className="space-y-4 rounded-[var(--ff-radius-md)] border border-[var(--ff-color-border)] bg-[var(--ff-color-surface-elevated)] p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ff-color-border)] pb-3">
            <div className="flex flex-wrap items-center gap-2">
              <ImageIcon
                className="h-4 w-4 text-[var(--ff-color-primary)]"
                aria-hidden="true"
              />
              <Typography id="generated-artwork-heading" variant="h3">
                Generated Artwork
              </Typography>
              <Badge tone="primary">Text-to-Image Output</Badge>
              {displayResult.isPersisted ? (
                <Badge tone="success" data-testid="artwork-persistence-badge">
                  Persisted Locally
                </Badge>
              ) : (
                <Badge tone="warning" data-testid="artwork-persistence-badge">
                  Unsaved Temporary Preview
                </Badge>
              )}
            </div>

            <Typography variant="caption" muted>
              Distinct from Original Source Image · Source Blob unchanged
            </Typography>
          </div>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,360px)_1fr]">
            <div className="overflow-hidden rounded-[var(--ff-radius-md)] border border-[var(--ff-color-border)] bg-[var(--ff-color-surface)] p-2">
              <img
                src={displayResult.previewUrl}
                alt={`Generated artwork from approved prompt revision for study ${projectId}`}
                data-testid="generated-artwork-image"
                className="aspect-square w-full rounded-[var(--ff-radius-sm)] object-contain bg-[#F6F7F9]"
              />
            </div>

            <div className="flex flex-col justify-between space-y-4">
              <dl className="divide-y divide-[var(--ff-color-border)] rounded-[var(--ff-radius-md)] border border-[var(--ff-color-border)] bg-[var(--ff-color-surface)] px-4 text-[13px]">
                <div className="flex items-center justify-between gap-4 py-2.5">
                  <dt className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-[var(--ff-color-muted-foreground)]">
                    Provider
                  </dt>
                  <dd className="text-right font-medium text-[var(--ff-color-foreground)]">
                    {displayResult.providerName}
                  </dd>
                </div>

                <div className="flex items-center justify-between gap-4 py-2.5">
                  <dt className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-[var(--ff-color-muted-foreground)]">
                    Model
                  </dt>
                  <dd className="text-right font-mono text-[12px] text-[var(--ff-color-foreground)]">
                    {displayResult.artwork.providerModelId}
                  </dd>
                </div>

                <div className="flex items-center justify-between gap-4 py-2.5">
                  <dt className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-[var(--ff-color-muted-foreground)]">
                    Output Resolution
                  </dt>
                  <dd className="text-right font-medium tabular-nums text-[var(--ff-color-foreground)]">
                    {displayResult.artwork.width} × {displayResult.artwork.height} px
                  </dd>
                </div>

                <div className="flex items-center justify-between gap-4 py-2.5">
                  <dt className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-[var(--ff-color-muted-foreground)]">
                    Format & Size
                  </dt>
                  <dd className="text-right font-medium tabular-nums text-[var(--ff-color-foreground)]">
                    {formatSourceFormatLabel(displayResult.artwork.mimeType)} ·{' '}
                    {formatFileSize(displayResult.blob.size)}
                  </dd>
                </div>

                <div className="flex items-center justify-between gap-4 py-2.5">
                  <dt className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-[var(--ff-color-muted-foreground)]">
                    Timestamp
                  </dt>
                  <dd className="text-right tabular-nums text-[var(--ff-color-foreground)]">
                    {new Date(displayResult.artwork.createdAt).toLocaleString()}
                  </dd>
                </div>

                <div className="flex items-center justify-between gap-4 py-2.5">
                  <dt className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-[var(--ff-color-muted-foreground)]">
                    Status
                  </dt>
                  <dd className="inline-flex items-center gap-1.5 whitespace-nowrap font-medium text-[var(--ff-color-success)]">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>
                      {displayResult.isPersisted
                        ? 'Completed & Persisted'
                        : 'Completed (Unsaved)'}
                    </span>
                  </dd>
                </div>

                <div className="flex items-center justify-between gap-4 py-2.5">
                  <dt className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-[var(--ff-color-muted-foreground)]">
                    Generation ID
                  </dt>
                  <dd
                    className="truncate text-right font-mono text-[12px] text-[var(--ff-color-foreground)]"
                    data-testid="generated-artwork-job-id"
                    title={displayResult.job.id}
                  >
                    {displayResult.job.id}
                  </dd>
                </div>
              </dl>

              {!displayResult.isPersisted ? (
                <div className="flex items-center justify-between gap-3 rounded-[var(--ff-radius-md)] border border-[#EAD7B6] bg-[var(--ff-color-warning-subtle)] px-4 py-3">
                  <div className="flex items-center gap-2 text-[12px] text-[var(--ff-color-foreground)]">
                    <AlertTriangle
                      className="h-4 w-4 shrink-0 text-[var(--ff-color-warning)]"
                      aria-hidden="true"
                    />
                    <span>
                      Preview is held in temporary memory only until local save succeeds.
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={() => void handleRetryPersistLocally()}
                  >
                    Retry Saving Locally
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        </section>
      ) : latestJob && latestJob.status === 'failed' && workflowState === 'idle' ? (
        <SurfacePanel tone="elevated" padding="sm">
          <Typography variant="caption" muted className="block">
            Previous generation attempt ({latestJob.id}) recorded status: Failed —{' '}
            {latestJob.errorMessage ?? 'Unknown provider error.'}
          </Typography>
        </SurfacePanel>
      ) : null}

      {/* EXPLICIT CONFIRMATION MODAL ("Confirming" state) */}
      <Modal
        open={workflowState === 'confirming'}
        onClose={handleCancelConfirmation}
        title="Generate Artwork?"
        description="You are about to send your approved text prompt to OVHcloud AI Endpoints using Stable Diffusion XL. This request may consume provider resources."
        size="md"
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={handleCancelConfirmation}
              disabled={inFlightRef.current}
              data-testid="confirm-modal-cancel-btn"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              leftIcon={<Sparkles className="h-4 w-4" aria-hidden="true" />}
              onClick={() => void handleConfirmGenerate()}
              disabled={inFlightRef.current}
              data-testid="confirm-modal-submit-btn"
            >
              Confirm & Generate
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-[13px]" data-testid="generate-confirmation-modal">
          <dl className="grid gap-2.5 rounded-[var(--ff-radius-md)] border border-[var(--ff-color-border)] bg-[var(--ff-color-surface-elevated)] p-3.5">
            <div className="flex items-center justify-between gap-4">
              <dt className="shrink-0 whitespace-nowrap text-[var(--ff-color-muted-foreground)]">
                Provider
              </dt>
              <dd className="text-right font-medium text-[var(--ff-color-foreground)]">
                {selectedProvider?.capabilities.providerName ??
                  'OVHcloud AI Endpoints'}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="shrink-0 whitespace-nowrap text-[var(--ff-color-muted-foreground)]">
                Model
              </dt>
              <dd className="text-right font-mono text-[12px] text-[var(--ff-color-foreground)]">
                {selectedProvider?.capabilities.modelId ??
                  'stable-diffusion-xl-base-v10'}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="shrink-0 whitespace-nowrap text-[var(--ff-color-muted-foreground)]">
                Number of images
              </dt>
              <dd className="text-right font-medium tabular-nums text-[var(--ff-color-foreground)]">
                1
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="shrink-0 whitespace-nowrap text-[var(--ff-color-muted-foreground)]">
                Output resolution
              </dt>
              <dd className="text-right font-medium tabular-nums text-[var(--ff-color-foreground)]">
                {outputSpec.width} × {outputSpec.height}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="shrink-0 whitespace-nowrap text-[var(--ff-color-muted-foreground)]">
                Free-tier status
              </dt>
              <dd className="text-right font-medium text-[var(--ff-color-foreground)]">
                {freeTierAccessLabel}
              </dd>
            </div>
          </dl>

          <Typography variant="caption" muted className="block">
            Original source image and binary upload payloads are excluded from this request.
          </Typography>
        </div>
      </Modal>
    </SurfacePanel>
  );
}

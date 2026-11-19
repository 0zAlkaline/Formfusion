import { HardDrive, RefreshCw, ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useStudioServices } from '../../app/providers/AppProviders.tsx';
import type { ImageGenerationProvidersController } from '../../hooks/useImageGenerationProviders.ts';
import {
  validateRegenerationEligibility,
  type PersistedGenerationRecordBundle,
} from '../../services/image-generation/generationHistoryService.ts';
import {
  executeTextToImageGeneration,
  getFreeTierAccessLabel,
} from '../../services/image-generation/imageGenerationClient.ts';
import type { PersistedGenerationState } from '../../services/project-storage/browserProjectStorage.ts';
import type { EntityId } from '../../types/common.ts';
import type { GeneratedArtwork, GenerationJob } from '../../types/domain.ts';
import {
  Alert,
  Button,
  Checkbox,
  Modal,
  Typography,
} from '../ui/index.ts';

export interface RegenerateArtworkModalProps {
  readonly open: boolean;
  readonly projectId: EntityId;
  readonly sourceEntry: PersistedGenerationRecordBundle | null;
  readonly providerController: ImageGenerationProvidersController;
  readonly isGlobalGenerationInFlight: boolean;
  readonly onGlobalGenerationInFlightChange: (inFlight: boolean) => void;
  readonly onClose: () => void;
  readonly onRegenerationPersisted: (state: PersistedGenerationState) => void;
  readonly onNavigate?: (path: string) => void;
}

interface UnsavedRegeneratedArtwork {
  readonly job: GenerationJob;
  readonly artwork: GeneratedArtwork;
  readonly imageBlob: Blob;
}

export function RegenerateArtworkModal({
  open,
  projectId,
  sourceEntry,
  providerController,
  isGlobalGenerationInFlight,
  onGlobalGenerationInFlightChange,
  onClose,
  onRegenerationPersisted,
  onNavigate,
}: RegenerateArtworkModalProps) {
  const { generationStorage } = useStudioServices();
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [unsavedResult, setUnsavedResult] =
    useState<UnsavedRegeneratedArtwork | null>(null);
  const inFlightRef = useRef(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (open) {
      setErrorMessage(null);
      setUnsavedResult(null);
    }
  }, [open, sourceEntry?.job.id]);

  if (!open || !sourceEntry) {
    return null;
  }

  const eligibilityRes = validateRegenerationEligibility({
    projectId,
    sourceEntry,
    registeredProviders: providerController.providers,
    allowAnonymousFreeTier: providerController.allowAnonymousFreeTier,
  });

  const recordedProviderId = sourceEntry.job.providerConfigRef.providerId;
  const recordedModelId = sourceEntry.job.providerConfigRef.modelId;
  const exactProvider = providerController.providers.find(
    (item) =>
      item.capabilities.providerId === recordedProviderId &&
      item.capabilities.modelId === recordedModelId,
  );
  const needsAnonymousOptIn = Boolean(
    exactProvider &&
      !exactProvider.status.tokenConfigured &&
      !exactProvider.status.anonymousFreeTierEnabled &&
      exactProvider.capabilities.supportsAnonymousFreeTier &&
      !providerController.allowAnonymousFreeTier,
  );

  const handleClose = () => {
    if (inFlightRef.current || submitting) {
      return;
    }
    onClose();
  };

  const handleRetryLocalSave = async () => {
    if (!unsavedResult || inFlightRef.current) {
      return;
    }
    setSubmitting(true);
    setErrorMessage(null);
    const saveRes = await generationStorage.saveGeneratedArtworkResult({
      job: unsavedResult.job,
      artwork: unsavedResult.artwork,
      imageBlob: unsavedResult.imageBlob,
    });
    if (!isMountedRef.current) {
      return;
    }
    setSubmitting(false);
    if (!saveRes.ok) {
      setErrorMessage(
        `Local IndexedDB save still failed: ${saveRes.error.message}. Click Retry Saving Locally without regenerating.`,
      );
      return;
    }
    setUnsavedResult(null);
    onRegenerationPersisted(saveRes.data);
    onClose();
  };

  const handleConfirmRegenerate = async () => {
    if (
      inFlightRef.current ||
      isGlobalGenerationInFlight ||
      !eligibilityRes.ok
    ) {
      return;
    }

    inFlightRef.current = true;
    setSubmitting(true);
    setErrorMessage(null);
    onGlobalGenerationInFlightChange(true);

    try {
      const { promptDocument, providerSummary, includeNegativePrompt } =
        eligibilityRes.data;

      const outcome = await executeTextToImageGeneration({
        projectId,
        promptDocument,
        providerSummary,
        includeNegativePrompt,
        allowAnonymousFreeTier: providerController.allowAnonymousFreeTier,
        lineage: {
          generationKind: 'regeneration',
          parentGenerationId: sourceEntry.job.id,
          parentPromptId: promptDocument.id,
          variationLabel: 'Regenerated',
        },
      });

      if (!isMountedRef.current) {
        return;
      }

      if (
        outcome.outcomeState === 'completed' &&
        outcome.job &&
        outcome.artwork &&
        outcome.imageBlob
      ) {
        const saveRes = await generationStorage.saveGeneratedArtworkResult({
          job: outcome.job,
          artwork: outcome.artwork,
          imageBlob: outcome.imageBlob,
        });

        if (!isMountedRef.current) {
          return;
        }

        if (!saveRes.ok) {
          setUnsavedResult({
            job: outcome.job,
            artwork: outcome.artwork,
            imageBlob: outcome.imageBlob,
          });
          setErrorMessage(
            `Regenerated artwork was received, but local storage failed: ${saveRes.error.message}. Retry saving locally without making another API request.`,
          );
          return;
        }

        onRegenerationPersisted(saveRes.data);
        onClose();
        return;
      }

      if (outcome.job) {
        const historySave = await generationStorage.saveGenerationHistoryEntry(
          outcome.job,
        );
        if (historySave.ok && isMountedRef.current) {
          onRegenerationPersisted(historySave.data);
        }
      }

      if (!isMountedRef.current) {
        return;
      }

      setErrorMessage(
        outcome.errorMessage ?? 'Regeneration request did not complete.',
      );
    } finally {
      inFlightRef.current = false;
      if (isMountedRef.current) {
        setSubmitting(false);
      }
      onGlobalGenerationInFlightChange(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Regenerate Artwork?"
      description="Create a fresh generation from the exact persisted prompt snapshot. Because sampling is non-deterministic, this produces a new artwork while leaving the original artwork untouched."
      size="md"
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            disabled={submitting}
            data-testid="regenerate-modal-cancel-btn"
          >
            Cancel
          </Button>
          {unsavedResult ? (
            <Button
              type="button"
              variant="primary"
              leftIcon={<HardDrive className="h-4 w-4" aria-hidden="true" />}
              loading={submitting}
              onClick={() => void handleRetryLocalSave()}
              data-testid="regenerate-retry-save-btn"
            >
              Retry Saving Locally
            </Button>
          ) : (
            <Button
              type="button"
              variant="primary"
              leftIcon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
              loading={submitting}
              disabled={!eligibilityRes.ok || isGlobalGenerationInFlight}
              onClick={() => void handleConfirmRegenerate()}
              data-testid="regenerate-modal-confirm-btn"
            >
              Confirm & Regenerate
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4 text-[13px]" data-testid="regenerate-modal-body">
        {!eligibilityRes.ok ? (
          <Alert
            tone="warning"
            title="Regeneration Blocked by Provider/Prompt Check"
            description={eligibilityRes.error.message}
            action={
              onNavigate ? (
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

        {needsAnonymousOptIn ? (
          <div className="rounded-[var(--ff-radius-sm)] border border-[#EAD7B6] bg-[var(--ff-color-warning-subtle)] p-3">
            <Checkbox
              id="regen-allow-anonymous-free-tier"
              checked={providerController.allowAnonymousFreeTier}
              disabled={submitting}
              onChange={(e) =>
                providerController.setAllowAnonymousFreeTier(e.target.checked)
              }
              label="Allow explicit anonymous free-tier request mode"
              description="Required to dispatch regeneration on OVHcloud without a server token (strict 2 RPM limit)."
            />
          </div>
        ) : null}

        {errorMessage ? (
          <Alert
            tone="destructive"
            title="Regeneration Alert"
            description={errorMessage}
          />
        ) : null}

        <dl className="grid gap-2 rounded-[var(--ff-radius-md)] border border-[var(--ff-color-border)] bg-[var(--ff-color-surface-elevated)] p-3.5 text-[12px]">
          <div className="flex items-center justify-between gap-4">
            <dt className="shrink-0 text-[var(--ff-color-muted-foreground)]">
              Parent Generation ID
            </dt>
            <dd className="truncate text-right font-mono text-[var(--ff-color-foreground)]">
              {sourceEntry.job.id}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="shrink-0 text-[var(--ff-color-muted-foreground)]">
              Provider & Model
            </dt>
            <dd className="text-right font-mono text-[var(--ff-color-foreground)]">
              {recordedProviderId} · {recordedModelId}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="shrink-0 text-[var(--ff-color-muted-foreground)]">
              Output Resolution
            </dt>
            <dd className="text-right font-medium tabular-nums text-[var(--ff-color-foreground)]">
              {eligibilityRes.ok
                ? `${eligibilityRes.data.resolution.width} × ${eligibilityRes.data.resolution.height} px`
                : `${sourceEntry.job.resolution.width} × ${sourceEntry.job.resolution.height} px`}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="shrink-0 text-[var(--ff-color-muted-foreground)]">
              Prompt Revision
            </dt>
            <dd className="text-right font-mono tabular-nums text-[var(--ff-color-foreground)]">
              {sourceEntry.promptDocument
                ? `v${sourceEntry.promptDocument.revisionNumber ?? sourceEntry.promptDocument.revision} (${sourceEntry.promptDocument.id})`
                : 'Missing'}
            </dd>
          </div>
          {exactProvider ? (
            <div className="flex items-center justify-between gap-4">
              <dt className="shrink-0 text-[var(--ff-color-muted-foreground)]">
                Access Tier
              </dt>
              <dd className="text-right font-medium text-[var(--ff-color-foreground)]">
                {getFreeTierAccessLabel(
                  exactProvider.status,
                  providerController.allowAnonymousFreeTier,
                )}
              </dd>
            </div>
          ) : null}
        </dl>

        {sourceEntry.promptDocument ? (
          <div className="rounded-[var(--ff-radius-md)] border border-[var(--ff-color-border)] bg-[var(--ff-color-surface)] p-3">
            <Typography variant="caption" muted className="mb-1 block">
              Reused Approved Prompt Snapshot (Read-Only)
            </Typography>
            <p className="max-h-32 overflow-y-auto whitespace-pre-wrap text-[12px] leading-relaxed text-[var(--ff-color-foreground)]">
              {sourceEntry.promptDocument.finalPrompt}
            </p>
          </div>
        ) : null}

        <div className="flex items-start gap-2.5 rounded-[var(--ff-radius-md)] border border-[#C8D4F6] bg-[var(--ff-color-info-subtle)] p-3 text-[12px] text-[var(--ff-color-foreground)]">
          <ShieldCheck
            className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ff-color-info)]"
            aria-hidden="true"
          />
          <span>
            This request consumes external provider quota, sends only the approved text prompt (never the source image), and appends a new independent artwork without modifying the source record.
          </span>
        </div>
      </div>
    </Modal>
  );
}

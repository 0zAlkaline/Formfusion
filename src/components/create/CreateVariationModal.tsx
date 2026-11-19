import {
  CheckCircle2,
  GitBranch,
  HardDrive,
  Lock,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useStudioServices } from '../../app/providers/AppProviders.tsx';
import type { ImageGenerationProvidersController } from '../../hooks/useImageGenerationProviders.ts';
import {
  VARIATION_INSTRUCTION_EXAMPLES,
  composeVariationPromptText,
  createApprovedVariationPromptDocument,
  type PersistedGenerationRecordBundle,
} from '../../services/image-generation/generationHistoryService.ts';
import {
  executeTextToImageGeneration,
  getFreeTierAccessLabel,
  isProviderReadyWithSelection,
  resolveSupportedOutputSpec,
} from '../../services/image-generation/imageGenerationClient.ts';
import type { PersistedGenerationState } from '../../services/project-storage/browserProjectStorage.ts';
import type { EntityId } from '../../types/common.ts';
import type {
  GeneratedArtwork,
  GenerationJob,
  PromptDocument,
} from '../../types/domain.ts';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Modal,
  Textarea,
  Typography,
} from '../ui/index.ts';

type VariationStep = 'compose' | 'review_approve' | 'confirm';

export interface CreateVariationModalProps {
  readonly open: boolean;
  readonly projectId: EntityId;
  readonly parentEntry: PersistedGenerationRecordBundle | null;
  readonly parentPreviewUrl: string | null;
  readonly nextRevisionNumber: number;
  readonly providerController: ImageGenerationProvidersController;
  readonly isGlobalGenerationInFlight: boolean;
  readonly onGlobalGenerationInFlightChange: (inFlight: boolean) => void;
  readonly onClose: () => void;
  readonly onVariationPersisted: (state: PersistedGenerationState) => void;
  readonly onNavigate?: (path: string) => void;
}

interface ApprovedVariationDraft {
  readonly variationId: EntityId;
  readonly variationPromptDocument: PromptDocument;
}

interface UnsavedVariationResult {
  readonly job: GenerationJob;
  readonly artwork: GeneratedArtwork;
  readonly imageBlob: Blob;
  readonly variationPromptDocument: PromptDocument;
}

export function CreateVariationModal({
  open,
  projectId,
  parentEntry,
  parentPreviewUrl,
  nextRevisionNumber,
  providerController,
  isGlobalGenerationInFlight,
  onGlobalGenerationInFlightChange,
  onClose,
  onVariationPersisted,
  onNavigate,
}: CreateVariationModalProps) {
  const { generationStorage } = useStudioServices();

  const [step, setStep] = useState<VariationStep>('compose');
  const [variationInstructions, setVariationInstructions] = useState('');
  const [negativePromptAdjustment, setNegativePromptAdjustment] = useState('');
  const [composedBaselinePrompt, setComposedBaselinePrompt] = useState('');
  const [editedVariationPrompt, setEditedVariationPrompt] = useState('');
  const [approvedDraft, setApprovedDraft] =
    useState<ApprovedVariationDraft | null>(null);
  const [includeNegativePrompt, setIncludeNegativePrompt] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [unsavedResult, setUnsavedResult] =
    useState<UnsavedVariationResult | null>(null);

  const inFlightRef = useRef(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (open && parentEntry) {
      setStep('compose');
      setVariationInstructions('');
      setNegativePromptAdjustment(
        parentEntry.promptDocument?.negativePrompt ?? '',
      );
      setComposedBaselinePrompt('');
      setEditedVariationPrompt('');
      setApprovedDraft(null);
      setIncludeNegativePrompt(true);
      setErrorMessage(null);
      setUnsavedResult(null);
    }
  }, [open, parentEntry]);

  if (!open || !parentEntry) {
    return null;
  }

  const parentPrompt = parentEntry.promptDocument;
  const activeProvider = providerController.selectedProvider;
  const supportsNegativePrompt = Boolean(
    activeProvider?.capabilities.supportsNegativePrompt,
  );
  const maxPromptLength = activeProvider?.capabilities.maxPromptLength ?? 2000;
  const outputSpec = activeProvider
    ? resolveSupportedOutputSpec(activeProvider.capabilities)
    : {
        width: parentEntry.job.resolution.width,
        height: parentEntry.job.resolution.height,
        aspectRatio: parentEntry.job.aspectRatio,
        label: `${parentEntry.job.resolution.width} × ${parentEntry.job.resolution.height}`,
      };

  const providerReady = isProviderReadyWithSelection(
    activeProvider,
    providerController.allowAnonymousFreeTier,
  );
  const needsAnonymousOptIn = Boolean(
    activeProvider &&
      !activeProvider.status.tokenConfigured &&
      !activeProvider.status.anonymousFreeTierEnabled &&
      activeProvider.capabilities.supportsAnonymousFreeTier &&
      !providerController.allowAnonymousFreeTier,
  );

  const handleClose = () => {
    if (inFlightRef.current || submitting) {
      return;
    }
    onClose();
  };

  const handleComposeVariationPrompt = () => {
    if (!parentPrompt) {
      setErrorMessage(
        'Parent approved prompt snapshot is unavailable. Cannot compose variation.',
      );
      return;
    }

    setErrorMessage(null);
    const composed = composeVariationPromptText({
      parentPromptDocument: parentPrompt,
      variationInstructions,
      negativePromptAdjustment,
      supportsNegativePrompt,
      maxPromptLength,
    });

    if (!composed.ok) {
      setErrorMessage(composed.error.message);
      return;
    }

    setComposedBaselinePrompt(composed.data.composedPrompt);
    setEditedVariationPrompt(composed.data.composedPrompt);
    setNegativePromptAdjustment(composed.data.negativePrompt);
    setApprovedDraft(null);
    setStep('review_approve');
  };

  const handleApproveVariationPrompt = () => {
    if (!parentPrompt || !activeProvider) {
      setErrorMessage(
        'Active generation provider or parent prompt snapshot is unavailable.',
      );
      return;
    }

    setErrorMessage(null);
    const approved = createApprovedVariationPromptDocument({
      projectId,
      parentPromptDocument: parentPrompt,
      parentGenerationId: parentEntry.job.id,
      variationInstructions,
      composedBaselinePrompt:
        composedBaselinePrompt || editedVariationPrompt,
      finalVariationPrompt: editedVariationPrompt,
      negativePrompt: supportsNegativePrompt ? negativePromptAdjustment : '',
      providerId: activeProvider.capabilities.providerId,
      modelId: activeProvider.capabilities.modelId,
      nextRevisionNumber,
      maxPromptLength,
    });

    if (!approved.ok) {
      setErrorMessage(approved.error.message);
      return;
    }

    setApprovedDraft(approved.data);
    setStep('confirm');
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
      variationPromptDocument: unsavedResult.variationPromptDocument,
    });
    if (!isMountedRef.current) {
      return;
    }
    setSubmitting(false);
    if (!saveRes.ok) {
      setErrorMessage(
        `Local IndexedDB save still failed: ${saveRes.error.message}. Click Retry Saving Locally without re-generating.`,
      );
      return;
    }
    setUnsavedResult(null);
    onVariationPersisted(saveRes.data);
    onClose();
  };

  const handleConfirmGenerateVariation = async () => {
    if (
      inFlightRef.current ||
      isGlobalGenerationInFlight ||
      !approvedDraft ||
      !activeProvider ||
      !providerReady
    ) {
      return;
    }

    inFlightRef.current = true;
    setSubmitting(true);
    setErrorMessage(null);
    onGlobalGenerationInFlightChange(true);

    try {
      const outcome = await executeTextToImageGeneration({
        projectId,
        promptDocument: approvedDraft.variationPromptDocument,
        providerSummary: activeProvider,
        includeNegativePrompt:
          supportsNegativePrompt && includeNegativePrompt,
        allowAnonymousFreeTier: providerController.allowAnonymousFreeTier,
        lineage: {
          generationKind: 'variation',
          parentGenerationId: parentEntry.job.id,
          parentPromptId: approvedDraft.variationPromptDocument.parentPromptId,
          variationId: approvedDraft.variationId,
          variationPromptId: approvedDraft.variationPromptDocument.id,
          variationInstructions:
            approvedDraft.variationPromptDocument.variationInstructions,
          variationLabel: 'Variation',
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
          variationPromptDocument: approvedDraft.variationPromptDocument,
        });

        if (!isMountedRef.current) {
          return;
        }

        if (!saveRes.ok) {
          setUnsavedResult({
            job: outcome.job,
            artwork: outcome.artwork,
            imageBlob: outcome.imageBlob,
            variationPromptDocument: approvedDraft.variationPromptDocument,
          });
          setErrorMessage(
            `Variation artwork was generated, but local IndexedDB save failed: ${saveRes.error.message}. Retry saving locally without making another API request.`,
          );
          return;
        }

        onVariationPersisted(saveRes.data);
        onClose();
        return;
      }

      if (outcome.job) {
        const historySave = await generationStorage.saveGenerationHistoryEntry(
          outcome.job,
          approvedDraft.variationPromptDocument,
        );
        if (historySave.ok && isMountedRef.current) {
          onVariationPersisted(historySave.data);
        }
      }

      if (!isMountedRef.current) {
        return;
      }

      setErrorMessage(
        outcome.errorMessage ?? 'Variation generation did not complete.',
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
      title="Create Controlled Artwork Variation"
      description="Compose a separate child variation prompt from your approved parent direction. The original Master Prompt and parent artwork remain completely unchanged."
      size="lg"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {step === 'review_approve' ? (
              <Button
                type="button"
                variant="outline"
                disabled={submitting}
                onClick={() => {
                  setApprovedDraft(null);
                  setErrorMessage(null);
                  setStep('compose');
                }}
              >
                Edit Instructions
              </Button>
            ) : null}
            {step === 'confirm' && !unsavedResult ? (
              <Button
                type="button"
                variant="outline"
                disabled={submitting}
                onClick={() => {
                  setApprovedDraft(null);
                  setErrorMessage(null);
                  setStep('review_approve');
                }}
              >
                Unlock & Revise Variation Prompt
              </Button>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={handleClose}
              data-testid="variation-modal-cancel-btn"
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
                data-testid="variation-retry-save-btn"
              >
                Retry Saving Locally
              </Button>
            ) : step === 'compose' ? (
              <Button
                type="button"
                variant="primary"
                leftIcon={<Sparkles className="h-4 w-4" aria-hidden="true" />}
                disabled={!parentPrompt}
                onClick={handleComposeVariationPrompt}
                data-testid="compose-variation-prompt-btn"
              >
                Compose Variation Prompt
              </Button>
            ) : step === 'review_approve' ? (
              <Button
                type="button"
                variant="primary"
                leftIcon={<CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
                disabled={!activeProvider}
                onClick={handleApproveVariationPrompt}
                data-testid="approve-variation-prompt-btn"
              >
                Approve Variation Prompt
              </Button>
            ) : (
              <Button
                type="button"
                variant="primary"
                leftIcon={<GitBranch className="h-4 w-4" aria-hidden="true" />}
                loading={submitting}
                disabled={
                  !providerReady || !approvedDraft || isGlobalGenerationInFlight
                }
                onClick={() => void handleConfirmGenerateVariation()}
                data-testid="confirm-generate-variation-btn"
              >
                Confirm & Generate Variation
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div
        className="max-h-[70vh] space-y-4 overflow-y-auto pr-1 text-[13px]"
        data-testid="create-variation-modal-body"
      >
        {/* Step Indicator */}
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--ff-color-border)] pb-3">
          <Badge tone={step === 'compose' ? 'primary' : 'success'}>
            1. Variation Direction
          </Badge>
          <span className="text-[var(--ff-color-muted-foreground)]">→</span>
          <Badge
            tone={
              step === 'review_approve'
                ? 'primary'
                : step === 'confirm'
                  ? 'success'
                  : 'neutral'
            }
          >
            2. Review & Approve Prompt
          </Badge>
          <span className="text-[var(--ff-color-muted-foreground)]">→</span>
          <Badge tone={step === 'confirm' ? 'primary' : 'neutral'}>
            3. Confirm & Generate
          </Badge>
        </div>

        {/* Parent Context Row */}
        <div className="grid gap-4 rounded-[var(--ff-radius-md)] border border-[var(--ff-color-border)] bg-[var(--ff-color-surface-elevated)] p-3.5 sm:grid-cols-[120px_1fr]">
          <div className="flex flex-col items-center justify-center rounded-[var(--ff-radius-sm)] border border-[var(--ff-color-border)] bg-[#F6F7F9] p-1.5">
            {parentPreviewUrl ? (
              <img
                src={parentPreviewUrl}
                alt={`Local parent reference artwork ${parentEntry.job.id}`}
                className="h-24 w-24 object-contain"
              />
            ) : (
              <div className="flex h-24 w-24 items-center justify-center text-center text-[11px] text-[var(--ff-color-muted-foreground)]">
                No preview
              </div>
            )}
            <span className="mt-1 text-center text-[10px] leading-tight text-[var(--ff-color-muted-foreground)]">
              Local reference only
            </span>
          </div>

          <div className="space-y-2 text-[12px]">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span>
                <span className="font-medium text-[var(--ff-color-foreground)]">
                  Parent Generation ID:
                </span>{' '}
                <span className="font-mono text-[11px]">
                  {parentEntry.job.id}
                </span>
              </span>
              <span>
                <span className="font-medium text-[var(--ff-color-foreground)]">
                  Active Provider:
                </span>{' '}
                <span className="font-mono text-[11px]">
                  {activeProvider
                    ? `${activeProvider.capabilities.providerId} · ${activeProvider.capabilities.modelId}`
                    : `${parentEntry.job.providerConfigRef.providerId} · ${parentEntry.job.providerConfigRef.modelId}`}
                </span>
              </span>
              <span className="tabular-nums">
                <span className="font-medium text-[var(--ff-color-foreground)]">
                  Output:
                </span>{' '}
                {outputSpec.width} × {outputSpec.height} px
              </span>
            </div>

            {parentPrompt ? (
              <div className="rounded-[var(--ff-radius-sm)] border border-[var(--ff-color-border)] bg-[var(--ff-color-surface)] p-2.5">
                <Typography variant="caption" muted className="mb-0.5 block">
                  Original Approved Prompt (Locked & Preserved)
                </Typography>
                <p className="max-h-24 overflow-y-auto whitespace-pre-wrap text-[12px] leading-relaxed text-[var(--ff-color-muted-foreground)]">
                  {parentPrompt.finalPrompt}
                </p>
              </div>
            ) : (
              <Alert
                tone="destructive"
                title="Parent prompt missing"
                description="Cannot compose a variation without an approved parent prompt snapshot."
              />
            )}
          </div>
        </div>

        {errorMessage ? (
          <Alert
            tone="destructive"
            title="Variation Action Required"
            description={errorMessage}
          />
        ) : null}

        {/* STEP 1: Variation Instruction Entry */}
        {step === 'compose' ? (
          <div className="space-y-4">
            <Textarea
              id="variation-instructions-input"
              label="Variation Instructions"
              rows={3}
              value={variationInstructions}
              onChange={(e) => setVariationInstructions(e.target.value)}
              placeholder="Describe how to evolve this artwork (e.g., warmer golden lighting, minimal composition, bolder contrast)..."
              hint="Text-only variation directives. Optional example directions below populate this field on click and are never applied automatically."
              data-testid="variation-instructions-textarea"
            />

            <div className="space-y-1.5">
              <Typography variant="caption" muted className="block">
                Optional Direction Suggestions (click to populate)
              </Typography>
              <div className="flex flex-wrap gap-2">
                {VARIATION_INSTRUCTION_EXAMPLES.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() =>
                      setVariationInstructions((prev) =>
                        prev.trim().length === 0
                          ? suggestion
                          : prev.includes(suggestion)
                            ? prev
                            : `${prev.trim().replace(/[.,;]+$/, '')}; ${suggestion.charAt(0).toLowerCase()}${suggestion.slice(1)}`,
                      )
                    }
                    className="rounded-[var(--ff-radius-sm)] border border-[var(--ff-color-border)] bg-[var(--ff-color-surface)] px-2.5 py-1 text-[12px] font-medium text-[var(--ff-color-foreground)] transition-colors hover:border-[var(--ff-color-primary)] hover:bg-[var(--ff-color-info-subtle)] cursor-pointer"
                    data-testid="variation-suggestion-btn"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>

            {supportsNegativePrompt ? (
              <Textarea
                id="variation-negative-prompt-input"
                label="Optional Negative Prompt Adjustment"
                rows={2}
                value={negativePromptAdjustment}
                onChange={(e) => setNegativePromptAdjustment(e.target.value)}
                placeholder="Optional exclusions supported by active provider..."
                hint="Rendered only when the selected provider supports negative prompts."
                data-testid="variation-negative-prompt-textarea"
              />
            ) : null}
          </div>
        ) : null}

        {/* STEP 2: Review & Edit Composed Variation Prompt + Approve */}
        {step === 'review_approve' ? (
          <div className="space-y-4">
            <Textarea
              id="variation-review-instructions"
              label="Variation Instructions"
              rows={2}
              value={variationInstructions}
              onChange={(e) => {
                setVariationInstructions(e.target.value);
                setApprovedDraft(null);
              }}
              data-testid="variation-review-instructions-textarea"
            />

            <Textarea
              id="variation-composed-prompt-editor"
              label="Composed Child Variation Prompt (Editable)"
              rows={5}
              value={editedVariationPrompt}
              onChange={(e) => {
                setEditedVariationPrompt(e.target.value);
                setApprovedDraft(null);
              }}
              hint={`${editedVariationPrompt.trim().length} / ${maxPromptLength} characters · Editing this child prompt will not alter your Final Master Prompt.`}
              data-testid="variation-composed-prompt-textarea"
            />

            {supportsNegativePrompt ? (
              <Checkbox
                id="variation-include-negative-prompt"
                checked={includeNegativePrompt}
                onChange={(e) => setIncludeNegativePrompt(e.target.checked)}
                label="Include negative prompt exclusions in variation request"
                description={
                  negativePromptAdjustment.trim()
                    ? negativePromptAdjustment.trim()
                    : 'No negative prompt exclusions specified.'
                }
              />
            ) : null}

            <div className="flex items-start gap-2 rounded-[var(--ff-radius-md)] border border-[var(--ff-color-border)] bg-[var(--ff-color-surface-elevated)] p-3 text-[12px] text-[var(--ff-color-muted-foreground)]">
              <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                Click <strong>Approve Variation Prompt</strong> to lock this child prompt snapshot separately before confirming external generation.
              </span>
            </div>
          </div>
        ) : null}

        {/* STEP 3: Explicit Confirmation & Dispatch */}
        {step === 'confirm' && approvedDraft ? (
          <div className="space-y-4" data-testid="variation-confirm-panel">
            <div className="rounded-[var(--ff-radius-md)] border border-[#C3DFCF] bg-[var(--ff-color-success-subtle)] p-3.5 text-[12px] text-[var(--ff-color-foreground)]">
              <div className="flex items-center gap-2 font-medium text-[var(--ff-color-success)]">
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                <span>
                  Child Variation Prompt Approved & Isolated (
                  {approvedDraft.variationPromptDocument.id})
                </span>
              </div>
              <p className="mt-1 text-[var(--ff-color-muted-foreground)]">
                Ready for strict text-only execution. Parent Master Prompt remains unchanged.
              </p>
            </div>

            {needsAnonymousOptIn ? (
              <div className="rounded-[var(--ff-radius-sm)] border border-[#EAD7B6] bg-[var(--ff-color-warning-subtle)] p-3">
                <Checkbox
                  id="variation-allow-anonymous-free-tier"
                  checked={providerController.allowAnonymousFreeTier}
                  disabled={submitting}
                  onChange={(e) =>
                    providerController.setAllowAnonymousFreeTier(
                      e.target.checked,
                    )
                  }
                  label="Allow explicit anonymous free-tier request mode"
                  description="No server token detected. Anonymous OVHcloud requests enforce a 2 requests/minute limit."
                />
              </div>
            ) : null}

            {!providerReady && !needsAnonymousOptIn ? (
              <Alert
                tone="warning"
                title="Provider Not Ready"
                description={
                  activeProvider?.status.statusMessage ??
                  'Verify provider health or credentials in Settings before generating a variation.'
                }
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

            <div className="rounded-[var(--ff-radius-md)] border border-[var(--ff-color-border)] bg-[var(--ff-color-surface)] p-3">
              <Typography variant="caption" muted className="mb-1 block">
                Approved Variation Prompt Preview
              </Typography>
              <p className="max-h-28 overflow-y-auto whitespace-pre-wrap text-[12px] leading-relaxed text-[var(--ff-color-foreground)]">
                {approvedDraft.variationPromptDocument.finalPrompt}
              </p>
            </div>

            <div className="flex items-start gap-2.5 rounded-[var(--ff-radius-md)] border border-[#C8D4F6] bg-[var(--ff-color-info-subtle)] p-3 text-[12px] text-[var(--ff-color-foreground)]">
              <ShieldCheck
                className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ff-color-info)]"
                aria-hidden="true"
              />
              <div>
                <p>
                  Only this approved variation text prompt will be sent to{' '}
                  <strong>
                    {activeProvider?.capabilities.providerName ?? 'the provider'}
                  </strong>
                  . Neither the original source image nor the parent artwork thumbnail is ever transmitted.
                </p>
                {activeProvider ? (
                  <p className="mt-1 text-[11px] text-[var(--ff-color-muted-foreground)]">
                    Tier:{' '}
                    {getFreeTierAccessLabel(
                      activeProvider.status,
                      providerController.allowAnonymousFreeTier,
                    )}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Lock,
  Loader2,
  RotateCcw,
  ScanSearch,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import type { VisionAnalysisRequestPhase } from '../../services/object-identification/visionAnalysisClient.ts';
import type { ObjectAnalysis } from '../../types/domain.ts';
import type { RawVisionAnalysisResult } from '../../types/providers.ts';
import {
  Alert,
  Badge,
  type BadgeTone,
  Button,
  SurfacePanel,
  Typography,
} from '../ui/index.ts';

export interface ObjectAnalysisPreviewPanelProps {
  readonly phase: VisionAnalysisRequestPhase;
  readonly result: RawVisionAnalysisResult | null;
  readonly persistedAnalysis: ObjectAnalysis | null;
  readonly errorMessage: string | null;
  readonly persistenceError: string | null;
  readonly canAnalyze: boolean;
  readonly onAnalyze: () => void;
  readonly onCancel: () => void;
  readonly onRetryPersistAnalysis?: () => void;
}

const PHASE_BADGE: Readonly<
  Record<
    VisionAnalysisRequestPhase,
    { readonly label: string; readonly tone: BadgeTone }
  >
> = {
  idle: { label: 'Ready', tone: 'neutral' },
  validating: { label: 'Validating Local Asset', tone: 'info' },
  uploading: { label: 'Transmitting Image', tone: 'info' },
  analyzing: { label: 'Gemini Analyzing', tone: 'primary' },
  success: { label: 'Analysis Saved', tone: 'success' },
  error: { label: 'Analysis Failed', tone: 'destructive' },
  cancelled: { label: 'Cancelled', tone: 'warning' },
};

const PHASE_STEP_DETAIL: Readonly<
  Record<
    Extract<VisionAnalysisRequestPhase, 'validating' | 'uploading' | 'analyzing'>,
    { readonly title: string; readonly description: string }
  >
> = {
  validating: {
    title: 'Validating source asset & reading IndexedDB Blob...',
    description:
      'Verifying active study association, Phase 02.1 validation status, and original binary integrity.',
  },
  uploading: {
    title: 'Transmitting original binary image to FormFusion server...',
    description:
      'Sending unmodified source binary via multipart/form-data without screenshots or viewer transforms.',
  },
  analyzing: {
    title: 'Analyzing visual subject with server-side Gemini Vision...',
    description:
      'Observing subject identity, materials, colors, details, and composition without inventing hidden attributes.',
  },
};

function renderValueOrNone(value: string): string {
  return value.trim().length > 0 ? value : 'Not explicitly observed';
}

function renderListOrNone(items: readonly string[]): string {
  return items.length > 0 ? items.join(', ') : 'None observed';
}

export function ObjectAnalysisPreviewPanel({
  phase,
  result,
  persistedAnalysis,
  errorMessage,
  persistenceError,
  canAnalyze,
  onAnalyze,
  onCancel,
  onRetryPersistAnalysis,
}: ObjectAnalysisPreviewPanelProps) {
  const [showRawText, setShowRawText] = useState(false);

  const effectivePhase: VisionAnalysisRequestPhase =
    phase === 'idle' && persistedAnalysis ? 'success' : phase;
  const badge = PHASE_BADGE[effectivePhase];
  const isInFlight =
    phase === 'validating' || phase === 'uploading' || phase === 'analyzing';

  const displayRawText = persistedAnalysis?.rawText ?? result?.rawText ?? '';
  const displayProviderId =
    persistedAnalysis?.providerId ?? result?.providerId ?? 'gemini';
  const displayModel =
    persistedAnalysis?.modelVersion ??
    persistedAnalysis?.modelId ??
    result?.modelVersion ??
    result?.modelId ??
    '';
  const displayAnalyzedAt =
    persistedAnalysis?.analyzedAt ?? result?.analyzedAt ?? '';
  const displayResponseId =
    persistedAnalysis?.responseId ?? result?.responseId;

  return (
    <SurfacePanel
      tone="default"
      padding="md"
      className="space-y-4"
      data-testid="vision-analysis-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--ff-color-border)] pb-3">
        <div className="flex items-center gap-2.5">
          <ScanSearch
            className="h-4 w-4 text-[var(--ff-color-primary)]"
            aria-hidden="true"
          />
          <div>
            <Typography variant="h3">Object Identification (Vision)</Typography>
            <Typography variant="caption" muted>
              Stage 02 · Immutable visual observation via server-side Gemini Vision
            </Typography>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <Badge tone={badge.tone}>{badge.label}</Badge>
          {isInFlight ? (
            <Button
              variant="outline"
              size="sm"
              leftIcon={<XCircle className="h-3.5 w-3.5" aria-hidden="true" />}
              onClick={onCancel}
            >
              Cancel Request
            </Button>
          ) : (
            <Button
              variant={effectivePhase === 'error' ? 'outline' : 'primary'}
              size="sm"
              leftIcon={
                effectivePhase === 'success' || effectivePhase === 'error' ? (
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <ScanSearch className="h-3.5 w-3.5" aria-hidden="true" />
                )
              }
              disabled={!canAnalyze}
              onClick={onAnalyze}
            >
              {effectivePhase === 'error'
                ? 'Retry Analysis'
                : effectivePhase === 'success'
                  ? 'Re-analyze Object'
                  : 'Analyze Object'}
            </Button>
          )}
        </div>
      </div>

      {isInFlight ? (
        <div
          role="status"
          aria-live="polite"
          data-testid="vision-analysis-progress"
          data-phase={phase}
          className="flex items-start gap-3 rounded-[var(--ff-radius-md)] border border-[#C8D4F6] bg-[var(--ff-color-info-subtle)] px-4 py-3.5"
        >
          <Loader2
            className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-[var(--ff-color-primary)]"
            aria-hidden="true"
          />
          <div className="space-y-1">
            <p className="text-[14px] font-medium text-[var(--ff-color-foreground)]">
              {PHASE_STEP_DETAIL[phase].title}
            </p>
            <p className="text-[13px] text-[var(--ff-color-muted-foreground)]">
              {PHASE_STEP_DETAIL[phase].description}
            </p>
            <div className="flex flex-wrap gap-3 pt-1 text-[12px] text-[var(--ff-color-muted-foreground)]">
              <span
                className={
                  phase === 'validating'
                    ? 'font-medium text-[var(--ff-color-primary)]'
                    : 'text-[var(--ff-color-success)]'
                }
              >
                1. Validate Blob
              </span>
              <span>·</span>
              <span
                className={
                  phase === 'uploading'
                    ? 'font-medium text-[var(--ff-color-primary)]'
                    : phase === 'analyzing'
                      ? 'text-[var(--ff-color-success)]'
                      : ''
                }
              >
                2. Binary Upload
              </span>
              <span>·</span>
              <span
                className={
                  phase === 'analyzing'
                    ? 'font-medium text-[var(--ff-color-primary)]'
                    : ''
                }
              >
                3. Gemini Vision Processing
              </span>
            </div>
          </div>
        </div>
      ) : null}

      {phase === 'error' && errorMessage ? (
        <Alert
          tone="destructive"
          title="Vision object analysis failed"
          description={errorMessage}
          action={
            <Button
              variant="outline"
              size="sm"
              leftIcon={<RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />}
              disabled={!canAnalyze}
              onClick={onAnalyze}
            >
              Retry
            </Button>
          }
        />
      ) : null}

      {persistenceError ? (
        <Alert
          tone="destructive"
          title="Could not save analysis to IndexedDB"
          description={persistenceError}
          action={
            onRetryPersistAnalysis ? (
              <Button
                variant="outline"
                size="sm"
                leftIcon={<RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />}
                onClick={onRetryPersistAnalysis}
              >
                Retry Save
              </Button>
            ) : undefined
          }
        />
      ) : null}

      {phase === 'cancelled' ? (
        <Alert
          tone="warning"
          title="Analysis request cancelled"
          description="The original source image remains preserved in local IndexedDB storage. Run Analyze Object whenever ready."
        />
      ) : null}

      {effectivePhase === 'idle' && !persistedAnalysis ? (
        <Typography variant="body-sm" muted>
          Click <strong className="font-medium text-[var(--ff-color-foreground)]">Analyze Object</strong> to transmit the original persisted source Blob from IndexedDB to the FormFusion server and initialize the editable object description.
        </Typography>
      ) : null}

      {(persistedAnalysis || (result && phase === 'success')) ? (
        <div className="space-y-3" data-testid="vision-analysis-result">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[13px] font-medium text-[var(--ff-color-success)]">
              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Original AI Analysis (Read-Only Reference)</span>
            </div>

            <div className="flex items-center gap-2">
              <Badge tone="neutral" className="gap-1">
                <Lock className="h-3 w-3" aria-hidden="true" />
                Immutable Baseline
              </Badge>
              {displayRawText ? (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-expanded={showRawText}
                  rightIcon={
                    showRawText ? (
                      <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                    )
                  }
                  onClick={() => setShowRawText((prev) => !prev)}
                >
                  {showRawText ? 'Hide Raw Response' : 'View Raw Response'}
                </Button>
              ) : null}
            </div>
          </div>

          {persistedAnalysis ? (
            <div
              data-testid="original-ai-analysis-summary"
              className="rounded-[var(--ff-radius-md)] border border-[var(--ff-color-border)] bg-[var(--ff-color-surface-elevated)] p-4 space-y-3"
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--ff-color-muted-foreground)]">
                    Observed Object Name
                  </p>
                  <p
                    data-testid="original-analysis-object-name"
                    className="mt-0.5 text-[14px] font-medium text-[var(--ff-color-foreground)]"
                  >
                    {persistedAnalysis.objectName}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--ff-color-muted-foreground)]">
                    Observed Category
                  </p>
                  <p className="mt-0.5 text-[14px] text-[var(--ff-color-foreground)]">
                    {persistedAnalysis.objectCategory}
                  </p>
                </div>
              </div>

              <div>
                <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--ff-color-muted-foreground)]">
                  Original AI Primary Description
                </p>
                <p
                  data-testid="original-analysis-primary-description"
                  className="mt-0.5 text-[13px] leading-5 text-[var(--ff-color-foreground)]"
                >
                  {persistedAnalysis.primaryDescription}
                </p>
              </div>

              <div className="grid gap-3 border-t border-[var(--ff-color-border)] pt-3 text-[13px] sm:grid-cols-2">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--ff-color-muted-foreground)]">
                    Materials
                  </p>
                  <p className="mt-0.5 text-[var(--ff-color-foreground)]">
                    {renderListOrNone(persistedAnalysis.materials)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--ff-color-muted-foreground)]">
                    Dominant Colors
                  </p>
                  <p className="mt-0.5 text-[var(--ff-color-foreground)]">
                    {renderListOrNone(persistedAnalysis.dominantColors)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--ff-color-muted-foreground)]">
                    Viewing Angle & Composition
                  </p>
                  <p className="mt-0.5 text-[13px] text-[var(--ff-color-foreground)]">
                    {renderValueOrNone(
                      (() => {
                        const angle = persistedAnalysis.viewingAngle.trim();
                        const comp = persistedAnalysis.composition.trim();
                        if (!angle) return comp;
                        if (!comp) return angle;
                        if (
                          angle.toLowerCase() === comp.toLowerCase() ||
                          comp.toLowerCase().includes(angle.toLowerCase())
                        ) {
                          return comp;
                        }
                        if (angle.toLowerCase().includes(comp.toLowerCase())) {
                          return angle;
                        }
                        return `${angle} · ${comp}`;
                      })(),
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--ff-color-muted-foreground)]">
                    Uncertain / Ambiguous Attributes
                  </p>
                  <p className="mt-0.5 text-[var(--ff-color-foreground)]">
                    {renderListOrNone(persistedAnalysis.uncertainAttributes)}
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          {showRawText && displayRawText ? (
            <div className="rounded-[var(--ff-radius-md)] border border-[var(--ff-color-border)] bg-[var(--ff-color-surface)] p-4">
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-[var(--ff-color-muted-foreground)]">
                Raw Gemini Vision Response
              </p>
              <p className="whitespace-pre-wrap text-[13px] leading-6 text-[var(--ff-color-foreground)]">
                {displayRawText}
              </p>
            </div>
          ) : null}

          <dl className="grid gap-x-6 gap-y-2 border-t border-[var(--ff-color-border)] pt-3 text-[12px] sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-[var(--ff-color-muted-foreground)]">Provider</dt>
              <dd className="mt-0.5 font-medium text-[var(--ff-color-foreground)]">
                {displayProviderId}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--ff-color-muted-foreground)]">Model</dt>
              <dd className="mt-0.5 font-mono text-[var(--ff-color-foreground)]">
                {displayModel}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--ff-color-muted-foreground)]">Analyzed At</dt>
              <dd className="mt-0.5 tabular-nums text-[var(--ff-color-foreground)]">
                {displayAnalyzedAt ? new Date(displayAnalyzedAt).toLocaleString() : '—'}
              </dd>
            </div>
            {result?.usageMetadata?.totalTokenCount !== undefined ? (
              <div>
                <dt className="text-[var(--ff-color-muted-foreground)]">
                  Token Usage
                </dt>
                <dd className="mt-0.5 tabular-nums text-[var(--ff-color-foreground)]">
                  {result.usageMetadata.totalTokenCount} total
                  {result.usageMetadata.promptTokenCount !== undefined &&
                  result.usageMetadata.candidatesTokenCount !== undefined
                    ? ` (${result.usageMetadata.promptTokenCount} in / ${result.usageMetadata.candidatesTokenCount} out)`
                    : ''}
                </dd>
              </div>
            ) : displayResponseId ? (
              <div>
                <dt className="text-[var(--ff-color-muted-foreground)]">
                  Response ID
                </dt>
                <dd
                  title={displayResponseId}
                  className="mt-0.5 truncate font-mono text-[var(--ff-color-foreground)]"
                >
                  {displayResponseId}
                </dd>
              </div>
            ) : null}
          </dl>

          <div className="flex items-start gap-2 text-[12px] text-[var(--ff-color-muted-foreground)]">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              Original AI analysis is preserved immutably in IndexedDB as a read-only baseline. Refine and save your working object description below before continuing to style selection.
            </span>
          </div>
        </div>
      ) : null}
    </SurfacePanel>
  );
}

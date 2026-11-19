import {
  Activity,
  Image as ImageIcon,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { STUDIO_ROUTES } from '../app/routes/routeConfig.ts';
import { DesignSystemShowcase } from '../components/design-system/DesignSystemShowcase.tsx';
import { useGlobalOverlay } from '../components/layout/GlobalOverlayRoot.tsx';
import {
  Alert,
  Badge,
  type BadgeTone,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Modal,
  PageHeader,
  Typography,
} from '../components/ui/index.ts';
import {
  fetchImageGenerationCapabilities,
  fetchImageGenerationProviderStatus,
  runImageGenerationSmokeTest,
  testImageGenerationProviderConnection,
} from '../services/image-generation/providerStatusClient.ts';
import {
  fetchGeminiProviderStatus,
  verifyGeminiProviderConnectivity,
} from '../services/object-identification/providerStatusClient.ts';
import type {
  GeminiInitializationStatus,
  GeminiProviderPublicStatus,
  ImageGenerationProviderCapabilities,
  ImageGenerationProviderPublicStatus,
  ImageGenerationProviderStatusValue,
  ImageGenerationSmokeTestResult,
} from '../types/providers.ts';

interface SettingsPageProps {
  readonly onNavigate: (path: string) => void;
}

const STATUS_BADGE_MAP: Record<
  GeminiInitializationStatus,
  { readonly label: string; readonly tone: BadgeTone }
> = {
  NOT_CONFIGURED: { label: 'Not Configured', tone: 'warning' },
  CONFIGURED: { label: 'Configured', tone: 'info' },
  INITIALIZED: { label: 'Initialized', tone: 'info' },
  CONNECTIVITY_VERIFIED: { label: 'Connectivity Verified', tone: 'success' },
  ERROR: { label: 'Error', tone: 'destructive' },
};

const IMAGE_GEN_STATUS_BADGE_MAP: Record<
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

const SMOKE_TEST_FIXED_PROMPT =
  'Minimalist ceramic vase on warm studio backdrop';

function formatByteSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function SettingsPage({ onNavigate }: SettingsPageProps) {
  const route = STUDIO_ROUTES[5];
  const { openModal } = useGlobalOverlay();

  // Gemini Vision state
  const [providerStatus, setProviderStatus] =
    useState<GeminiProviderPublicStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [verifying, setVerifying] = useState(false);

  // Image Generation Provider state
  const [imageGenStatus, setImageGenStatus] =
    useState<ImageGenerationProviderPublicStatus | null>(null);
  const [imageGenCapabilities, setImageGenCapabilities] =
    useState<ImageGenerationProviderCapabilities | null>(null);
  const [imageGenError, setImageGenError] = useState<string | null>(null);
  const [loadingImageGenStatus, setLoadingImageGenStatus] = useState(true);
  const [testingImageGenHealth, setTestingImageGenHealth] = useState(false);
  const [allowAnonymousFreeTier, setAllowAnonymousFreeTier] = useState(false);

  // Smoke Test state (strictly explicit confirmation — never auto-run)
  const [smokeDialogOpen, setSmokeDialogOpen] = useState(false);
  const [runningSmokeTest, setRunningSmokeTest] = useState(false);
  const [smokeTestResult, setSmokeTestResult] =
    useState<ImageGenerationSmokeTestResult | null>(null);
  const [smokeTestError, setSmokeTestError] = useState<string | null>(null);

  const loadProviderStatus = useCallback(async () => {
    setLoadingStatus(true);
    setStatusError(null);
    const result = await fetchGeminiProviderStatus();
    if (result.data) {
      setProviderStatus(result.data);
    }
    if (!result.ok) {
      setStatusError(
        result.error?.message ?? 'Unable to load Gemini provider status.',
      );
    }
    setLoadingStatus(false);
  }, []);

  const loadImageGenerationStatus = useCallback(async () => {
    setLoadingImageGenStatus(true);
    setImageGenError(null);
    const [statusResult, capabilitiesResult] = await Promise.all([
      fetchImageGenerationProviderStatus(),
      fetchImageGenerationCapabilities(),
    ]);
    if (statusResult.data) {
      setImageGenStatus(statusResult.data);
    }
    if (capabilitiesResult.data) {
      setImageGenCapabilities(capabilitiesResult.data);
    }
    if (!statusResult.ok) {
      setImageGenError(
        statusResult.error?.message ??
          'Unable to load image generation provider status.',
      );
    } else if (!capabilitiesResult.ok) {
      setImageGenError(
        capabilitiesResult.error?.message ??
          'Unable to load image generation provider capabilities.',
      );
    }
    setLoadingImageGenStatus(false);
  }, []);

  useEffect(() => {
    void loadProviderStatus();
    void loadImageGenerationStatus();
  }, [loadProviderStatus, loadImageGenerationStatus]);

  const handleVerifyConnectivity = async () => {
    setVerifying(true);
    setStatusError(null);
    const result = await verifyGeminiProviderConnectivity();
    if (result.data) {
      setProviderStatus(result.data);
    }
    if (!result.ok) {
      setStatusError(
        result.error?.message ?? 'Gemini connectivity verification failed.',
      );
    }
    setVerifying(false);
  };

  const handleTestImageGenConnection = async () => {
    setTestingImageGenHealth(true);
    setImageGenError(null);
    const result = await testImageGenerationProviderConnection({
      ...(allowAnonymousFreeTier ? { allowAnonymousFreeTier: true } : {}),
    });
    if (result.data?.status) {
      setImageGenStatus(result.data.status);
    }
    if (result.data?.capabilities) {
      setImageGenCapabilities(result.data.capabilities);
    }
    if (!result.ok) {
      setImageGenError(
        result.error?.message ??
          'Image generation provider connection check failed.',
      );
    }
    setTestingImageGenHealth(false);
  };

  const handleConfirmSmokeTest = async () => {
    setRunningSmokeTest(true);
    setSmokeTestError(null);
    const effectiveAnonymous =
      allowAnonymousFreeTier || Boolean(imageGenStatus?.anonymousFreeTierEnabled);
    const result = await runImageGenerationSmokeTest({
      confirmed: true,
      prompt: SMOKE_TEST_FIXED_PROMPT,
      ...(effectiveAnonymous ? { allowAnonymousFreeTier: true } : {}),
    });
    if (result.status) {
      setImageGenStatus(result.status);
    }
    if (result.ok && result.data) {
      setSmokeTestResult(result.data);
      setSmokeDialogOpen(false);
    } else {
      setSmokeTestError(
        result.error?.message ?? 'Image generation smoke test failed.',
      );
      setSmokeDialogOpen(false);
    }
    setRunningSmokeTest(false);
  };

  const handleOpenDesignSystemModal = () => {
    openModal({
      title: 'Design System & Token Inspection',
      description: 'Phase 01.2 visual tokens rendered inside GlobalOverlayRoot.',
      size: 'lg',
      confirmLabel: 'Done',
      content: (
        <div className="max-h-[65vh] overflow-y-auto pr-2">
          <DesignSystemShowcase />
        </div>
      ),
    });
  };

  const statusMeta = providerStatus
    ? STATUS_BADGE_MAP[providerStatus.initializationStatus]
    : null;

  const effectiveImageGenStatus: ImageGenerationProviderStatusValue | null =
    testingImageGenHealth
      ? 'verifying'
      : imageGenStatus?.connectionStatus ?? null;

  const imageGenStatusMeta = effectiveImageGenStatus
    ? IMAGE_GEN_STATUS_BADGE_MAP[effectiveImageGenStatus]
    : null;

  const canAttemptImageGenCall = Boolean(
    imageGenStatus &&
      (imageGenStatus.tokenConfigured ||
        imageGenStatus.anonymousFreeTierEnabled ||
        allowAnonymousFreeTier),
  );

  const configurationLabel = !imageGenStatus
    ? 'Checking...'
    : imageGenStatus.tokenConfigured
      ? 'Configured (Server Token)'
      : imageGenStatus.anonymousFreeTierEnabled || allowAnonymousFreeTier
        ? 'Configured (Anonymous Free Tier)'
        : imageGenStatus.configurationStatus === 'invalid'
          ? 'Invalid Configuration'
          : 'Not Configured';

  return (
    <div className="space-y-8">
      <PageHeader
        title={route.title}
        description={route.description}
        actions={
          <Button
            variant="outline"
            leftIcon={<SlidersHorizontal className="h-4 w-4" aria-hidden="true" />}
            onClick={handleOpenDesignSystemModal}
          >
            Inspect Design System
          </Button>
        }
      />

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-2">
                <Activity
                  className="h-4 w-4 text-[var(--ff-color-primary)]"
                  aria-hidden="true"
                />
                <CardTitle>Vision Provider Foundation</CardTitle>
              </div>
              {statusMeta ? (
                <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
              ) : (
                <Badge tone="neutral">
                  {loadingStatus ? 'Checking...' : 'Unavailable'}
                </Badge>
              )}
            </div>
            <CardDescription>
              Server-side Google Gemini SDK configuration for Phase 02.3 Object Identification.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border border-[var(--ff-color-border)] bg-[var(--ff-color-surface-elevated)] p-3 text-[13px]">
              <dt className="text-[var(--ff-color-muted-foreground)]">Provider</dt>
              <dd className="font-medium text-[var(--ff-color-foreground)]">
                {providerStatus?.providerName ?? 'Google Gemini'}
              </dd>
              <dt className="text-[var(--ff-color-muted-foreground)]">Configured Model</dt>
              <dd className="font-mono text-[12px] text-[var(--ff-color-foreground)]">
                {providerStatus?.modelId ?? 'Not resolved'}
              </dd>
              <dt className="text-[var(--ff-color-muted-foreground)]">Server Credential</dt>
              <dd className="font-medium text-[var(--ff-color-foreground)]">
                {providerStatus
                  ? providerStatus.credentialConfigured
                    ? 'Configured on server'
                    : 'Not configured'
                  : 'Checking...'}
              </dd>
              <dt className="text-[var(--ff-color-muted-foreground)]">Last Check</dt>
              <dd className="text-[var(--ff-color-foreground)]">
                {providerStatus?.lastCheckedAt
                  ? new Date(providerStatus.lastCheckedAt).toLocaleString()
                  : 'Not checked'}
              </dd>
            </dl>

            {providerStatus ? (
              <Typography variant="body-sm" muted>
                {providerStatus.statusMessage}
              </Typography>
            ) : null}

            {providerStatus?.setupInstruction ? (
              <Alert
                tone="info"
                title="Server Secret Configuration"
                description={providerStatus.setupInstruction}
              />
            ) : null}

            {statusError ? (
              <Alert
                tone="warning"
                title={
                  providerStatus?.errorCategory
                    ? `Provider Status (${providerStatus.errorCategory})`
                    : 'Provider Diagnostic Notice'
                }
                description={statusError}
              />
            ) : null}

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Button
                variant="outline"
                size="sm"
                leftIcon={<RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
                onClick={() => void loadProviderStatus()}
                disabled={loadingStatus || verifying}
              >
                Refresh Status
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => void handleVerifyConnectivity()}
                disabled={
                  verifying ||
                  loadingStatus ||
                  !providerStatus?.credentialConfigured ||
                  !providerStatus?.modelConfigured
                }
              >
                {verifying ? 'Verifying...' : 'Verify Connectivity'}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="image-generation-provider-card">
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-2">
                <ImageIcon
                  className="h-4 w-4 text-[var(--ff-color-primary)]"
                  aria-hidden="true"
                />
                <CardTitle>Image Generation Provider</CardTitle>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {imageGenStatus?.isFreeTierModel ? (
                  <Badge tone="info">Free Tier</Badge>
                ) : null}
                {imageGenStatusMeta ? (
                  <Badge tone={imageGenStatusMeta.tone}>
                    {imageGenStatusMeta.label}
                  </Badge>
                ) : (
                  <Badge tone="neutral">
                    {loadingImageGenStatus ? 'Checking...' : 'Unavailable'}
                  </Badge>
                )}
              </div>
            </div>
            <CardDescription>
              Provider-independent Text-to-Image adapter foundation (Phase 05.1). Source images are never transmitted to generation providers.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border border-[var(--ff-color-border)] bg-[var(--ff-color-surface-elevated)] p-3 text-[13px]">
              <dt className="text-[var(--ff-color-muted-foreground)]">Active Provider</dt>
              <dd className="font-medium text-[var(--ff-color-foreground)]">
                {imageGenStatus
                  ? `${imageGenStatus.providerName} (${imageGenStatus.providerId})`
                  : 'OVHcloud AI Endpoints'}
              </dd>
              <dt className="text-[var(--ff-color-muted-foreground)]">Model</dt>
              <dd className="font-mono text-[12px] text-[var(--ff-color-foreground)]">
                {imageGenStatus?.modelId ?? 'stable-diffusion-xl-base-v10'}
              </dd>
              <dt className="text-[var(--ff-color-muted-foreground)]">Configuration Status</dt>
              <dd className="font-medium text-[var(--ff-color-foreground)]">
                {configurationLabel}
              </dd>
              <dt className="text-[var(--ff-color-muted-foreground)]">Capabilities</dt>
              <dd className="text-[var(--ff-color-foreground)]">
                {imageGenCapabilities
                  ? `${imageGenCapabilities.supportedOutputSizes[0]?.width ?? 1024} × ${imageGenCapabilities.supportedOutputSizes[0]?.height ?? 1024} • ${imageGenCapabilities.task} • Img2Img disabled`
                  : 'Loading...'}
              </dd>
              <dt className="text-[var(--ff-color-muted-foreground)]">Test Requests</dt>
              <dd className="font-medium text-[var(--ff-color-foreground)]">
                {imageGenStatus?.testRequestCount ?? 0}
              </dd>
              <dt className="text-[var(--ff-color-muted-foreground)]">Last Health Check</dt>
              <dd className="text-[var(--ff-color-foreground)]">
                {imageGenStatus?.lastHealthCheckAt
                  ? new Date(imageGenStatus.lastHealthCheckAt).toLocaleString()
                  : 'Not checked'}
              </dd>
            </dl>

            {imageGenStatus ? (
              <Typography variant="body-sm" muted>
                {imageGenStatus.statusMessage}
              </Typography>
            ) : null}

            {imageGenStatus &&
            !imageGenStatus.tokenConfigured &&
            !imageGenStatus.anonymousFreeTierEnabled ? (
              <label className="flex cursor-pointer items-start gap-2.5 border border-[var(--ff-color-border)] bg-[var(--ff-color-surface-elevated)] p-3 text-[13px]">
                <input
                  type="checkbox"
                  checked={allowAnonymousFreeTier}
                  onChange={(event) =>
                    setAllowAnonymousFreeTier(event.target.checked)
                  }
                  className="mt-0.5 h-4 w-4 cursor-pointer accent-[var(--ff-color-primary)]"
                />
                <span className="text-[var(--ff-color-foreground)]">
                  Allow explicit anonymous free-tier testing (limited to{' '}
                  {imageGenCapabilities?.anonymousRateLimitRpm ?? 2} requests/min per IP, no automatic paid fallback).
                </span>
              </label>
            ) : null}

            {imageGenStatus?.setupInstruction ? (
              <Alert
                tone="info"
                title="OVHcloud Access Configuration"
                description={imageGenStatus.setupInstruction}
              />
            ) : null}

            {imageGenError ? (
              <Alert
                tone="warning"
                title={
                  imageGenStatus?.errorCategory
                    ? `Provider Notice (${imageGenStatus.errorCategory})`
                    : 'Provider Connection Notice'
                }
                description={imageGenError}
              />
            ) : null}

            {smokeTestError ? (
              <Alert
                tone="destructive"
                title="Smoke Test Error"
                description={smokeTestError}
              />
            ) : null}

            {smokeTestResult ? (
              <div className="space-y-3 border border-[var(--ff-color-border)] bg-[var(--ff-color-surface-elevated)] p-3">
                <div className="flex items-center justify-between gap-2">
                  <Typography variant="label">
                    Temporary Smoke Test Preview (Not Saved)
                  </Typography>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSmokeTestResult(null)}
                  >
                    Clear Preview
                  </Button>
                </div>
                <div className="flex flex-wrap items-start gap-4">
                  <img
                    src={smokeTestResult.previewImageDataUrl}
                    alt="Temporary SDXL smoke test output"
                    className="h-24 w-24 border border-[var(--ff-color-border)] object-cover"
                  />
                  <dl className="grid flex-1 grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
                    <dt className="text-[var(--ff-color-muted-foreground)]">Format</dt>
                    <dd className="font-mono text-[var(--ff-color-foreground)]">
                      {smokeTestResult.mimeType}
                    </dd>
                    <dt className="text-[var(--ff-color-muted-foreground)]">Dimensions</dt>
                    <dd className="text-[var(--ff-color-foreground)]">
                      {smokeTestResult.width} × {smokeTestResult.height} px
                    </dd>
                    <dt className="text-[var(--ff-color-muted-foreground)]">Duration</dt>
                    <dd className="text-[var(--ff-color-foreground)]">
                      {smokeTestResult.durationMs} ms
                    </dd>
                    <dt className="text-[var(--ff-color-muted-foreground)]">Payload Size</dt>
                    <dd className="text-[var(--ff-color-foreground)]">
                      {formatByteSize(smokeTestResult.byteSize)}
                    </dd>
                  </dl>
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              <Button
                variant="outline"
                size="sm"
                leftIcon={<RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
                onClick={() => void loadImageGenerationStatus()}
                disabled={
                  loadingImageGenStatus ||
                  testingImageGenHealth ||
                  runningSmokeTest
                }
              >
                Refresh Status
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => void handleTestImageGenConnection()}
                disabled={
                  loadingImageGenStatus ||
                  testingImageGenHealth ||
                  runningSmokeTest
                }
              >
                {testingImageGenHealth
                  ? 'Verifying...'
                  : 'Test Provider Connection'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                leftIcon={<Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}
                onClick={() => {
                  setSmokeTestError(null);
                  setSmokeDialogOpen(true);
                }}
                disabled={
                  loadingImageGenStatus ||
                  testingImageGenHealth ||
                  runningSmokeTest ||
                  !canAttemptImageGenCall
                }
              >
                {runningSmokeTest ? 'Generating...' : 'Run Smoke Test'}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[var(--ff-color-primary)]" aria-hidden="true" />
              <CardTitle>Credential & Storage Boundary</CardTitle>
            </div>
            <CardDescription>{route.phaseScopeNote}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Typography variant="body-sm">
              Provider credentials remain strictly server-side and are never stored in browser LocalStorage, IndexedDB, or client bundles. Image generation providers receive only approved text prompts and never access source assets or Gemini credentials.
            </Typography>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" size="sm" onClick={handleOpenDesignSystemModal}>
                Open Token & Component Modal
              </Button>
              <Button variant="outline" size="sm" onClick={() => onNavigate('/')}>
                Back to Dashboard
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Modal
        open={smokeDialogOpen}
        onClose={() => {
          if (!runningSmokeTest) {
            setSmokeDialogOpen(false);
          }
        }}
        title="Confirm Free-Tier SDXL Smoke Test"
        description="Send a single text-only test request to verify OVHcloud Stable Diffusion XL image output."
        size="sm"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setSmokeDialogOpen(false)}
              disabled={runningSmokeTest}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => void handleConfirmSmokeTest()}
              loading={runningSmokeTest}
            >
              Confirm & Run Smoke Test
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="border border-[var(--ff-color-border)] bg-[var(--ff-color-surface-elevated)] p-3 text-[13px]">
            <p className="font-medium text-[var(--ff-color-foreground)]">
              Fixed Test Prompt
            </p>
            <p className="mt-1 font-mono text-[12px] text-[var(--ff-color-muted-foreground)]">
              &ldquo;{SMOKE_TEST_FIXED_PROMPT}&rdquo;
            </p>
          </div>
          <Typography variant="body-sm" muted>
            This test targets free-tier{' '}
            <span className="font-mono">stable-diffusion-xl-base-v10</span>{' '}
            (1024 × 1024). It counts against your provider rate limit, transmits zero source images, and displays only a temporary preview without saving to any project or IndexedDB.
          </Typography>
        </div>
      </Modal>
    </div>
  );
}


import assert from 'node:assert/strict';
import test from 'node:test';
import { OvhcloudSdxlProvider } from '../../../server/providers/ovhcloud/ovhcloudSdxlProvider';
import type { PromptDocument } from '../../types/domain';
import type { RegisteredImageGenerationProviderSummary } from '../../types/providers';
import { createEntityId, nowIsoTimestamp } from '../../utils/ids';
import {
  buildTextOnlyExecutePayload,
  decodeDataUrlToValidatedImageBlob,
  executeTextToImageGeneration,
  validateGenerationReadiness,
} from './imageGenerationClient';

function makePrompt(
  overrides: Partial<PromptDocument> = {},
): PromptDocument {
  const now = nowIsoTimestamp();
  return {
    id: createEntityId('prm'),
    projectId: createEntityId('prj'),
    descriptionId: createEntityId('dsc'),
    styleId: null,
    userInstructions: '',
    revision: 1,
    revisionNumber: 1,
    generatedPrompt:
      'Brushed aluminum espresso tamper resting on dark slate workbench, soft diffused studio lighting',
    finalPrompt:
      'Brushed aluminum espresso tamper resting on dark slate workbench, soft diffused studio lighting, crisp architectural composition',
    negativePrompt: 'blurry, low contrast, watermark',
    approvalStatus: 'approved',
    approvedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeProviderSummary(
  statusOverrides: Partial<RegisteredImageGenerationProviderSummary['status']> = {},
): RegisteredImageGenerationProviderSummary {
  const provider = new OvhcloudSdxlProvider({
    getEnv: () => ({
      OVH_AI_ENDPOINTS_ACCESS_TOKEN: 'ovh-test-token-value',
    }),
  });
  const baseStatus = provider.getPublicStatus();
  return {
    isActive: true,
    capabilities: provider.getCapabilities(),
    status: {
      ...baseStatus,
      connectionStatus: 'connected',
      ...statusOverrides,
    },
  };
}

// Minimal valid 1x1 PNG (67 bytes base64)
const TINY_VALID_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

test('validateGenerationReadiness blocks missing, draft, edited, or unsaved prompts', () => {
  const provider = makeProviderSummary();
  const projectId = createEntityId('prj');

  const noPrompt = validateGenerationReadiness({
    projectId,
    promptDocument: null,
    providerSummary: provider,
    allowAnonymousFreeTier: false,
    isGenerating: false,
  });
  assert.equal(noPrompt.ready, false);
  assert.equal(noPrompt.message, 'Approve your Final Master Prompt before generating artwork.');

  for (const status of ['draft', 'edited'] as const) {
    const prompt = makePrompt({ projectId, approvalStatus: status, approvedAt: null });
    const res = validateGenerationReadiness({
      projectId,
      promptDocument: prompt,
      providerSummary: provider,
      allowAnonymousFreeTier: false,
      isGenerating: false,
    });
    assert.equal(res.ready, false);
    assert.equal(res.reasonCode, 'PROMPT_NOT_APPROVED');
    assert.equal(res.message, 'Approve your Final Master Prompt before generating artwork.');
  }

  const unsavedDraft = validateGenerationReadiness({
    projectId,
    promptDocument: makePrompt({ projectId, approvalStatus: 'approved' }),
    providerSummary: provider,
    allowAnonymousFreeTier: false,
    isGenerating: false,
    hasUnsavedPromptDraft: true,
  });
  assert.equal(unsavedDraft.ready, false);
  assert.equal(unsavedDraft.reasonCode, 'PROMPT_NOT_APPROVED');
});

test('validateGenerationReadiness prevents duplicate dispatch while generating and requires opt-in without server token', () => {
  const projectId = createEntityId('prj');
  const prompt = makePrompt({ projectId, approvalStatus: 'approved' });
  const unconfigured = makeProviderSummary({
    enabled: false,
    tokenConfigured: false,
    anonymousFreeTierEnabled: false,
    connectionStatus: 'not_configured',
    configurationStatus: 'not_configured',
    statusMessage: 'Anonymous free-tier opt-in or server token required.',
  });

  const needsOptIn = validateGenerationReadiness({
    projectId,
    promptDocument: prompt,
    providerSummary: unconfigured,
    allowAnonymousFreeTier: false,
    isGenerating: false,
  });
  assert.equal(needsOptIn.ready, false);
  assert.equal(needsOptIn.reasonCode, 'PROVIDER_NOT_CONFIGURED');

  const optedIn = validateGenerationReadiness({
    projectId,
    promptDocument: prompt,
    providerSummary: unconfigured,
    allowAnonymousFreeTier: true,
    isGenerating: false,
  });
  assert.equal(optedIn.ready, true);

  const inFlight = validateGenerationReadiness({
    projectId,
    promptDocument: prompt,
    providerSummary: makeProviderSummary(),
    allowAnonymousFreeTier: false,
    isGenerating: true,
  });
  assert.equal(inFlight.ready, false);
  assert.equal(inFlight.reasonCode, 'IN_FLIGHT');
});

test('buildTextOnlyExecutePayload emits strict 1024x1024 text-only JSON with zero source images or unsupported SDXL knobs', () => {
  const projectId = createEntityId('prj');
  const prompt = makePrompt({ projectId });
  const provider = makeProviderSummary({
    enabled: false,
    tokenConfigured: false,
    anonymousFreeTierEnabled: false,
  });

  const res = buildTextOnlyExecutePayload({
    projectId,
    promptDocument: prompt,
    providerSummary: provider,
    includeNegativePrompt: true,
    allowAnonymousFreeTier: true,
  });

  assert.equal(res.ok, true);
  if (!res.ok) return;

  assert.equal(res.data.projectId, projectId);
  assert.equal(res.data.promptId, prompt.id);
  assert.equal(res.data.providerId, 'ovhcloud');
  assert.equal(res.data.modelId, 'stable-diffusion-xl-base-v10');
  assert.equal(res.data.approvalStatus, 'approved');
  assert.equal(res.data.aspectRatio, '1:1');
  assert.equal(res.data.outputWidth, 1024);
  assert.equal(res.data.outputHeight, 1024);
  assert.equal(res.data.numberOfImages, 1);
  assert.equal(res.data.allowAnonymousFreeTier, true);
  assert.equal(res.data.confirmed, true);
  assert.equal(res.data.negativePrompt, prompt.negativePrompt);

  const rawRecord = res.data as unknown as Record<string, unknown>;
  assert.equal('sourceAssetId' in rawRecord, false);
  assert.equal('sourceImage' in rawRecord, false);
  assert.equal('imageDataUrl' in rawRecord, false);
  assert.equal('seed' in rawRecord, false);
  assert.equal('guidanceScale' in rawRecord, false);
  assert.equal('inferenceSteps' in rawRecord, false);
  assert.equal('cfgScale' in rawRecord, false);
  assert.equal(Object.keys(res.data.providerParameters).length, 0);
});

test('decodeDataUrlToValidatedImageBlob validates PNG binary magic bytes and rejects malformed/spoofed payloads', () => {
  const valid = decodeDataUrlToValidatedImageBlob(
    `data:image/png;base64,${TINY_VALID_PNG_BASE64}`,
  );
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.data.mimeType, 'image/png');
    assert.ok(valid.data.blob instanceof Blob);
    assert.ok(valid.data.byteSize > 20);
  }

  const htmlSpoof = Buffer.from('<html>error</html>', 'utf8').toString('base64');
  const spoofed = decodeDataUrlToValidatedImageBlob(
    `data:image/png;base64,${htmlSpoof}`,
  );
  assert.equal(spoofed.ok, false);

  const svgRejected = decodeDataUrlToValidatedImageBlob(
    `data:image/svg+xml;base64,${htmlSpoof}`,
  );
  assert.equal(svgRejected.ok, false);
});

test('executeTextToImageGeneration maps completed, rate_limited, uncertain timeout (no auto-retry), cancelled, and failed states', async () => {
  const projectId = createEntityId('prj');
  const prompt = makePrompt({ projectId });
  const provider = makeProviderSummary();

  // 1. Completed state
  let callCount = 0;
  const completed = await executeTextToImageGeneration({
    projectId,
    promptDocument: prompt,
    providerSummary: provider,
    includeNegativePrompt: false,
    allowAnonymousFreeTier: false,
    transport: async () => {
      callCount += 1;
      return {
        status: 200,
        body: {
          ok: true,
          data: {
            generationId: createEntityId('job'),
            providerId: 'ovhcloud',
            modelId: 'stable-diffusion-xl-base-v10',
            status: 'succeeded',
            outputFormat: 'png',
            mimeType: 'image/png',
            outputDimensions: { width: 1024, height: 1024 },
            temporaryImageDataUrl: `data:image/png;base64,${TINY_VALID_PNG_BASE64}`,
            createdAt: nowIsoTimestamp(),
            durationMs: 2450,
            usageMetadata: {
              isFreeTier: true,
              accessMode: 'authenticated',
              testRequestCount: 0,
              anonymousRateLimitRpm: 2,
              byteSize: 67,
              omittedParameters: [],
            },
          },
        },
      };
    },
  });
  assert.equal(callCount, 1);
  assert.equal(completed.outcomeState, 'completed');
  assert.equal(completed.job?.status, 'completed');
  assert.equal(completed.artwork?.width, 1024);
  assert.equal(completed.artwork?.height, 1024);
  assert.equal(completed.artwork?.mimeType, 'image/png');
  assert.ok(completed.imageBlob instanceof Blob);

  // 2. Rate limited state (HTTP 429)
  const rateLimited = await executeTextToImageGeneration({
    projectId,
    promptDocument: prompt,
    providerSummary: provider,
    includeNegativePrompt: true,
    allowAnonymousFreeTier: false,
    transport: async () => ({
      status: 429,
      body: {
        ok: false,
        error: {
          code: 'PROVIDER_UNAVAILABLE',
          category: 'RATE_LIMITED',
          message: 'OVHcloud free-tier rate limit exceeded (2 RPM).',
          retryable: true,
          upstreamStatus: 429,
        },
      },
    }),
  });
  assert.equal(rateLimited.outcomeState, 'rate_limited');
  assert.equal(rateLimited.job?.status, 'failed');
  assert.equal(rateLimited.errorCode, 'RATE_LIMITED');

  // 3. Uncertain timeout after dispatch (never silently retried)
  let uncertainTransportCalls = 0;
  const uncertain = await executeTextToImageGeneration({
    projectId,
    promptDocument: prompt,
    providerSummary: provider,
    includeNegativePrompt: true,
    allowAnonymousFreeTier: false,
    transport: async () => {
      uncertainTransportCalls += 1;
      const timeoutErr = new Error('Timed out after 105000ms');
      timeoutErr.name = 'TimeoutError';
      throw timeoutErr;
    },
  });
  assert.equal(uncertainTransportCalls, 1);
  assert.equal(uncertain.outcomeState, 'uncertain');
  assert.equal(uncertain.errorCode, 'UNCERTAIN_TIMEOUT');

  // 4. Pre-dispatch abort -> cancelled with 0 transport calls
  const abortController = new AbortController();
  abortController.abort();
  let abortedCalls = 0;
  const cancelled = await executeTextToImageGeneration({
    projectId,
    promptDocument: prompt,
    providerSummary: provider,
    includeNegativePrompt: true,
    allowAnonymousFreeTier: false,
    abortSignal: abortController.signal,
    transport: async () => {
      abortedCalls += 1;
      return { status: 500, body: { ok: false } };
    },
  });
  assert.equal(abortedCalls, 0);
  assert.equal(cancelled.outcomeState, 'cancelled');

  // 5. Generic server failure -> failed
  const failed = await executeTextToImageGeneration({
    projectId,
    promptDocument: prompt,
    providerSummary: provider,
    includeNegativePrompt: true,
    allowAnonymousFreeTier: false,
    transport: async () => ({
      status: 502,
      body: {
        ok: false,
        error: {
          code: 'PROVIDER_ERROR',
          category: 'UNKNOWN_PROVIDER_ERROR',
          message: 'OVHcloud SDXL endpoint returned upstream 502.',
        },
      },
    }),
  });
  assert.equal(failed.outcomeState, 'failed');
  assert.equal(failed.job?.status, 'failed');
});

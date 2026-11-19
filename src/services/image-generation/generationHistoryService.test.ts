import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  GeneratedArtwork,
  GenerationJob,
  PromptDocument,
} from '../../types/domain';
import type { RegisteredImageGenerationProviderSummary } from '../../types/providers';
import { createEntityId, nowIsoTimestamp } from '../../utils/ids';
import {
  composeVariationPromptText,
  createApprovedVariationPromptDocument,
  filterAndSortGenerationEntries,
  getAvailableHistoryFilters,
  readStoredComparisonSelection,
  reconcileComparisonSelection,
  resolveGenerationKind,
  validateRegenerationEligibility,
  writeStoredComparisonSelection,
  type PersistedGenerationRecordBundle,
} from './generationHistoryService';
import {
  executeTextToImageGeneration,
  type ImageGenerationExecuteTransport,
} from './imageGenerationClient';

const VALID_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function makeProviderSummary(
  overrides: Partial<{
    providerId: string;
    modelId: string;
    supportsNegativePrompt: boolean;
    maxPromptLength: number;
    tokenConfigured: boolean;
    anonymousFreeTierEnabled: boolean;
    connectionStatus: RegisteredImageGenerationProviderSummary['status']['connectionStatus'];
  }> = {},
): RegisteredImageGenerationProviderSummary {
  const providerId = overrides.providerId ?? 'ovhcloud';
  const modelId = overrides.modelId ?? 'stable-diffusion-xl-base-v10';
  const providerName =
    providerId === 'ovhcloud' ? 'OVHcloud AI Endpoints' : 'Alt Provider';
  const tokenConfigured = overrides.tokenConfigured ?? true;
  const anonymousFreeTierEnabled = overrides.anonymousFreeTierEnabled ?? false;

  const capabilities = {
    providerId,
    providerName,
    modelId,
    task: 'text-to-image' as const,
    isFreeTierModel: true,
    supportsAnonymousFreeTier: true,
    supportsNegativePrompt: overrides.supportsNegativePrompt ?? true,
    supportsImageToImage: false as const,
    maxNumberOfImages: 1,
    maxPromptLength: overrides.maxPromptLength ?? 2000,
    supportsSeed: false,
    supportsGuidanceScale: false,
    supportsInferenceSteps: false,
    anonymousRateLimitRpm: 2,
    authenticatedRateLimitRpm: 400,
    requiresExplicitConfirmationForSmokeTest: true,
    hasDedicatedHealthEndpoint: false,
    warnings: [],
    unsupportedParameters: ['seed', 'guidanceScale', 'inferenceSteps'],
    supportedOutputSizes: [
      { width: 1024, height: 1024, aspectRatio: '1:1', label: '1024 × 1024' },
    ],
  };

  return {
    isActive: true,
    capabilities,
    status: {
      providerId,
      providerName,
      modelId,
      task: 'text-to-image',
      enabled: true,
      isFreeTierModel: true,
      accessMode: tokenConfigured
        ? 'authenticated'
        : anonymousFreeTierEnabled
          ? 'anonymous_free_tier'
          : 'disabled',
      tokenConfigured,
      anonymousFreeTierEnabled,
      credentialEnvVar: 'OVH_AI_ENDPOINTS_ACCESS_TOKEN',
      configurationStatus:
        tokenConfigured || anonymousFreeTierEnabled ? 'configured' : 'not_configured',
      connectionStatus: overrides.connectionStatus ?? 'connected',
      lastHealthCheckAt: nowIsoTimestamp(),
      lastSmokeTestAt: null,
      testRequestCount: 0,
      statusMessage: 'Connected cleanly.',
      errorCategory: undefined,
      warnings: [],
    },
  };
}

function makeMasterPrompt(projectId: ReturnType<typeof createEntityId>): PromptDocument {
  const now = nowIsoTimestamp();
  const id = createEntityId('prm');
  return {
    id,
    promptId: id,
    projectId,
    descriptionId: createEntityId('dsc'),
    styleId: createEntityId('sty'),
    userInstructions: 'Soft rim light on travertine plinth.',
    revision: 2,
    revisionNumber: 2,
    generatedPrompt: 'Ceramic teapot on travertine plinth.',
    finalPrompt: 'Studio ceramic teapot on matte travertine plinth under gallery daylight.',
    negativePrompt: 'blurry, text watermark',
    approvalStatus: 'approved',
    approvedAt: now,
    promptKind: 'master',
    createdAt: now,
    updatedAt: now,
  };
}

function makeBundle(params: {
  projectId: ReturnType<typeof createEntityId>;
  promptDocument: PromptDocument | null;
  parentPromptDocument?: PromptDocument | null;
  timestamp: string;
  generationKind?: 'original' | 'regeneration' | 'variation';
  omitGenerationKind?: boolean;
  parentGenerationId?: ReturnType<typeof createEntityId> | null;
  variationId?: ReturnType<typeof createEntityId> | null;
  status?: 'completed' | 'failed';
  providerId?: string;
  modelId?: string;
}): PersistedGenerationRecordBundle {
  const jobId = createEntityId('job');
  const artworkId = createEntityId('art');
  const status = params.status ?? 'completed';
  const job: GenerationJob = {
    id: jobId,
    projectId: params.projectId,
    promptDocumentId: params.promptDocument?.id ?? createEntityId('prm'),
    providerConfigRef: {
      providerId: params.providerId ?? 'ovhcloud',
      modelId: params.modelId ?? 'stable-diffusion-xl-base-v10',
    },
    aspectRatio: '1:1',
    resolution: { width: 1024, height: 1024, label: 'standard' },
    modelParameters: {},
    status,
    artworkIds: status === 'completed' ? [artworkId] : [],
    errorCode: status === 'failed' ? 'RATE_LIMITED' : null,
    errorMessage: status === 'failed' ? 'Rate limit reached.' : null,
    queuedAt: params.timestamp,
    startedAt: params.timestamp,
    completedAt: params.timestamp,
    ...(params.omitGenerationKind
      ? {}
      : { generationKind: params.generationKind ?? 'original' }),
    parentGenerationId: params.parentGenerationId ?? null,
    variationId: params.variationId ?? null,
    createdAt: params.timestamp,
    updatedAt: params.timestamp,
  };

  const artwork: GeneratedArtwork | null =
    status === 'completed'
      ? {
          id: artworkId,
          projectId: params.projectId,
          generationJobId: jobId,
          promptDocumentId: job.promptDocumentId,
          mimeType: 'image/png',
          width: 1024,
          height: 1024,
          localBlobKey: createEntityId('blb'),
          fileSizeBytes: 2048,
          providerModelId: params.modelId ?? 'stable-diffusion-xl-base-v10',
          createdAt: params.timestamp,
          updatedAt: params.timestamp,
        }
      : null;

  return {
    job,
    artwork,
    imageBlob:
      status === 'completed'
        ? new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })
        : null,
    blobMissingOrCorrupted: false,
    blobErrorMessage: null,
    fileSizeBytes: status === 'completed' ? 2048 : null,
    promptDocument: params.promptDocument,
    parentPromptDocument: params.parentPromptDocument ?? null,
  };
}

test('resolves generation kind for legacy Phase 05.2 records and filters/sorts accurately', () => {
  const projectId = createEntityId('prj');
  const masterPrompt = makeMasterPrompt(projectId);

  const legacyOriginal = makeBundle({
    projectId,
    promptDocument: masterPrompt,
    timestamp: '2026-11-16T10:00:00.000Z',
    omitGenerationKind: true,
  });
  assert.equal(resolveGenerationKind(legacyOriginal.job, masterPrompt), 'original');

  const regeneration = makeBundle({
    projectId,
    promptDocument: masterPrompt,
    timestamp: '2026-11-16T10:05:00.000Z',
    generationKind: 'regeneration',
    parentGenerationId: legacyOriginal.job.id,
  });

  const varId = createEntityId('var');
  const varPromptRes = createApprovedVariationPromptDocument({
    projectId,
    parentPromptDocument: masterPrompt,
    parentGenerationId: legacyOriginal.job.id,
    variationInstructions: 'Warmer golden hour light',
    composedBaselinePrompt: `${masterPrompt.finalPrompt} Warm light.`,
    finalVariationPrompt: `${masterPrompt.finalPrompt} Warm golden hour light.`,
    negativePrompt: 'blurry',
    providerId: 'ovhcloud',
    modelId: 'stable-diffusion-xl-base-v10',
    nextRevisionNumber: 1,
    maxPromptLength: 2000,
  });
  assert.equal(varPromptRes.ok, true);
  if (!varPromptRes.ok) return;

  const variation = makeBundle({
    projectId,
    promptDocument: varPromptRes.data.variationPromptDocument,
    parentPromptDocument: masterPrompt,
    timestamp: '2026-11-16T10:10:00.000Z',
    generationKind: 'variation',
    parentGenerationId: legacyOriginal.job.id,
    variationId: varId,
  });

  const failed = makeBundle({
    projectId,
    promptDocument: masterPrompt,
    timestamp: '2026-11-16T10:15:00.000Z',
    generationKind: 'original',
    status: 'failed',
  });

  const all = [legacyOriginal, regeneration, variation, failed];
  const filters = getAvailableHistoryFilters(all);
  assert.equal(filters.find((f) => f.id === 'all')?.count, 4);
  assert.equal(filters.find((f) => f.id === 'original')?.count, 2);
  assert.equal(filters.find((f) => f.id === 'regeneration')?.count, 1);
  assert.equal(filters.find((f) => f.id === 'variation')?.count, 1);
  assert.equal(filters.find((f) => f.id === 'failed')?.count, 1);

  const newest = filterAndSortGenerationEntries(all, {
    filter: 'all',
    sortOrder: 'newest',
  });
  assert.equal(newest[0]?.job.id, failed.job.id);
  assert.equal(newest[3]?.job.id, legacyOriginal.job.id);

  const oldest = filterAndSortGenerationEntries(all, {
    filter: 'all',
    sortOrder: 'oldest',
  });
  assert.equal(oldest[0]?.job.id, legacyOriginal.job.id);
  assert.equal(oldest[3]?.job.id, failed.job.id);

  const onlyVariations = filterAndSortGenerationEntries(all, {
    filter: 'variation',
    sortOrder: 'newest',
  });
  assert.equal(onlyVariations.length, 1);
  assert.equal(onlyVariations[0]?.job.id, variation.job.id);
});

test('validateRegenerationEligibility enforces exact provider/model match without silent fallback and preserves source prompt', async () => {
  const projectId = createEntityId('prj');
  const masterPrompt = makeMasterPrompt(projectId);
  const originalEntry = makeBundle({
    projectId,
    promptDocument: masterPrompt,
    timestamp: '2026-11-16T10:00:00.000Z',
    generationKind: 'original',
  });

  const differentProvider = makeProviderSummary({
    providerId: 'other-paid',
    modelId: 'paid-model-v2',
  });

  const mismatchedCheck = validateRegenerationEligibility({
    projectId,
    sourceEntry: originalEntry,
    registeredProviders: [differentProvider],
    allowAnonymousFreeTier: false,
  });
  assert.equal(mismatchedCheck.ok, false);
  if (!mismatchedCheck.ok) {
    assert.equal(mismatchedCheck.error.code, 'PROVIDER_UNAVAILABLE');
  }

  const ovhProvider = makeProviderSummary({
    providerId: 'ovhcloud',
    modelId: 'stable-diffusion-xl-base-v10',
  });

  const eligible = validateRegenerationEligibility({
    projectId,
    sourceEntry: originalEntry,
    registeredProviders: [ovhProvider],
    allowAnonymousFreeTier: false,
  });
  assert.equal(eligible.ok, true);
  if (!eligible.ok) return;

  let calls = 0;
  let sentPayload: Record<string, unknown> | null = null;
  const mockTransport: ImageGenerationExecuteTransport = async (req) => {
    calls += 1;
    sentPayload = req.payload as unknown as Record<string, unknown>;
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
          temporaryImageDataUrl: `data:image/png;base64,${VALID_PNG_BASE64}`,
          createdAt: nowIsoTimestamp(),
          durationMs: 950,
        },
      },
    };
  };

  const outcome = await executeTextToImageGeneration({
    projectId,
    promptDocument: eligible.data.promptDocument,
    providerSummary: eligible.data.providerSummary,
    includeNegativePrompt: eligible.data.includeNegativePrompt,
    allowAnonymousFreeTier: false,
    lineage: {
      generationKind: 'regeneration',
      parentGenerationId: originalEntry.job.id,
      parentPromptId: masterPrompt.id,
      variationLabel: 'Regenerated',
    },
    transport: mockTransport,
  });

  assert.equal(calls, 1);
  assert.equal(outcome.outcomeState, 'completed');
  assert.ok(outcome.job && outcome.artwork);
  assert.notEqual(outcome.job.id, originalEntry.job.id);
  assert.notEqual(outcome.artwork.id, originalEntry.artwork?.id);
  assert.equal(outcome.job.generationKind, 'regeneration');
  assert.equal(outcome.job.parentGenerationId, originalEntry.job.id);
  assert.equal(outcome.artwork.parentGenerationId, originalEntry.job.id);
  assert.equal(sentPayload?.['approvedPrompt'], masterPrompt.finalPrompt);
  assert.equal('sourceAssetId' in (sentPayload ?? {}), false);
  assert.equal('sourceImage' in (sentPayload ?? {}), false);
});

test('composeVariationPromptText and createApprovedVariationPromptDocument keep parent prompt immutable and enforce text-only boundaries', async () => {
  const projectId = createEntityId('prj');
  const masterPrompt = makeMasterPrompt(projectId);
  const originalSnapshotText = masterPrompt.finalPrompt;
  const parentJobId = createEntityId('job');

  const noNegativeComposed = composeVariationPromptText({
    parentPromptDocument: masterPrompt,
    variationInstructions: 'Introduce dramatic rim lighting',
    negativePromptAdjustment: 'blurry',
    supportsNegativePrompt: false,
    maxPromptLength: 2000,
  });
  assert.equal(noNegativeComposed.ok, true);
  if (!noNegativeComposed.ok) return;
  assert.equal(noNegativeComposed.data.negativePrompt, '');
  assert.ok(noNegativeComposed.data.composedPrompt.includes('Introduce dramatic rim lighting'));

  // Rejects base64 image data injection
  const base64Attempt = composeVariationPromptText({
    parentPromptDocument: masterPrompt,
    variationInstructions: 'data:image/png;base64,AAAA',
    supportsNegativePrompt: true,
    maxPromptLength: 2000,
  });
  assert.equal(base64Attempt.ok, false);
  if (!base64Attempt.ok) {
    assert.equal(base64Attempt.error.code, 'SECURITY_BOUNDARY_VIOLATION');
  }

  const approvedVar = createApprovedVariationPromptDocument({
    projectId,
    parentPromptDocument: masterPrompt,
    parentGenerationId: parentJobId,
    variationInstructions: 'Introduce dramatic rim lighting',
    composedBaselinePrompt: noNegativeComposed.data.composedPrompt,
    finalVariationPrompt: `${noNegativeComposed.data.composedPrompt} High-contrast studio shadows.`,
    negativePrompt: '',
    providerId: 'ovhcloud',
    modelId: 'stable-diffusion-xl-base-v10',
    nextRevisionNumber: 1,
    maxPromptLength: 2000,
  });
  assert.equal(approvedVar.ok, true);
  if (!approvedVar.ok) return;

  const childPrompt = approvedVar.data.variationPromptDocument;
  assert.equal(childPrompt.promptKind, 'variation');
  assert.equal(childPrompt.approvalStatus, 'approved');
  assert.equal(childPrompt.parentPromptId, masterPrompt.id);
  assert.equal(childPrompt.parentGenerationId, parentJobId);
  assert.notEqual(childPrompt.id, masterPrompt.id);
  assert.equal(masterPrompt.finalPrompt, originalSnapshotText);

  const ovhProvider = makeProviderSummary();
  let capturedPromptSent: string | undefined;
  let capturedKeys: string[] = [];

  const outcome = await executeTextToImageGeneration({
    projectId,
    promptDocument: childPrompt,
    providerSummary: ovhProvider,
    includeNegativePrompt: false,
    allowAnonymousFreeTier: false,
    lineage: {
      generationKind: 'variation',
      parentGenerationId: parentJobId,
      parentPromptId: masterPrompt.id,
      variationId: approvedVar.data.variationId,
      variationPromptId: childPrompt.id,
      variationInstructions: childPrompt.variationInstructions,
      variationLabel: 'Variation',
    },
    transport: async (req) => {
      capturedPromptSent = req.payload.approvedPrompt;
      capturedKeys = Object.keys(req.payload);
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
            temporaryImageDataUrl: `data:image/png;base64,${VALID_PNG_BASE64}`,
            createdAt: nowIsoTimestamp(),
            durationMs: 800,
          },
        },
      };
    },
  });

  assert.equal(outcome.outcomeState, 'completed');
  assert.equal(capturedPromptSent, childPrompt.finalPrompt);
  assert.equal(capturedKeys.includes('sourceAssetId'), false);
  assert.equal(capturedKeys.includes('parentArtwork'), false);
  assert.equal(outcome.job?.generationKind, 'variation');
  assert.equal(outcome.job?.parentGenerationId, parentJobId);
  assert.equal(outcome.job?.variationId, approvedVar.data.variationId);
});

test('persists and reconciles comparison selection cleanly per project', () => {
  const store = new Map<string, string>();
  const prevStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    },
  });

  try {
    const projectId = createEntityId('prj');
    const masterPrompt = makeMasterPrompt(projectId);
    const e1 = makeBundle({
      projectId,
      promptDocument: masterPrompt,
      timestamp: '2026-11-16T10:00:00.000Z',
    });
    const e2 = makeBundle({
      projectId,
      promptDocument: masterPrompt,
      timestamp: '2026-11-16T10:05:00.000Z',
    });
    const failed = makeBundle({
      projectId,
      promptDocument: masterPrompt,
      timestamp: '2026-11-16T10:08:00.000Z',
      status: 'failed',
    });

    const missingId = createEntityId('job');
    writeStoredComparisonSelection(projectId, [e1.job.id, failed.job.id, e2.job.id, missingId]);
    const restored = readStoredComparisonSelection(projectId);
    assert.deepEqual(restored, [e1.job.id, failed.job.id, e2.job.id, missingId]);

    const reconciled = reconcileComparisonSelection(restored, [e1, e2, failed]);
    assert.deepEqual(reconciled, [e1.job.id, e2.job.id]);
  } finally {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: prevStorage,
    });
  }
});

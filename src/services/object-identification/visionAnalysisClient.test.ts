import assert from 'node:assert/strict';
import test from 'node:test';
import { errResult, okResult } from '../../types/common.ts';
import type { Project, SourceAsset } from '../../types/domain.ts';
import {
  executeVisionAnalysisFromStorage,
  type VisionAnalysisRequestPhase,
} from './visionAnalysisClient.ts';

function makeValidPngBytes(width = 512, height = 512): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(64));
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8);
  bytes[16] = (width >>> 24) & 0xff;
  bytes[17] = (width >>> 16) & 0xff;
  bytes[18] = (width >>> 8) & 0xff;
  bytes[19] = width & 0xff;
  bytes[20] = (height >>> 24) & 0xff;
  bytes[21] = (height >>> 16) & 0xff;
  bytes[22] = (height >>> 8) & 0xff;
  bytes[23] = height & 0xff;
  return bytes;
}

function makeProject(id = 'prj_test_123456', assetId = 'src_test_123456'): Project {
  return {
    id,
    title: 'Ceramic Study',
    description: 'Active source asset study workspace.',
    status: 'draft',
    sourceAssetId: assetId,
    activeAnalysisId: null,
    activeDescriptionId: null,
    selectedStyleId: null,
    activePromptId: null,
    activeGenerationJobId: null,
    tags: [],
    createdAt: '2026-11-14T00:00:00.000Z',
    updatedAt: '2026-11-14T00:00:00.000Z',
  };
}

function makeAsset(overrides: Partial<SourceAsset> = {}): SourceAsset {
  return {
    id: 'src_test_123456',
    projectId: 'prj_test_123456',
    originalFileName: 'ceramic-vase.png',
    mimeType: 'image/png',
    fileExtension: 'png',
    fileSizeBytes: 64,
    width: 512,
    height: 512,
    aspectRatio: { widthRatio: 1, heightRatio: 1, label: '1:1', numeric: 1 },
    localBlobKey: 'blb_test_123456',
    validationStatus: 'validated',
    storageStatus: 'persisted',
    createdAt: '2026-11-14T00:00:00.000Z',
    updatedAt: '2026-11-14T00:00:00.000Z',
    ...overrides,
  };
}

test('executeVisionAnalysisFromStorage rejects missing source asset or missing IndexedDB Blob', async () => {
  const noAssetPhases: VisionAnalysisRequestPhase[] = [];
  const noAssetRes = await executeVisionAnalysisFromStorage({
    projectId: 'prj_test_123456',
    expectedAsset: null,
    sourceAssetStorage: {
      getProjectSourceAsset: async () => okResult(null),
    },
    onPhaseChange: (p) => noAssetPhases.push(p),
  });
  assert.equal(noAssetRes.ok, false);
  if (!noAssetRes.ok) {
    assert.equal(noAssetRes.error.code, 'VALIDATION_ERROR');
  }
  assert.deepEqual(noAssetPhases, ['validating', 'error']);

  const asset = makeAsset();
  const missingBlobRes = await executeVisionAnalysisFromStorage({
    projectId: 'prj_test_123456',
    expectedAsset: asset,
    sourceAssetStorage: {
      getProjectSourceAsset: async () =>
        okResult({
          project: makeProject(),
          sourceAsset: asset,
          blob: null,
        }),
    },
  });
  assert.equal(missingBlobRes.ok, false);
  if (!missingBlobRes.ok) {
    assert.equal(missingBlobRes.error.code, 'NOT_FOUND');
  }
});

test('executeVisionAnalysisFromStorage transmits original IndexedDB Blob as multipart/form-data with authentic phases', async () => {
  const pngBytes = makeValidPngBytes();
  const originalBlob = new Blob([pngBytes], { type: 'image/png' });
  const asset = makeAsset({ fileSizeBytes: originalBlob.size });
  const phases: VisionAnalysisRequestPhase[] = [];

  let transmittedProjectId: FormDataEntryValue | null = null;
  let transmittedAssetId: FormDataEntryValue | null = null;
  let transmittedFile: FormDataEntryValue | null = null;

  const result = await executeVisionAnalysisFromStorage({
    projectId: 'prj_test_123456',
    expectedAsset: asset,
    sourceAssetStorage: {
      getProjectSourceAsset: async () =>
        okResult({
          project: makeProject(),
          sourceAsset: asset,
          blob: originalBlob,
        }),
    },
    onPhaseChange: (p) => phases.push(p),
    transport: async ({ endpoint, formData, onUploadComplete }) => {
      assert.equal(endpoint, '/api/vision/analyze');
      transmittedProjectId = formData.get('projectId');
      transmittedAssetId = formData.get('assetId');
      transmittedFile = formData.get('image');
      onUploadComplete?.();
      return {
        status: 200,
        body: {
          ok: true,
          data: {
            requestStatus: 'succeeded',
            providerId: 'gemini',
            modelId: 'gemini-4-hydrogen',
            analyzedAt: '2026-11-14T00:05:00.000Z',
            projectId: 'prj_test_123456',
            sourceAssetId: 'src_test_123456',
            rawText: 'Observed stoneware pitcher with cobalt accent glaze.',
          },
        },
      };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(phases, ['validating', 'uploading', 'analyzing', 'success']);
  assert.equal(transmittedProjectId, 'prj_test_123456');
  assert.equal(transmittedAssetId, 'src_test_123456');
  const capturedFile = transmittedFile as unknown;
  assert.ok(capturedFile instanceof Blob);
  const transmittedBytes = new Uint8Array(
    await (capturedFile as Blob).arrayBuffer(),
  );
  assert.deepEqual(transmittedBytes, pngBytes);
});

test('executeVisionAnalysisFromStorage supports error retry and genuine cancellation without altering Blob', async () => {
  const pngBytes = makeValidPngBytes();
  const originalBlob = new Blob([pngBytes], { type: 'image/png' });
  const asset = makeAsset({ fileSizeBytes: originalBlob.size });

  let attempt = 0;
  const mockStorage = {
    getProjectSourceAsset: async () =>
      okResult({
        project: makeProject(),
        sourceAsset: asset,
        blob: originalBlob,
      }),
  };

  const firstAttempt = await executeVisionAnalysisFromStorage({
    projectId: 'prj_test_123456',
    expectedAsset: asset,
    sourceAssetStorage: mockStorage,
    transport: async ({ onUploadComplete }) => {
      attempt += 1;
      onUploadComplete?.();
      return {
        status: 503,
        body: {
          ok: false,
          error: {
            code: 'PROVIDER_UNAVAILABLE',
            category: 'PROVIDER_UNAVAILABLE',
            message: 'Temporary service interruption.',
            retryable: true,
          },
        },
      };
    },
  });
  assert.equal(firstAttempt.ok, false);
  assert.equal(attempt, 1);

  const retryAttempt = await executeVisionAnalysisFromStorage({
    projectId: 'prj_test_123456',
    expectedAsset: asset,
    sourceAssetStorage: mockStorage,
    transport: async ({ onUploadComplete }) => {
      attempt += 1;
      onUploadComplete?.();
      return {
        status: 200,
        body: {
          ok: true,
          data: {
            requestStatus: 'succeeded',
            providerId: 'gemini',
            modelId: 'gemini-4-hydrogen',
            analyzedAt: '2026-11-14T00:06:00.000Z',
            projectId: 'prj_test_123456',
            sourceAssetId: 'src_test_123456',
            rawText: 'Retry succeeded: stoneware pitcher.',
          },
        },
      };
    },
  });
  assert.equal(retryAttempt.ok, true);
  assert.equal(attempt, 2);

  // Genuine cancellation via AbortController
  const controller = new AbortController();
  const cancelledPhases: VisionAnalysisRequestPhase[] = [];
  const cancelRes = await executeVisionAnalysisFromStorage({
    projectId: 'prj_test_123456',
    expectedAsset: asset,
    sourceAssetStorage: mockStorage,
    abortSignal: controller.signal,
    onPhaseChange: (p) => cancelledPhases.push(p),
    transport: async () => {
      controller.abort();
      throw new DOMException('Aborted by user', 'AbortError');
    },
  });
  assert.equal(cancelRes.ok, false);
  if (!cancelRes.ok) {
    assert.equal(cancelRes.error.details?.cancelled, true);
  }
  assert.equal(cancelledPhases.at(-1), 'cancelled');

  // Verify storage error propagation
  const storageFail = await executeVisionAnalysisFromStorage({
    projectId: 'prj_test_123456',
    expectedAsset: asset,
    sourceAssetStorage: {
      getProjectSourceAsset: async () =>
        errResult('STORAGE_ERROR', 'IndexedDB transaction aborted.'),
    },
  });
  assert.equal(storageFail.ok, false);
  if (!storageFail.ok) {
    assert.equal(storageFail.error.code, 'STORAGE_ERROR');
  }
});

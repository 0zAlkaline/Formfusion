import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { okResult } from '../../types/common.ts';
import type { GeneratedArtwork } from '../../types/domain.ts';
import type {
  IndexedDbStorageGateway,
  PersistedAssetBlob,
  StorageRecordMap,
  StorageStoreName,
} from '../../types/storage.ts';
import { FORMFUSION_INDEXED_DB_SCHEMA } from '../project-storage/indexedDbContract.ts';
import { StudioExportService } from './artworkExportService.ts';

function createFakeGateway(options: {
  readonly artwork: GeneratedArtwork | null;
  readonly assetBlob: PersistedAssetBlob | null;
  readonly onTransactionMode?: (mode: 'readonly' | 'readwrite') => void;
  readonly onPutCalled?: () => void;
}): IndexedDbStorageGateway {
  return {
    schema: FORMFUSION_INDEXED_DB_SCHEMA,
    isAvailable: () => true,
    isPersistent: () => true,
    getStore<K extends StorageStoreName>(storeName: K) {
      return {
        storeName,
        async getById(id) {
          if (storeName === 'generatedArtworks') {
            const found =
              options.artwork && options.artwork.id === id
                ? (options.artwork as StorageRecordMap[K])
                : null;
            return okResult(found);
          }
          if (storeName === 'assetBlobs') {
            const found =
              options.assetBlob && options.assetBlob.id === id
                ? (options.assetBlob as StorageRecordMap[K])
                : null;
            return okResult(found);
          }
          return okResult(null);
        },
        async listAll() {
          return okResult([]);
        },
        async put(record) {
          options.onPutCalled?.();
          return okResult(record);
        },
        async delete() {
          options.onPutCalled?.();
          return okResult(undefined);
        },
      };
    },
    async runInTransaction(context, work) {
      options.onTransactionMode?.(context.mode);
      return work();
    },
  };
}

const SAMPLE_ARTWORK: GeneratedArtwork = {
  id: 'art_00000000-0000-4000-8000-000000000001',
  projectId: 'prj_00000000-0000-4000-8000-000000000001',
  generationJobId: 'job_00000000-0000-4000-8000-000000000001',
  promptDocumentId: 'prm_00000000-0000-4000-8000-000000000001',
  mimeType: 'image/png',
  width: 1024,
  height: 1024,
  localBlobKey: 'blb_00000000-0000-4000-8000-000000000001',
  fileSizeBytes: 128,
  providerModelId: 'stable-diffusion-xl-base-v10',
  generationKind: 'original',
  createdAt: '2026-06-01T10:00:00.000Z',
  updatedAt: '2026-06-01T10:00:00.000Z',
};

describe('StudioExportService (storage boundary and error handling)', () => {
  it('uses strict readonly IndexedDB transactions and never writes to storage', async () => {
    const modes: string[] = [];
    let writeCount = 0;

    const gateway = createFakeGateway({
      artwork: SAMPLE_ARTWORK,
      assetBlob: null, // missing blob
      onTransactionMode: (mode) => modes.push(mode),
      onPutCalled: () => {
        writeCount += 1;
      },
    });

    const service = new StudioExportService(gateway);
    const res = await service.exportArtwork({
      artwork: SAMPLE_ARTWORK,
      format: 'png',
      fileNameBase: 'test',
      includeMetadataSidecar: false,
    });

    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.error.code, 'NOT_FOUND');
      assert.ok(res.error.message.includes('missing or corrupted'));
    }
    assert.deepEqual(modes, ['readonly']);
    assert.equal(writeCount, 0);
  });

  it('rejects mismatched blob ownership cleanly without writing or corrupting state', async () => {
    const mismatchedBlobRecord: PersistedAssetBlob = {
      id: SAMPLE_ARTWORK.localBlobKey,
      ownerAssetId: 'art_different_owner_0000001',
      projectId: SAMPLE_ARTWORK.projectId,
      mimeType: 'image/png',
      fileSizeBytes: 8,
      blob: new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], {
        type: 'image/png',
      }),
      createdAt: '2026-06-01T10:00:00.000Z',
      updatedAt: '2026-06-01T10:00:00.000Z',
    };

    const gateway = createFakeGateway({
      artwork: SAMPLE_ARTWORK,
      assetBlob: mismatchedBlobRecord,
    });

    const service = new StudioExportService(gateway);
    const res = await service.inspectArtworkSource(SAMPLE_ARTWORK);
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.error.code, 'NOT_FOUND');
    }
  });

  it('fails gracefully when storage gateway is unavailable', async () => {
    const service = new StudioExportService(null);
    const res = await service.exportArtwork({
      artwork: SAMPLE_ARTWORK,
      format: 'jpeg',
      fileNameBase: 'test',
      includeMetadataSidecar: false,
    });
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.error.code, 'STORAGE_ERROR');
    }
  });
});

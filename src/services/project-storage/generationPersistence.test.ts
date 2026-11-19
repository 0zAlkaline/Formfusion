import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  GeneratedArtwork,
  GenerationJob,
  ObjectAnalysis,
  ObjectDescription,
  PromptDocument,
  SourceAsset,
} from '../../types/domain';
import { createEntityId, nowIsoTimestamp } from '../../utils/ids';
import { BrowserProjectStorageService } from './browserProjectStorage';
import { BrowserIndexedDbStorageGateway } from './indexedDbGateway';

interface StoreEntry {
  keyPath: string;
  records: Map<string, unknown>;
  indexes: Map<string, { keyPath: string | string[]; unique: boolean }>;
}

interface DbBacking {
  version: number;
  stores: Map<string, StoreEntry>;
}

type FaultMode =
  | { type: 'none' }
  | { type: 'quota_on_put'; storeName: string };

function createRequest<T>(executor: () => T): IDBRequest<T> {
  const req: Record<string, unknown> = {
    result: undefined,
    error: null,
    onsuccess: null,
    onerror: null,
    readyState: 'pending',
  };
  queueMicrotask(() => {
    try {
      req.result = executor();
      req.readyState = 'done';
      if (typeof req.onsuccess === 'function') {
        (req.onsuccess as (ev: Event) => void)({ target: req } as unknown as Event);
      }
    } catch (err) {
      req.error = err;
      req.readyState = 'done';
      if (typeof req.onerror === 'function') {
        (req.onerror as (ev: Event) => void)({ target: req } as unknown as Event);
      }
    }
  });
  return req as unknown as IDBRequest<T>;
}

class InMemoryIdbBackingStore {
  readonly dbs = new Map<string, DbBacking>();
  fault: FaultMode = { type: 'none' };

  createFactory(): IDBFactory {
    const host = this;
    const makeFactory: Partial<IDBFactory> = {
      open(name: string, version = 1): IDBOpenDBRequest {
        const req: Record<string, unknown> = {
          result: undefined,
          error: null,
          transaction: null,
          onsuccess: null,
          onerror: null,
          onupgradeneeded: null,
          onblocked: null,
        };

        queueMicrotask(() => {
          let backing = host.dbs.get(name);
          const needsUpgrade = !backing || backing.version < version;
          if (!backing) {
            backing = { version, stores: new Map() };
            host.dbs.set(name, backing);
          }

          const dbWrapper = host.wrapDatabase(backing);
          req.result = dbWrapper;

          if (needsUpgrade) {
            backing.version = version;
            const upgradeTx = host.wrapTransaction(
              backing,
              Array.from(backing.stores.keys()),
              'versionchange',
            );
            req.transaction = upgradeTx;
            if (typeof req.onupgradeneeded === 'function') {
              (req.onupgradeneeded as (ev: IDBVersionChangeEvent) => void)({
                target: req,
              } as unknown as IDBVersionChangeEvent);
            }
            dbWrapper.refreshObjectStoreNames();
          }

          if (typeof req.onsuccess === 'function') {
            (req.onsuccess as (ev: Event) => void)({ target: req } as unknown as Event);
          }
        });

        return req as unknown as IDBOpenDBRequest;
      },
    };
    return makeFactory as IDBFactory;
  }

  private wrapDatabase(backing: DbBacking) {
    const host = this;
    const makeDomStringList = () => {
      const names = () => Array.from(backing.stores.keys());
      return {
        get length() {
          return names().length;
        },
        contains(name: string) {
          return backing.stores.has(name);
        },
        item(index: number) {
          return names()[index] ?? null;
        },
        [Symbol.iterator]() {
          return names()[Symbol.iterator]();
        },
      };
    };

    const db: Record<string, unknown> = {
      version: backing.version,
      objectStoreNames: makeDomStringList(),
      onversionchange: null,
      onclose: null,
      close() {},
      refreshObjectStoreNames() {
        db.objectStoreNames = makeDomStringList();
      },
      createObjectStore(
        storeName: string,
        options?: IDBObjectStoreParameters,
      ): IDBObjectStore {
        const keyPath = (options?.keyPath as string) ?? 'id';
        const entry: StoreEntry = {
          keyPath,
          records: new Map(),
          indexes: new Map(),
        };
        backing.stores.set(storeName, entry);
        db.objectStoreNames = makeDomStringList();
        return host.makeStoreHandle(storeName, entry, () => false, () => {});
      },
      transaction(
        storeNames: string | string[],
        mode: IDBTransactionMode = 'readonly',
      ): IDBTransaction {
        const list = Array.isArray(storeNames) ? storeNames : [storeNames];
        return host.wrapTransaction(backing, list, mode);
      },
    };
    return db as unknown as IDBDatabase & { refreshObjectStoreNames(): void };
  }

  private makeStoreHandle(
    storeName: string,
    entry: StoreEntry,
    isAborted: () => boolean,
    onAbortError: (err: Error) => void,
    scheduleWork?: (fn: () => void) => void,
  ): IDBObjectStore {
    const host = this;
    const enqueue = scheduleWork ?? ((fn) => queueMicrotask(fn));

    const handle: Record<string, unknown> = {
      name: storeName,
      indexNames: { contains: (name: string) => entry.indexes.has(name) },
      createIndex(name: string, keyPath: string | string[], options?: IDBIndexParameters) {
        entry.indexes.set(name, {
          keyPath,
          unique: Boolean(options?.unique),
        });
        return {} as IDBIndex;
      },
      get(key: IDBValidKey) {
        return createRequest(() => {
          if (isAborted()) {
            throw new DOMException('Transaction aborted', 'AbortError');
          }
          return entry.records.get(String(key));
        });
      },
      getAll() {
        return createRequest(() => {
          if (isAborted()) {
            throw new DOMException('Transaction aborted', 'AbortError');
          }
          return Array.from(entry.records.values());
        });
      },
      put(value: Record<string, unknown>) {
        const req: Record<string, unknown> = {
          result: undefined,
          error: null,
          onsuccess: null,
          onerror: null,
        };
        enqueue(() => {
          if (isAborted()) return;
          if (
            host.fault.type === 'quota_on_put' &&
            host.fault.storeName === storeName
          ) {
            const err = new DOMException('Quota exceeded', 'QuotaExceededError');
            req.error = err;
            onAbortError(err);
            if (typeof req.onerror === 'function') {
              (req.onerror as (ev: Event) => void)({ target: req } as unknown as Event);
            }
            return;
          }
          const key = String(value[entry.keyPath]);
          entry.records.set(key, value);
          req.result = key;
          if (typeof req.onsuccess === 'function') {
            (req.onsuccess as (ev: Event) => void)({ target: req } as unknown as Event);
          }
        });
        return req as unknown as IDBRequest<IDBValidKey>;
      },
      delete(key: IDBValidKey) {
        const req: Record<string, unknown> = {
          result: undefined,
          error: null,
          onsuccess: null,
          onerror: null,
        };
        enqueue(() => {
          if (isAborted()) return;
          entry.records.delete(String(key));
          if (typeof req.onsuccess === 'function') {
            (req.onsuccess as (ev: Event) => void)({ target: req } as unknown as Event);
          }
        });
        return req as unknown as IDBRequest<undefined>;
      },
    };

    return handle as unknown as IDBObjectStore;
  }

  private wrapTransaction(
    backing: DbBacking,
    storeNames: string[],
    mode: IDBTransactionMode,
  ): IDBTransaction {
    const host = this;
    const snapshots = new Map<string, Map<string, unknown>>();
    if (mode === 'readwrite') {
      for (const name of storeNames) {
        const existing = backing.stores.get(name);
        if (existing) {
          snapshots.set(name, new Map(existing.records));
        }
      }
    }

    let finished = false;
    let aborted = false;
    let pendingOps = 0;
    let completionScheduled = false;

    const tx: Record<string, unknown> = {
      error: null,
      oncomplete: null,
      onerror: null,
      onabort: null,
      abort() {
        if (finished) return;
        aborted = true;
        finished = true;
        for (const [name, snap] of snapshots.entries()) {
          const entry = backing.stores.get(name);
          if (entry) entry.records = snap;
        }
        queueMicrotask(() => {
          if (typeof tx.onabort === 'function') {
            (tx.onabort as (ev: Event) => void)({ target: tx } as unknown as Event);
          }
        });
      },
      objectStore(name: string): IDBObjectStore {
        const entry = backing.stores.get(name);
        if (!entry) {
          throw new Error(`Missing object store: ${name}`);
        }
        return host.makeStoreHandle(
          name,
          entry,
          () => aborted,
          (err) => {
            tx.error = err;
            (tx.abort as () => void)();
          },
          (fn) => {
            pendingOps += 1;
            queueMicrotask(() => {
              try {
                fn();
              } finally {
                pendingOps -= 1;
                scheduleComplete();
              }
            });
          },
        );
      },
    };

    const scheduleComplete = () => {
      if (completionScheduled || aborted || finished) return;
      queueMicrotask(() => {
        if (pendingOps > 0 || aborted || finished) return;
        completionScheduled = true;
        finished = true;
        if (typeof tx.oncomplete === 'function') {
          (tx.oncomplete as (ev: Event) => void)({ target: tx } as unknown as Event);
        }
      });
    };

    setTimeout(scheduleComplete, 0);
    return tx as unknown as IDBTransaction;
  }
}

function makeHarness() {
  const backing = new InMemoryIdbBackingStore();
  const gateway = new BrowserIndexedDbStorageGateway(backing.createFactory());
  const service = new BrowserProjectStorageService(gateway);
  return { backing, gateway, service };
}

async function seedFullApprovedProject(service: BrowserProjectStorageService) {
  const now = nowIsoTimestamp();
  const projectId = createEntityId('prj');
  const sourceAssetId = createEntityId('src');

  const sourceAsset: SourceAsset = {
    id: sourceAssetId,
    projectId,
    originalFileName: 'espresso-study.png',
    mimeType: 'image/png',
    fileExtension: 'png',
    fileSizeBytes: 512,
    width: 512,
    height: 512,
    aspectRatio: { widthRatio: 1, heightRatio: 1, label: '1:1', numeric: 1 },
    localBlobKey: null,
    validationStatus: 'validated',
    storageStatus: 'in_memory',
    createdAt: now,
    updatedAt: now,
  };
  const sourceBlob = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 9])], {
    type: 'image/png',
  });

  const savedSource = await service.saveOrReplaceProjectSourceAsset({
    projectId,
    validatedAsset: sourceAsset,
    binaryBlob: sourceBlob,
  });
  assert.equal(savedSource.ok, true);
  if (!savedSource.ok) throw new Error('Seed source failed');

  const analysis: ObjectAnalysis = {
    id: createEntityId('anl'),
    projectId,
    sourceAssetId,
    providerId: 'gemini',
    modelId: 'gemini-4-hydrogen',
    sceneSummary: 'Machined stainless espresso tamper on dark slate workbench.',
    detectedObjects: [],
    lightingNotes: 'Soft directional daylight.',
    compositionNotes: 'Centered eye-level studio view.',
    objectName: 'Espresso Tamper',
    objectCategory: 'Barista Tool',
    primaryDescription:
      'Machined stainless steel base with dark anodized walnut handle.',
    shapeAndSilhouette: 'Cylindrical base tapering into ergonomic handle.',
    materials: ['stainless steel', 'walnut'],
    dominantColors: ['steel silver', 'walnut brown'],
    surfaceDetails: 'Brushed metal striations with satin wood grain.',
    distinctiveFeatures: ['Turned walnut handle'],
    composition: 'Centered upright.',
    viewingAngle: 'Eye-level',
    preservationPriorities: ['Preserve metallic finish'],
    uncertainAttributes: ['Bottom stamp unseen'],
    analyzedAt: now,
    createdAt: now,
    updatedAt: now,
  };

  const description: ObjectDescription = {
    id: createEntityId('dsc'),
    projectId,
    analysisId: analysis.id,
    sourceAssetId,
    version: 1,
    objectName: analysis.objectName,
    objectCategory: analysis.objectCategory,
    primaryDescription: analysis.primaryDescription,
    shapeAndSilhouette: analysis.shapeAndSilhouette,
    materials: analysis.materials,
    dominantColors: analysis.dominantColors,
    surfaceDetails: analysis.surfaceDetails,
    distinctiveFeatures: analysis.distinctiveFeatures,
    composition: analysis.composition,
    viewingAngle: analysis.viewingAngle,
    preservationPriorities: analysis.preservationPriorities,
    uncertainAttributes: analysis.uncertainAttributes,
    primarySubject: 'Espresso Tamper',
    environmentContext: 'Dark slate workbench studio setup',
    objects: [],
    moodAndAtmosphere: 'Utilitarian craft studio',
    userNotes: '',
    isNormalized: false,
    createdAt: now,
    updatedAt: now,
  };

  const savedDesc = await service.saveAnalysisAndInitialDescription({
    projectId,
    analysis,
    description,
  });
  assert.equal(savedDesc.ok, true);

  const promptDoc: PromptDocument = {
    id: createEntityId('prm'),
    projectId,
    descriptionId: description.id,
    styleId: null,
    userInstructions: '',
    revision: 1,
    revisionNumber: 1,
    generatedPrompt: 'Machined espresso tamper under warm gallery lighting',
    finalPrompt: 'Machined stainless espresso tamper on matte travertine plinth',
    negativePrompt: 'blurry, text watermark',
    approvalStatus: 'approved',
    approvedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  const savedPrompt = await service.savePromptDocumentRevision(promptDoc);
  assert.equal(savedPrompt.ok, true);

  return { projectId, sourceAsset: savedSource.data.sourceAsset, analysis, description, promptDoc };
}

test('saves GeneratedArtwork, GenerationJob, and Blob atomically and restores intact on simulated reload while preserving SourceAsset', async () => {
  const { backing, service } = makeHarness();
  const seeded = await seedFullApprovedProject(service);
  const now = nowIsoTimestamp();

  const jobId = createEntityId('job');
  const artworkId = createEntityId('art');
  const blobKey = createEntityId('blb');

  const job: GenerationJob = {
    id: jobId,
    projectId: seeded.projectId,
    promptDocumentId: seeded.promptDoc.id,
    providerConfigRef: {
      providerId: 'ovhcloud',
      modelId: 'stable-diffusion-xl-base-v10',
    },
    aspectRatio: '1:1',
    resolution: { width: 1024, height: 1024, label: 'standard' },
    modelParameters: {},
    status: 'completed',
    artworkIds: [artworkId],
    errorCode: null,
    errorMessage: null,
    queuedAt: now,
    startedAt: now,
    completedAt: now,
    createdAt: now,
    updatedAt: now,
  };

  const artwork: GeneratedArtwork = {
    id: artworkId,
    projectId: seeded.projectId,
    generationJobId: jobId,
    promptDocumentId: seeded.promptDoc.id,
    mimeType: 'image/png',
    width: 1024,
    height: 1024,
    localBlobKey: blobKey,
    providerModelId: 'stable-diffusion-xl-base-v10',
    createdAt: now,
    updatedAt: now,
  };

  const generatedBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 42, 43, 44]);
  const generatedBlob = new Blob([generatedBytes], { type: 'image/png' });

  const saveRes = await service.saveGeneratedArtworkResult({
    job,
    artwork,
    imageBlob: generatedBlob,
  });
  assert.equal(saveRes.ok, true);
  if (!saveRes.ok) return;

  assert.equal(saveRes.data.project.status, 'generated');
  assert.equal(saveRes.data.project.activeGenerationJobId, jobId);
  assert.equal(saveRes.data.project.sourceAssetId, seeded.sourceAsset.id);

  // Simulated full page reload with fresh BrowserIndexedDbStorageGateway
  const reloadedService = new BrowserProjectStorageService(
    new BrowserIndexedDbStorageGateway(backing.createFactory()),
  );

  const restoredGen = await reloadedService.getProjectGenerationState(seeded.projectId);
  assert.equal(restoredGen.ok, true);
  if (!restoredGen.ok || !restoredGen.data) return;

  assert.equal(restoredGen.data.artwork?.id, artworkId);
  assert.equal(restoredGen.data.artwork?.localBlobKey, blobKey);
  assert.equal(restoredGen.data.latestJob?.id, jobId);
  assert.ok(restoredGen.data.imageBlob);
  const readBytes = new Uint8Array(await restoredGen.data.imageBlob.arrayBuffer());
  assert.deepEqual(Array.from(readBytes), Array.from(generatedBytes));

  // Verify Original Source Asset, Analysis, Description, and Prompt remained completely intact
  const restoredSource = await reloadedService.getProjectSourceAsset(seeded.projectId);
  assert.equal(restoredSource.ok, true);
  if (restoredSource.ok && restoredSource.data) {
    assert.equal(restoredSource.data.sourceAsset?.id, seeded.sourceAsset.id);
    assert.equal(
      restoredSource.data.sourceAsset?.localBlobKey,
      seeded.sourceAsset.localBlobKey,
    );
  }
  const restoredDesc = await reloadedService.getProjectObjectAnalysisState(seeded.projectId);
  assert.equal(restoredDesc.ok, true);
  if (restoredDesc.ok && restoredDesc.data) {
    assert.equal(restoredDesc.data.analysis?.id, seeded.analysis.id);
    assert.equal(restoredDesc.data.description?.id, seeded.description.id);
  }
});

test('rolls back atomically on quota error during generation save and succeeds cleanly on Retry Saving Locally', async () => {
  const { backing, service } = makeHarness();
  const seeded = await seedFullApprovedProject(service);
  const now = nowIsoTimestamp();

  const jobId = createEntityId('job');
  const artworkId = createEntityId('art');
  const blobKey = createEntityId('blb');

  const job: GenerationJob = {
    id: jobId,
    projectId: seeded.projectId,
    promptDocumentId: seeded.promptDoc.id,
    providerConfigRef: {
      providerId: 'ovhcloud',
      modelId: 'stable-diffusion-xl-base-v10',
    },
    aspectRatio: '1:1',
    resolution: { width: 1024, height: 1024, label: 'standard' },
    modelParameters: {},
    status: 'completed',
    artworkIds: [artworkId],
    errorCode: null,
    errorMessage: null,
    queuedAt: now,
    startedAt: now,
    completedAt: now,
    createdAt: now,
    updatedAt: now,
  };

  const artwork: GeneratedArtwork = {
    id: artworkId,
    projectId: seeded.projectId,
    generationJobId: jobId,
    promptDocumentId: seeded.promptDoc.id,
    mimeType: 'image/png',
    width: 1024,
    height: 1024,
    localBlobKey: blobKey,
    providerModelId: 'stable-diffusion-xl-base-v10',
    createdAt: now,
    updatedAt: now,
  };

  const generatedBlob = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 77])], {
    type: 'image/png',
  });

  // Trigger simulated QuotaExceededError when writing assetBlobs
  backing.fault = { type: 'quota_on_put', storeName: 'assetBlobs' };
  const failedSave = await service.saveGeneratedArtworkResult({
    job,
    artwork,
    imageBlob: generatedBlob,
  });
  assert.equal(failedSave.ok, false);
  if (!failedSave.ok) {
    assert.equal(failedSave.error.code, 'STORAGE_ERROR');
    assert.equal(failedSave.error.details?.reason, 'quota_exceeded');
  }

  // Clear fault and retry persisting locally
  backing.fault = { type: 'none' };
  const retriedSave = await service.saveGeneratedArtworkResult({
    job,
    artwork,
    imageBlob: generatedBlob,
  });
  assert.equal(retriedSave.ok, true);
  if (retriedSave.ok) {
    assert.equal(retriedSave.data.artwork?.id, artworkId);
    assert.equal(retriedSave.data.project.activeGenerationJobId, jobId);
  }
});

test('rejects security boundary violations and cleans generation records when source asset is removed', async () => {
  const { service } = makeHarness();
  const seeded = await seedFullApprovedProject(service);
  const now = nowIsoTimestamp();

  const leakyJob = {
    id: createEntityId('job'),
    projectId: seeded.projectId,
    promptDocumentId: seeded.promptDoc.id,
    providerConfigRef: {
      providerId: 'ovhcloud',
      modelId: 'stable-diffusion-xl-base-v10',
    },
    aspectRatio: '1:1' as const,
    resolution: { width: 1024, height: 1024, label: 'standard' as const },
    modelParameters: { apiKey: 'secret-leak' },
    status: 'completed' as const,
    artworkIds: [],
    errorCode: null,
    errorMessage: null,
    queuedAt: now,
    startedAt: now,
    completedAt: now,
    createdAt: now,
    updatedAt: now,
  };

  const rejected = await service.saveGenerationHistoryEntry(
    leakyJob as unknown as GenerationJob,
  );
  assert.equal(rejected.ok, false);

  const cleanJob: GenerationJob = {
    ...leakyJob,
    id: createEntityId('job'),
    modelParameters: {},
    status: 'failed',
    errorCode: 'RATE_LIMITED',
    errorMessage: '2 RPM anonymous limit',
  };
  const savedFailure = await service.saveGenerationHistoryEntry(cleanJob);
  assert.equal(savedFailure.ok, true);

  // Removing source asset clears activeGenerationJobId and generation history
  const removed = await service.removeProjectSourceAsset(seeded.projectId);
  assert.equal(removed.ok, true);
  if (removed.ok && removed.data) {
    assert.equal(removed.data.activeGenerationJobId, null);
  }
  const genAfterRemove = await service.getProjectGenerationState(seeded.projectId);
  assert.equal(genAfterRemove.ok, true);
  if (genAfterRemove.ok && genAfterRemove.data) {
    assert.equal(genAfterRemove.data.latestJob, null);
    assert.equal(genAfterRemove.data.artwork, null);
    assert.equal(genAfterRemove.data.jobHistory.length, 0);
  }
});

test('restores multi-generation history (original, regeneration, variation, failed) across reload without overwriting Master Prompt and recovers gracefully when one artwork Blob is missing', async () => {
  const { createApprovedVariationPromptDocument } = await import(
    '../image-generation/generationHistoryService'
  );
  const { backing, service } = makeHarness();
  const seeded = await seedFullApprovedProject(service);

  const bytesA = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
  const blobA = new Blob([bytesA], { type: 'image/png' });
  const jobId1 = createEntityId('job');
  const artId1 = createEntityId('art');
  const blobKey1 = createEntityId('blb');

  // Seed legacy Phase 05.2 job (no generationKind field)
  const legacyJob1: GenerationJob = {
    id: jobId1,
    projectId: seeded.projectId,
    promptDocumentId: seeded.promptDoc.id,
    providerConfigRef: {
      providerId: 'ovhcloud',
      modelId: 'stable-diffusion-xl-base-v10',
    },
    aspectRatio: '1:1',
    resolution: { width: 1024, height: 1024, label: 'standard' },
    modelParameters: {},
    status: 'completed',
    artworkIds: [artId1],
    errorCode: null,
    errorMessage: null,
    queuedAt: '2026-11-16T10:00:00.000Z',
    startedAt: '2026-11-16T10:00:00.000Z',
    completedAt: '2026-11-16T10:00:02.000Z',
    createdAt: '2026-11-16T10:00:00.000Z',
    updatedAt: '2026-11-16T10:00:02.000Z',
  };
  const artwork1: GeneratedArtwork = {
    id: artId1,
    projectId: seeded.projectId,
    generationJobId: jobId1,
    promptDocumentId: seeded.promptDoc.id,
    mimeType: 'image/png',
    width: 1024,
    height: 1024,
    localBlobKey: blobKey1,
    providerModelId: 'stable-diffusion-xl-base-v10',
    createdAt: '2026-11-16T10:00:02.000Z',
    updatedAt: '2026-11-16T10:00:02.000Z',
  };
  assert.equal(
    (
      await service.saveGeneratedArtworkResult({
        job: legacyJob1,
        artwork: artwork1,
        imageBlob: blobA,
      })
    ).ok,
    true,
  );

  // Regeneration linked to jobId1
  const jobId2 = createEntityId('job');
  const artId2 = createEntityId('art');
  const blobKey2 = createEntityId('blb');
  const bytesB = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 4, 5, 6, 7]);
  const blobB = new Blob([bytesB], { type: 'image/png' });
  const regenJob2: GenerationJob = {
    id: jobId2,
    projectId: seeded.projectId,
    promptDocumentId: seeded.promptDoc.id,
    providerConfigRef: {
      providerId: 'ovhcloud',
      modelId: 'stable-diffusion-xl-base-v10',
    },
    aspectRatio: '1:1',
    resolution: { width: 1024, height: 1024, label: 'standard' },
    modelParameters: {},
    status: 'completed',
    artworkIds: [artId2],
    errorCode: null,
    errorMessage: null,
    queuedAt: '2026-11-16T10:05:00.000Z',
    startedAt: '2026-11-16T10:05:00.000Z',
    completedAt: '2026-11-16T10:05:02.000Z',
    generationKind: 'regeneration',
    parentGenerationId: jobId1,
    parentPromptId: seeded.promptDoc.id,
    variationLabel: 'Regenerated',
    createdAt: '2026-11-16T10:05:00.000Z',
    updatedAt: '2026-11-16T10:05:02.000Z',
  };
  const artwork2: GeneratedArtwork = {
    id: artId2,
    projectId: seeded.projectId,
    generationJobId: jobId2,
    promptDocumentId: seeded.promptDoc.id,
    mimeType: 'image/png',
    width: 1024,
    height: 1024,
    localBlobKey: blobKey2,
    fileSizeBytes: bytesB.byteLength,
    providerModelId: 'stable-diffusion-xl-base-v10',
    generationKind: 'regeneration',
    parentGenerationId: jobId1,
    variationLabel: 'Regenerated',
    createdAt: '2026-11-16T10:05:02.000Z',
    updatedAt: '2026-11-16T10:05:02.000Z',
  };
  assert.equal(
    (
      await service.saveGeneratedArtworkResult({
        job: regenJob2,
        artwork: artwork2,
        imageBlob: blobB,
      })
    ).ok,
    true,
  );

  // Variation with separate child PromptDocument
  const varPromptRes = createApprovedVariationPromptDocument({
    projectId: seeded.projectId,
    parentPromptDocument: seeded.promptDoc,
    parentGenerationId: jobId1,
    variationInstructions: 'Use a warmer color palette',
    composedBaselinePrompt: `${seeded.promptDoc.finalPrompt}. Variation refinement: Use a warmer color palette.`,
    finalVariationPrompt: `${seeded.promptDoc.finalPrompt}. Warm terracotta palette variation.`,
    negativePrompt: 'blurry, text watermark',
    providerId: 'ovhcloud',
    modelId: 'stable-diffusion-xl-base-v10',
    nextRevisionNumber: 1,
    maxPromptLength: 2000,
  });
  assert.equal(varPromptRes.ok, true);
  if (!varPromptRes.ok) return;

  const jobId3 = createEntityId('job');
  const artId3 = createEntityId('art');
  const blobKey3 = createEntityId('blb');
  const bytesC = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 8, 9, 10, 11, 12]);
  const blobC = new Blob([bytesC], { type: 'image/png' });
  const variationJob3: GenerationJob = {
    id: jobId3,
    projectId: seeded.projectId,
    promptDocumentId: varPromptRes.data.variationPromptDocument.id,
    providerConfigRef: {
      providerId: 'ovhcloud',
      modelId: 'stable-diffusion-xl-base-v10',
    },
    aspectRatio: '1:1',
    resolution: { width: 1024, height: 1024, label: 'standard' },
    modelParameters: {},
    status: 'completed',
    artworkIds: [artId3],
    errorCode: null,
    errorMessage: null,
    queuedAt: '2026-11-16T10:10:00.000Z',
    startedAt: '2026-11-16T10:10:00.000Z',
    completedAt: '2026-11-16T10:10:02.000Z',
    generationKind: 'variation',
    parentGenerationId: jobId1,
    parentPromptId: seeded.promptDoc.id,
    variationId: varPromptRes.data.variationId,
    variationPromptId: varPromptRes.data.variationPromptDocument.id,
    variationInstructions: 'Use a warmer color palette',
    variationLabel: 'Variation',
    createdAt: '2026-11-16T10:10:00.000Z',
    updatedAt: '2026-11-16T10:10:02.000Z',
  };
  const artwork3: GeneratedArtwork = {
    id: artId3,
    projectId: seeded.projectId,
    generationJobId: jobId3,
    promptDocumentId: varPromptRes.data.variationPromptDocument.id,
    mimeType: 'image/png',
    width: 1024,
    height: 1024,
    localBlobKey: blobKey3,
    fileSizeBytes: bytesC.byteLength,
    providerModelId: 'stable-diffusion-xl-base-v10',
    generationKind: 'variation',
    parentGenerationId: jobId1,
    variationId: varPromptRes.data.variationId,
    variationLabel: 'Variation',
    createdAt: '2026-11-16T10:10:02.000Z',
    updatedAt: '2026-11-16T10:10:02.000Z',
  };
  const varSaveRes = await service.saveGeneratedArtworkResult({
    job: variationJob3,
    artwork: artwork3,
    imageBlob: blobC,
    variationPromptDocument: varPromptRes.data.variationPromptDocument,
  });
  assert.equal(varSaveRes.ok, true);
  if (!varSaveRes.ok) return;

  // Verify Master Prompt and project.activePromptId were NOT replaced by the variation prompt
  assert.equal(varSaveRes.data.project.activePromptId, seeded.promptDoc.id);

  // Attempting to overwrite Master Prompt via savePromptDocumentRevision with variation prompt must fail
  const blockedMasterOverwrite = await service.savePromptDocumentRevision(
    varPromptRes.data.variationPromptDocument,
  );
  assert.equal(blockedMasterOverwrite.ok, false);

  // Delete blobKey2 to simulate a missing/corrupted Blob for a single artwork only
  for (const dbBacking of backing.dbs.values()) {
    dbBacking.stores.get('assetBlobs')?.records.delete(blobKey2);
  }

  // Simulated reload using fresh BrowserProjectStorageService
  const reloadedService = new BrowserProjectStorageService(
    new BrowserIndexedDbStorageGateway(backing.createFactory()),
  );

  // Prompt Composer state remains unaffected and excludes child variation prompts
  const promptState = await reloadedService.getProjectPromptState(seeded.projectId);
  assert.equal(promptState.ok, true);
  if (promptState.ok && promptState.data) {
    assert.equal(promptState.data.activePrompt?.id, seeded.promptDoc.id);
    assert.equal(promptState.data.revisions.length, 1);
    assert.equal(promptState.data.revisions[0]?.id, seeded.promptDoc.id);
  }

  // History restoration preserves all 3 entries and gracefully flags only artwork2 as missing Blob
  const historyRes = await reloadedService.getProjectGenerationHistory(seeded.projectId);
  assert.equal(historyRes.ok, true);
  if (!historyRes.ok || !historyRes.data) return;

  assert.equal(historyRes.data.entries.length, 3);
  const restoredVar = historyRes.data.entries.find((e) => e.job.id === jobId3);
  const restoredRegen = historyRes.data.entries.find((e) => e.job.id === jobId2);
  const restoredOrig = historyRes.data.entries.find((e) => e.job.id === jobId1);

  assert.equal(restoredOrig?.job.generationKind, 'original');
  assert.ok(restoredOrig?.imageBlob);
  assert.equal(restoredOrig?.blobMissingOrCorrupted, false);

  assert.equal(restoredRegen?.job.generationKind, 'regeneration');
  assert.equal(restoredRegen?.blobMissingOrCorrupted, true);
  assert.equal(restoredRegen?.imageBlob, null);
  assert.equal(restoredRegen?.promptDocument?.id, seeded.promptDoc.id);

  assert.equal(restoredVar?.job.generationKind, 'variation');
  assert.ok(restoredVar?.imageBlob);
  assert.equal(restoredVar?.blobMissingOrCorrupted, false);
  assert.equal(
    restoredVar?.promptDocument?.id,
    varPromptRes.data.variationPromptDocument.id,
  );
  assert.equal(restoredVar?.parentPromptDocument?.id, seeded.promptDoc.id);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  GeneratedArtwork,
  GenerationJob,
  ObjectAnalysis,
  ObjectDescription,
  Project,
  PromptDocument,
  SourceAsset,
} from '../../types/domain';
import { createEntityId, nowIsoTimestamp } from '../../utils/ids';
import {
  ACTIVE_PROJECT_STORAGE_KEY,
  BrowserProjectStorageService,
  readStoredActiveProjectId,
  writeStoredActiveProjectId,
} from './browserProjectStorage';
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

class TestIdbBackingStore {
  readonly dbs = new Map<string, DbBacking>();

  createFactory(): IDBFactory {
    const host = this;
    return {
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
            req.transaction = host.wrapTransaction(
              backing,
              Array.from(backing.stores.keys()),
              'versionchange',
              true,
            );
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
    } as unknown as IDBFactory;
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
      close() {},
      refreshObjectStoreNames() {
        db.objectStoreNames = makeDomStringList();
      },
      createObjectStore(storeName: string, options?: IDBObjectStoreParameters): IDBObjectStore {
        const entry: StoreEntry = {
          keyPath: (options?.keyPath as string) ?? 'id',
          records: new Map(),
          indexes: new Map(),
        };
        backing.stores.set(storeName, entry);
        db.objectStoreNames = makeDomStringList();
        return host.makeStoreHandle(storeName, entry, () => false, () => {});
      },
      transaction(storeNames: string | string[], mode: IDBTransactionMode = 'readonly'): IDBTransaction {
        const list = Array.isArray(storeNames) ? storeNames : [storeNames];
        return host.wrapTransaction(backing, list, mode, false);
      },
    };
    return db as unknown as IDBDatabase & { refreshObjectStoreNames(): void };
  }

  private makeStoreHandle(
    storeName: string,
    entry: StoreEntry,
    isAborted: () => boolean,
    _onAbortError: (err: Error) => void,
    scheduleWork?: (fn: () => void) => void,
  ): IDBObjectStore {
    const enqueue = scheduleWork ?? ((fn) => queueMicrotask(fn));
    const handle: Record<string, unknown> = {
      name: storeName,
      indexNames: { contains: (n: string) => entry.indexes.has(n) },
      createIndex(name: string, keyPath: string | string[], options?: IDBIndexParameters) {
        entry.indexes.set(name, { keyPath, unique: Boolean(options?.unique) });
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
        const req: Record<string, unknown> = { result: undefined, error: null, onsuccess: null, onerror: null };
        enqueue(() => {
          if (isAborted()) return;
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
        const req: Record<string, unknown> = { result: undefined, error: null, onsuccess: null, onerror: null };
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
    isUpgrade: boolean,
  ): IDBTransaction {
    const host = this;
    const snapshot = new Map<string, Map<string, unknown>>();
    for (const name of storeNames) {
      const store = backing.stores.get(name);
      if (store) {
        snapshot.set(name, new Map(store.records));
      }
    }
    let aborted = false;
    let finished = false;
    let pendingOps = 0;
    let scheduledComplete = false;

    const tx: Record<string, unknown> = {
      mode,
      error: null,
      oncomplete: null,
      onabort: null,
      onerror: null,
      abort() {
        if (finished || aborted) return;
        aborted = true;
        finished = true;
        for (const [name, priorRecords] of snapshot.entries()) {
          const store = backing.stores.get(name);
          if (store) store.records = priorRecords;
        }
        queueMicrotask(() => {
          if (typeof tx.onabort === 'function') {
            (tx.onabort as (ev: Event) => void)({ target: tx } as unknown as Event);
          }
        });
      },
      objectStore(name: string) {
        const entry = backing.stores.get(name);
        if (!entry) throw new DOMException(`Store ${name} not found`, 'NotFoundError');
        return host.makeStoreHandle(
          name,
          entry,
          () => aborted,
          (err) => {
            tx.error = err;
            (tx.abort as () => void)();
          },
          (work) => {
            pendingOps += 1;
            queueMicrotask(() => {
              try {
                work();
              } finally {
                pendingOps -= 1;
                checkFinish();
              }
            });
          },
        );
      },
    };

    const checkFinish = () => {
      if (aborted || finished || isUpgrade || pendingOps > 0) return;
      if (!scheduledComplete) {
        scheduledComplete = true;
        queueMicrotask(() => {
          if (aborted || finished || pendingOps > 0) return;
          finished = true;
          if (typeof tx.oncomplete === 'function') {
            (tx.oncomplete as (ev: Event) => void)({ target: tx } as unknown as Event);
          }
        });
      }
    };

    if (!isUpgrade) {
      queueMicrotask(() => {
        setTimeout(() => checkFinish(), 5);
      });
    }
    return tx as unknown as IDBTransaction;
  }
}

function createMemoryLocalStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  };
}

function makePngBlob(label = 'image-data'): Blob {
  return new Blob([`PNG:${label}`], { type: 'image/png' });
}

function createFullWorkflowRecords(
  projectId: string,
  title: string,
  options: { withArtwork?: boolean } = {},
) {
  const now = nowIsoTimestamp();
  const assetId = createEntityId('src');
  const sourceBlobKey = createEntityId('blb');
  const analysisId = createEntityId('anl');
  const descriptionId = createEntityId('dsc');
  const promptId = createEntityId('prm');
  const jobId = createEntityId('job');
  const artworkId = createEntityId('art');
  const artworkBlobKey = createEntityId('blb');

  const sourceAsset: SourceAsset = {
    id: assetId,
    projectId,
    originalFileName: `${title.toLowerCase().replace(/\s+/g, '-')}.png`,
    mimeType: 'image/png',
    fileExtension: 'png',
    fileSizeBytes: 2048,
    width: 1024,
    height: 1024,
    aspectRatio: { widthRatio: 1, heightRatio: 1, label: '1:1', numeric: 1 },
    localBlobKey: sourceBlobKey,
    validationStatus: 'validated',
    storageStatus: 'persisted',
    createdAt: now,
    updatedAt: now,
  };

  const analysis: ObjectAnalysis = {
    id: analysisId,
    projectId,
    sourceAssetId: assetId,
    providerId: 'gemini-vision',
    modelId: 'gemini-2.5-flash',
    sceneSummary: `${title} centerpiece`,
    detectedObjects: [],
    lightingNotes: 'Soft directional studio light',
    compositionNotes: 'Centered study',
    objectName: title,
    objectCategory: 'Object',
    primaryDescription: `Studio photograph of ${title}.`,
    shapeAndSilhouette: 'Sculpted silhouette',
    materials: ['Ceramic'],
    dominantColors: ['Ivory'],
    surfaceDetails: 'Matte glaze',
    distinctiveFeatures: ['Hand-thrown neck'],
    composition: 'Centered',
    viewingAngle: 'Eye level',
    preservationPriorities: ['Silhouette'],
    uncertainAttributes: [],
    analyzedAt: now,
    createdAt: now,
    updatedAt: now,
  };

  const description: ObjectDescription = {
    id: descriptionId,
    projectId,
    analysisId,
    sourceAssetId: assetId,
    version: 1,
    objectName: title,
    objectCategory: 'Object',
    primaryDescription: `Edited studio study of ${title}.`,
    shapeAndSilhouette: 'Sculpted silhouette',
    materials: ['Ceramic'],
    dominantColors: ['Ivory'],
    surfaceDetails: 'Matte glaze',
    distinctiveFeatures: ['Hand-thrown neck'],
    composition: 'Centered',
    viewingAngle: 'Eye level',
    preservationPriorities: ['Silhouette'],
    uncertainAttributes: [],
    primarySubject: title,
    environmentContext: 'Neutral backdrop',
    objects: [],
    moodAndAtmosphere: 'Quiet editorial',
    userNotes: '',
    isNormalized: true,
    createdAt: now,
    updatedAt: now,
  };

  const prompt: PromptDocument = {
    id: promptId,
    projectId,
    descriptionId,
    styleId: 'stl_editorial',
    userInstructions: 'Preserve silhouette',
    generatedPrompt: `Editorial studio study of ${title}`,
    finalPrompt: `Editorial studio study of ${title}, soft directional daylight`,
    negativePrompt: 'blurry, distorted',
    approvalStatus: 'approved',
    approvedAt: now,
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };

  const job: GenerationJob = {
    id: jobId,
    projectId,
    promptDocumentId: promptId,
    providerConfigRef: {
      providerId: 'ovhcloud-sdxl',
      modelId: 'stable-diffusion-xl-base-v10',
    },
    aspectRatio: '1:1',
    resolution: { width: 1024, height: 1024, label: 'standard' },
    modelParameters: { guidanceScale: 7.5, inferenceSteps: 30 },
    status: 'completed',
    artworkIds: options.withArtwork === false ? [] : [artworkId],
    errorMessage: null,
    errorCode: null,
    queuedAt: now,
    startedAt: now,
    completedAt: now,
    generationKind: 'original',
    createdAt: now,
    updatedAt: now,
  };

  const artwork: GeneratedArtwork = {
    id: artworkId,
    projectId,
    generationJobId: jobId,
    promptDocumentId: promptId,
    mimeType: 'image/png',
    width: 1024,
    height: 1024,
    localBlobKey: artworkBlobKey,
    providerModelId: 'stable-diffusion-xl-base-v10',
    generationKind: 'original',
    createdAt: now,
    updatedAt: now,
  };

  return {
    sourceAsset,
    sourceBlobKey,
    analysis,
    description,
    prompt,
    job,
    artwork,
    artworkBlobKey,
  };
}

function setupEnvironment() {
  const backing = new TestIdbBackingStore();
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = backing.createFactory();
  (globalThis as unknown as { localStorage: Storage }).localStorage = createMemoryLocalStorage();
  const gateway = new BrowserIndexedDbStorageGateway();
  const storage = new BrowserProjectStorageService(gateway);
  return { backing, gateway, storage };
}

test('Project creation validates required name, persists via IndexedDB, and activates project only after save', async () => {
  const { storage } = setupEnvironment();

  const invalid = await storage.createProject({ title: '   ' });
  assert.equal(invalid.ok, false);
  assert.equal(readStoredActiveProjectId(), null);

  const created = await storage.createProject({
    title: '  Porcelain Amphora  ',
    description: 'Studio lighting study',
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  assert.equal(created.data.title, 'Porcelain Amphora');
  assert.equal(created.data.description, 'Studio lighting study');
  assert.equal(created.data.status, 'draft');
  assert.equal(readStoredActiveProjectId(), created.data.id);

  const summariesRes = await storage.listProjectSummaries();
  assert.equal(summariesRes.ok, true);
  if (summariesRes.ok) {
    assert.equal(summariesRes.data.length, 1);
    assert.equal(summariesRes.data[0]?.isActiveProject, true);
    assert.equal(summariesRes.data[0]?.artworkCount, 0);
    assert.equal(summariesRes.data[0]?.sourceAvailability, 'none');
  }
});

test('Renaming a project validates input and preserves ID plus all existing relationships', async () => {
  const { storage } = setupEnvironment();
  const created = await storage.createProject({ title: 'Initial Vessel' });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const wf = createFullWorkflowRecords(created.data.id, 'Initial Vessel');
  await storage.saveOrReplaceProjectSourceAsset({
    projectId: created.data.id,
    validatedAsset: wf.sourceAsset,
    binaryBlob: makePngBlob('source-1'),
  });
  await storage.saveAnalysisAndInitialDescription({
    projectId: created.data.id,
    analysis: wf.analysis,
    description: wf.description,
  });
  await storage.savePromptDocumentRevision(wf.prompt);
  await storage.saveGeneratedArtworkResult({
    job: wf.job,
    artwork: wf.artwork,
    imageBlob: makePngBlob('artwork-1'),
  });

  const emptyRename = await storage.renameProject(created.data.id, '  ');
  assert.equal(emptyRename.ok, false);

  const renamed = await storage.renameProject(created.data.id, 'Renamed Porcelain Vessel');
  assert.equal(renamed.ok, true);
  if (!renamed.ok) return;

  assert.equal(renamed.data.id, created.data.id);
  assert.equal(renamed.data.title, 'Renamed Porcelain Vessel');
  assert.equal(renamed.data.status, 'generated');
  assert.equal(renamed.data.sourceAssetId, wf.sourceAsset.id);

  const bundleRes = await storage.getProjectBundle(created.data.id);
  assert.equal(bundleRes.ok, true);
  if (bundleRes.ok && bundleRes.data) {
    assert.equal(bundleRes.data.sourceAsset?.id, wf.sourceAsset.id);
    assert.equal(bundleRes.data.analyses.length, 1);
    assert.equal(bundleRes.data.descriptions.length, 1);
    assert.equal(bundleRes.data.prompts.length, 1);
    assert.equal(bundleRes.data.generationJobs.length, 1);
    assert.equal(bundleRes.data.artworks.length, 1);
  }
});

test('Archiving and restoring preserves all artworks and workflow records intact', async () => {
  const { storage } = setupEnvironment();
  const created = await storage.createProject({ title: 'Brass Lantern' });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const wf = createFullWorkflowRecords(created.data.id, 'Brass Lantern');
  await storage.saveOrReplaceProjectSourceAsset({
    projectId: created.data.id,
    validatedAsset: wf.sourceAsset,
    binaryBlob: makePngBlob('lantern-src'),
  });
  await storage.saveAnalysisAndInitialDescription({
    projectId: created.data.id,
    analysis: wf.analysis,
    description: wf.description,
  });
  await storage.savePromptDocumentRevision(wf.prompt);
  await storage.saveGeneratedArtworkResult({
    job: wf.job,
    artwork: wf.artwork,
    imageBlob: makePngBlob('lantern-art'),
  });

  const archived = await storage.archiveProject(created.data.id);
  assert.equal(archived.ok, true);
  if (!archived.ok) return;
  assert.equal(archived.data.status, 'archived');
  assert.equal(archived.data.previousStatus, 'generated');
  // Active project cleared when active project is archived
  assert.equal(readStoredActiveProjectId(), null);

  // Records remain completely intact while archived
  const bundleWhileArchived = await storage.getProjectBundle(created.data.id);
  assert.equal(bundleWhileArchived.ok, true);
  if (bundleWhileArchived.ok && bundleWhileArchived.data) {
    assert.equal(bundleWhileArchived.data.artworks.length, 1);
    assert.equal(bundleWhileArchived.data.prompts.length, 1);
  }

  const restored = await storage.restoreProject(created.data.id);
  assert.equal(restored.ok, true);
  if (!restored.ok) return;
  assert.equal(restored.data.status, 'generated');
  assert.equal(restored.data.previousStatus, null);

  const bundleAfterRestore = await storage.getProjectBundle(created.data.id);
  assert.equal(bundleAfterRestore.ok, true);
  if (bundleAfterRestore.ok && bundleAfterRestore.data) {
    assert.equal(bundleAfterRestore.data.sourceAsset?.id, wf.sourceAsset.id);
    assert.equal(bundleAfterRestore.data.artworks.length, 1);
    assert.equal(bundleAfterRestore.data.generationJobs.length, 1);
  }
});

test('Deleting a project cleans up its dependent records and blobs while preserving unrelated projects, missing blobs, and shared sourceAssets/assetBlobs', async () => {
  const { storage, gateway } = setupEnvironment();

  const prj1 = await storage.createProject({ title: 'Target Project' });
  const prj2 = await storage.createProject({ title: 'Sibling Unrelated Project' });
  const prjShared = await storage.createProject({ title: 'Shared Asset Holder' });
  assert.ok(prj1.ok && prj2.ok && prjShared.ok);
  if (!prj1.ok || !prj2.ok || !prjShared.ok) return;

  const wf1 = createFullWorkflowRecords(prj1.data.id, 'Target Project');
  await storage.saveOrReplaceProjectSourceAsset({
    projectId: prj1.data.id,
    validatedAsset: wf1.sourceAsset,
    binaryBlob: makePngBlob('target-src'),
  });
  await storage.saveAnalysisAndInitialDescription({
    projectId: prj1.data.id,
    analysis: wf1.analysis,
    description: wf1.description,
  });
  await storage.savePromptDocumentRevision(wf1.prompt);
  await storage.saveGeneratedArtworkResult({
    job: wf1.job,
    artwork: wf1.artwork,
    imageBlob: makePngBlob('target-art'),
  });

  // Also link prjShared to wf1.sourceAsset (shared sourceAsset & shared assetBlob scenario)
  const sharedProjRes = await storage.getProjectById(prjShared.data.id);
  assert.ok(sharedProjRes.ok && sharedProjRes.data);
  const sharedProjectUpdated: Project = {
    ...sharedProjRes.data,
    sourceAssetId: wf1.sourceAsset.id,
  };
  await storage.saveProject(sharedProjectUpdated);

  // Give prj2 its own isolated workflow + delete its source blob manually to simulate missing/orphaned blob safety
  const wf2 = createFullWorkflowRecords(prj2.data.id, 'Sibling Unrelated Project');
  await storage.saveOrReplaceProjectSourceAsset({
    projectId: prj2.data.id,
    validatedAsset: wf2.sourceAsset,
    binaryBlob: makePngBlob('sibling-src'),
  });
  await storage.saveAnalysisAndInitialDescription({
    projectId: prj2.data.id,
    analysis: wf2.analysis,
    description: wf2.description,
  });
  await storage.savePromptDocumentRevision(wf2.prompt);
  await storage.saveGeneratedArtworkResult({
    job: wf2.job,
    artwork: wf2.artwork,
    imageBlob: makePngBlob('sibling-art'),
  });

  // Simulate missing artwork blob on prj1 before deletion to ensure delete handles missing/orphaned Blobs gracefully
  await gateway.getStore('assetBlobs').delete(wf1.artwork.localBlobKey);

  writeStoredActiveProjectId(prj1.data.id);
  const delRes = await storage.deleteProject(prj1.data.id);
  assert.equal(delRes.ok, true);
  assert.equal(readStoredActiveProjectId(), null);

  // Target project and its owned analyses/descriptions/prompts/jobs/artworks are gone
  const goneProject = await storage.getProjectById(prj1.data.id);
  assert.equal(goneProject.ok && goneProject.data, null);

  const allAnalyses = await gateway.getStore('objectAnalyses').listAll();
  const allDescriptions = await gateway.getStore('objectDescriptions').listAll();
  const allPrompts = await gateway.getStore('promptDocuments').listAll();
  const allJobs = await gateway.getStore('generationHistory').listAll();
  const allArtworks = await gateway.getStore('generatedArtworks').listAll();
  assert.ok(
    allAnalyses.ok &&
      allDescriptions.ok &&
      allPrompts.ok &&
      allJobs.ok &&
      allArtworks.ok,
  );
  assert.equal(
    allAnalyses.data.some((a) => a.projectId === prj1.data.id),
    false,
  );
  assert.equal(
    allDescriptions.data.some((d) => d.projectId === prj1.data.id),
    false,
  );
  assert.equal(
    allPrompts.data.some((p) => p.projectId === prj1.data.id),
    false,
  );
  assert.equal(
    allJobs.data.some((j) => j.projectId === prj1.data.id),
    false,
  );
  assert.equal(
    allArtworks.data.some((art) => art.projectId === prj1.data.id),
    false,
  );

  // Shared sourceAsset and shared assetBlob referenced by prjShared MUST NOT be deleted
  const sharedAssetStillPresent = await gateway
    .getStore('sourceAssets')
    .getById(wf1.sourceAsset.id);
  assert.ok(sharedAssetStillPresent.ok && sharedAssetStillPresent.data !== null);
  assert.ok(sharedAssetStillPresent.data.localBlobKey !== null);
  const sharedBlobStillPresent = await gateway
    .getStore('assetBlobs')
    .getById(sharedAssetStillPresent.data.localBlobKey);
  assert.equal(
    sharedBlobStillPresent.ok && sharedBlobStillPresent.data !== null,
    true,
  );

  // Sibling unrelated project remains 100% intact
  const siblingBundle = await storage.getProjectBundle(prj2.data.id);
  assert.equal(siblingBundle.ok, true);
  if (siblingBundle.ok && siblingBundle.data) {
    assert.equal(siblingBundle.data.project.title, 'Sibling Unrelated Project');
    assert.equal(siblingBundle.data.sourceAsset?.id, wf2.sourceAsset.id);
    assert.equal(siblingBundle.data.analyses.length, 1);
    assert.equal(siblingBundle.data.artworks.length, 1);
  }
});

test('Opening a project switches active project cleanly, persists across reload, and missing active ID recovers without auto-creating projects', async () => {
  const { storage } = setupEnvironment();

  const p1 = await storage.createProject({ title: 'Study One' });
  const p2 = await storage.createProject({ title: 'Study Two' });
  assert.ok(p1.ok && p2.ok);
  if (!p1.ok || !p2.ok) return;

  const wf1 = createFullWorkflowRecords(p1.data.id, 'Study One');
  await storage.saveOrReplaceProjectSourceAsset({
    projectId: p1.data.id,
    validatedAsset: wf1.sourceAsset,
    binaryBlob: makePngBlob('study-one'),
  });

  // p2 is active right after create; open p1 to switch cleanly
  assert.equal(readStoredActiveProjectId(), p2.data.id);
  const opened = await storage.openProject(p1.data.id);
  assert.equal(opened.ok, true);
  assert.equal(readStoredActiveProjectId(), p1.data.id);

  // Restore after simulated refresh selects p1 without mixing p2 data
  const restored = await storage.restoreActiveSourceAsset(readStoredActiveProjectId());
  assert.equal(restored.ok, true);
  if (restored.ok && restored.data) {
    assert.equal(restored.data.project.id, p1.data.id);
    assert.equal(restored.data.sourceAsset?.id, wf1.sourceAsset.id);
  }

  // Opening a non-existent project fails cleanly without auto-creating one
  const openMissing = await storage.openProject('prj_nonexistent_123');
  assert.equal(openMissing.ok, false);
  if (!openMissing.ok) {
    assert.equal(openMissing.error.code, 'NOT_FOUND');
  }
  const countBeforeMissing = (await storage.listProjects());
  assert.equal(countBeforeMissing.ok && countBeforeMissing.data.length, 2);

  // If localStorage points to a deleted project ID and no projects exist, restoreActiveSourceAsset returns null and creates 0 phantom projects
  await storage.deleteProject(p1.data.id);
  await storage.deleteProject(p2.data.id);
  writeStoredActiveProjectId('prj_deleted_ghost_999');

  const emptyRestore = await storage.restoreActiveSourceAsset(readStoredActiveProjectId());
  assert.equal(emptyRestore.ok, true);
  if (emptyRestore.ok) {
    assert.equal(emptyRestore.data, null);
  }
  const countAfterEmptyRestore = await storage.listProjects();
  assert.equal(countAfterEmptyRestore.ok && countAfterEmptyRestore.data.length, 0);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import type { ObjectAnalysis, SourceAsset } from '../../types/domain.ts';
import type { RawVisionAnalysisResult } from '../../types/providers.ts';
import { createEntityId, nowIsoTimestamp } from '../../utils/ids.ts';
import { BrowserProjectStorageService } from '../project-storage/browserProjectStorage.ts';
import { BrowserIndexedDbStorageGateway } from '../project-storage/indexedDbGateway.ts';
import {
  StudioObjectDescriptionService,
  areEditableFieldsEqual,
  buildPromptReadyObjectSummary,
  extractEditableFieldsFromAnalysis,
  extractEditableFieldsFromDescription,
  normalizeRawVisionToObjectAnalysis,
  parseDelimitedListInput,
  parseLineOrSemicolonListInput,
  validateEditableDescriptionFields,
} from './contract.ts';

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
  | { type: 'quota_on_put'; storeName: string }
  | { type: 'abort_after_puts' };

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
              true,
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
        return host.wrapTransaction(backing, list, mode, false);
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
          if (isAborted()) {
            return;
          }
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
          entry.records.set(key, structuredClone(value));
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
          if (isAborted()) {
            return;
          }
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
        if (finished || aborted) {
          return;
        }
        aborted = true;
        finished = true;
        for (const [name, priorRecords] of snapshot.entries()) {
          const store = backing.stores.get(name);
          if (store) {
            store.records = priorRecords;
          }
        }
        tx.error = tx.error ?? new DOMException('Transaction aborted', 'AbortError');
        queueMicrotask(() => {
          if (typeof tx.onabort === 'function') {
            (tx.onabort as (ev: Event) => void)({ target: tx } as unknown as Event);
          }
        });
      },
      objectStore(name: string) {
        const entry = backing.stores.get(name);
        if (!entry) {
          throw new DOMException(`Store ${name} not found`, 'NotFoundError');
        }
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
      if (aborted || finished || isUpgrade || pendingOps > 0) {
        return;
      }
      if (!scheduledComplete) {
        scheduledComplete = true;
        queueMicrotask(() => {
          if (aborted || finished || pendingOps > 0) {
            return;
          }
          if (host.fault.type === 'abort_after_puts' && mode === 'readwrite') {
            tx.error = new DOMException('Transaction aborted at commit', 'AbortError');
            (tx.abort as () => void)();
            return;
          }
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

function makeValidatedSourceAsset(
  projectId: string,
  fileName = 'stoneware-pitcher.png',
): { asset: SourceAsset; blob: Blob } {
  const now = nowIsoTimestamp();
  const payload = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
  return {
    asset: {
      id: createEntityId('src'),
      projectId,
      originalFileName: fileName,
      mimeType: 'image/png',
      fileExtension: 'png',
      fileSizeBytes: payload.byteLength,
      width: 1024,
      height: 1024,
      aspectRatio: { widthRatio: 1, heightRatio: 1, label: '1:1', numeric: 1 },
      localBlobKey: null,
      validationStatus: 'validated',
      storageStatus: 'in_memory',
      createdAt: now,
      updatedAt: now,
    },
    blob: new Blob([payload], { type: 'image/png' }),
  };
}

function makeRawVisionResult(
  projectId: string,
  sourceAssetId: string,
): RawVisionAnalysisResult {
  return {
    requestStatus: 'succeeded',
    providerId: 'gemini',
    modelId: 'gemini-4-hydrogen',
    modelVersion: 'gemini-4-hydrogen-001',
    responseId: 'resp_test_001',
    analyzedAt: '2026-11-15T12:00:00.000Z',
    projectId,
    sourceAssetId,
    rawText: [
      '- **Main subject identity:** Hand-thrown stoneware pitcher with pouring spout',
      '- **Object or subject category:** Ceramic vessel / tableware',
      '- **Overall shape and silhouette:** Tapered cylindrical body with flared collar and arched loop handle',
      '- **Visible materials and textures:** Matte speckled stoneware clay, glossy cobalt drip glaze',
      '- **Dominant colors:** Warm ivory, cobalt blue, raw umber',
      '- **Surface details:** Fine wheel-throwing rings near the base and subtle speckles in the unglazed clay foot',
      '- **Distinctive visual features:** Asymmetric cobalt glaze drip along the upper rim; curved strap handle attached flush to neck',
      '- **Composition:** Centered single subject resting on a neutral studio plinth',
      '- **Camera angle or viewing perspective:** Eye-level three-quarter angle',
      '- **Visible background:** Soft neutral studio backdrop with diffused shadow',
      '- **Uncertain or ambiguous attributes:** Interior lining finish is not visible from this angle; underside maker mark cannot be confirmed',
    ].join('\n'),
    finishReason: 'STOP',
    usageMetadata: {
      promptTokenCount: 300,
      candidatesTokenCount: 150,
      totalTokenCount: 450,
    },
  };
}

test('1 & 6. Normalizes RawVisionAnalysisResult into immutable ObjectAnalysis and creates initial ObjectDescription without inventing certainty', () => {
  const projectId = createEntityId('prj');
  const sourceAssetId = createEntityId('src');
  const raw = makeRawVisionResult(projectId, sourceAssetId);

  const analysis = normalizeRawVisionToObjectAnalysis(raw);
  assert.ok(analysis.id.startsWith('anl_'));
  assert.equal(analysis.projectId, projectId);
  assert.equal(analysis.sourceAssetId, sourceAssetId);
  assert.equal(analysis.objectName, 'Hand-thrown stoneware pitcher');
  assert.equal(analysis.objectCategory, 'Ceramic vessel / tableware');
  assert.deepEqual(analysis.materials, [
    'Matte speckled stoneware clay',
    'glossy cobalt drip glaze',
  ]);
  assert.equal(analysis.materials.length, 2);
  assert.equal(analysis.dominantColors.length, 3);
  assert.equal(analysis.uncertainAttributes.length, 2);
  assert.match(analysis.uncertainAttributes[0], /Interior lining finish/i);

  // Confirm no credential-like keys exist in persisted ObjectAnalysis
  assert.equal('usageMetadata' in analysis, false);

  const descService = new StudioObjectDescriptionService();
  const created = descService.createFromAnalysis(analysis);
  assert.equal(created.ok, true);
  if (!created.ok) return;

  assert.ok(created.data.id.startsWith('dsc_'));
  assert.equal(created.data.analysisId, analysis.id);
  assert.equal(created.data.sourceAssetId, sourceAssetId);
  assert.equal(created.data.version, 1);
  assert.equal(created.data.objectName, analysis.objectName);
  assert.equal(created.data.objectCategory, analysis.objectCategory);
  assert.deepEqual(created.data.uncertainAttributes, analysis.uncertainAttributes);
});

test('2, 3 & 4. Saves edited ObjectDescription to IndexedDB while preserving Original AI Analysis unchanged and restores across reload', async () => {
  const backing = new TestIdbBackingStore();
  const projectId = createEntityId('prj');
  const { asset, blob } = makeValidatedSourceAsset(projectId);
  const descService = new StudioObjectDescriptionService();

  let savedAnalysisId = '';
  let savedDescriptionId = '';

  {
    const gateway1 = new BrowserIndexedDbStorageGateway(backing.createFactory());
    const storage1 = new BrowserProjectStorageService(gateway1);
    await storage1.saveOrReplaceProjectSourceAsset({
      projectId,
      validatedAsset: asset,
      binaryBlob: blob,
    });

    const raw = makeRawVisionResult(projectId, asset.id);
    const analysis = normalizeRawVisionToObjectAnalysis(raw);
    const initialDesc = descService.createFromAnalysis(analysis);
    assert.equal(initialDesc.ok, true);
    if (!initialDesc.ok) return;

    const persistInit = await storage1.saveAnalysisAndInitialDescription({
      projectId,
      analysis,
      description: initialDesc.data,
    });
    assert.equal(persistInit.ok, true);
    if (!persistInit.ok) return;
    savedAnalysisId = persistInit.data.analysis.id;
    savedDescriptionId = persistInit.data.description.id;

    // User edits multiple fields
    const editedResult = descService.normalizeAndValidate({
      projectId,
      analysis: persistInit.data.analysis,
      existingDescription: persistInit.data.description,
      draft: {
        objectName: 'Artisan Cobalt-Glazed Pitcher',
        primaryDescription:
          'Refined wheel-thrown stoneware pitcher featuring a hand-poured cobalt rim glaze and exposed clay foot.',
        materials: ['stoneware clay', 'cobalt glaze', 'clear interior slip'],
        surfaceDetails: 'Subtle horizontal throwing ribs on lower third.',
      },
    });
    assert.equal(editedResult.ok, true);
    if (!editedResult.ok) return;
    assert.equal(editedResult.data.version, 2);

    const saveEdited = await storage1.saveEditedObjectDescription(
      editedResult.data,
    );
    assert.equal(saveEdited.ok, true);
    await gateway1.close();
  }

  // Fresh gateway simulating browser reload
  const gateway2 = new BrowserIndexedDbStorageGateway(backing.createFactory());
  const storage2 = new BrowserProjectStorageService(gateway2);
  const restored = await storage2.getProjectObjectAnalysisState(projectId);
  assert.equal(restored.ok, true);
  if (!restored.ok || !restored.data) return;

  assert.equal(restored.data.analysis?.id, savedAnalysisId);
  // Original AI analysis MUST remain untouched!
  assert.equal(restored.data.analysis?.objectName, 'Hand-thrown stoneware pitcher');
  assert.equal(restored.data.analysis?.materials.length, 2);

  // Edited description MUST reflect saved revisions
  assert.equal(restored.data.description?.id, savedDescriptionId);
  assert.equal(restored.data.description?.version, 2);
  assert.equal(
    restored.data.description?.objectName,
    'Artisan Cobalt-Glazed Pitcher',
  );
  assert.deepEqual(restored.data.description?.materials, [
    'stoneware clay',
    'cobalt glaze',
    'clear interior slip',
  ]);
  assert.equal(
    restored.data.description?.surfaceDetails,
    'Subtle horizontal throwing ribs on lower third.',
  );
});

test('5. Validation prevents saving empty required fields and preserves dirty detection helpers', () => {
  const projectId = createEntityId('prj');
  const sourceAssetId = createEntityId('src');
  const analysis: ObjectAnalysis = normalizeRawVisionToObjectAnalysis(
    makeRawVisionResult(projectId, sourceAssetId),
  );
  const descService = new StudioObjectDescriptionService();
  const created = descService.createFromAnalysis(analysis);
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const invalid = descService.normalizeAndValidate({
    projectId,
    analysis,
    existingDescription: created.data,
    draft: {
      objectName: '   ',
      objectCategory: '',
      primaryDescription: '\n\t ',
    },
  });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) {
    assert.equal(invalid.error.code, 'VALIDATION_ERROR');
    assert.ok(invalid.error.details?.objectNameError);
    assert.ok(invalid.error.details?.objectCategoryError);
    assert.ok(invalid.error.details?.primaryDescriptionError);
  }

  const baseFields = extractEditableFieldsFromDescription(created.data);
  const modifiedFields = { ...baseFields, objectName: 'Edited Pitcher' };
  assert.equal(areEditableFieldsEqual(baseFields, baseFields), true);
  assert.equal(areEditableFieldsEqual(baseFields, modifiedFields), false);

  const checkValid = validateEditableDescriptionFields(modifiedFields);
  assert.equal(checkValid.valid, true);
});

test('7 & 8. Reset to AI Analysis restores original AI values without mutating ObjectAnalysis and persists across reload', async () => {
  const backing = new TestIdbBackingStore();
  const projectId = createEntityId('prj');
  const { asset, blob } = makeValidatedSourceAsset(projectId);
  const descService = new StudioObjectDescriptionService();

  const gateway1 = new BrowserIndexedDbStorageGateway(backing.createFactory());
  const storage1 = new BrowserProjectStorageService(gateway1);
  await storage1.saveOrReplaceProjectSourceAsset({
    projectId,
    validatedAsset: asset,
    binaryBlob: blob,
  });

  const analysis = normalizeRawVisionToObjectAnalysis(
    makeRawVisionResult(projectId, asset.id),
  );
  const initialDesc = descService.createFromAnalysis(analysis);
  assert.equal(initialDesc.ok, true);
  if (!initialDesc.ok) return;

  await storage1.saveAnalysisAndInitialDescription({
    projectId,
    analysis,
    description: initialDesc.data,
  });

  const edited = descService.normalizeAndValidate({
    projectId,
    analysis,
    existingDescription: initialDesc.data,
    draft: {
      objectName: 'Completely Custom Name',
      viewingAngle: 'Top-down flatlay',
      materials: ['porcelain'],
    },
  });
  assert.equal(edited.ok, true);
  if (!edited.ok) return;
  await storage1.saveEditedObjectDescription(edited.data);

  // Reset to Original AI Analysis
  const reset = descService.resetFromAnalysis(analysis, edited.data);
  assert.equal(reset.ok, true);
  if (!reset.ok) return;
  assert.equal(reset.data.version, 3);
  assert.equal(reset.data.objectName, analysis.objectName);
  assert.equal(reset.data.viewingAngle, analysis.viewingAngle);
  assert.deepEqual(reset.data.materials, analysis.materials);

  const persistReset = await storage1.resetObjectDescriptionFromAnalysis({
    projectId,
    analysisId: analysis.id,
    resetDescription: reset.data,
  });
  assert.equal(persistReset.ok, true);
  await gateway1.close();

  // Reload verification
  const gateway2 = new BrowserIndexedDbStorageGateway(backing.createFactory());
  const storage2 = new BrowserProjectStorageService(gateway2);
  const restored = await storage2.getProjectObjectAnalysisState(projectId);
  assert.equal(restored.ok, true);
  if (!restored.ok || !restored.data || !restored.data.description) return;

  assert.equal(restored.data.description.version, 3);
  assert.equal(
    areEditableFieldsEqual(
      extractEditableFieldsFromDescription(restored.data.description),
      extractEditableFieldsFromAnalysis(analysis),
    ),
    true,
  );
  assert.equal(restored.data.analysis?.id, analysis.id);
});

test('9, 10 & 11. Handles storage quota/abort failures cleanly, resets analysis on asset replace/remove, and isolates unrelated projects', async () => {
  const backing = new TestIdbBackingStore();
  const gateway = new BrowserIndexedDbStorageGateway(backing.createFactory());
  const storage = new BrowserProjectStorageService(gateway);
  const descService = new StudioObjectDescriptionService();

  const projectA = createEntityId('prj');
  const projectB = createEntityId('prj');
  const assetA = makeValidatedSourceAsset(projectA, 'a.png');
  const assetB = makeValidatedSourceAsset(projectB, 'b.png');

  await storage.saveOrReplaceProjectSourceAsset({
    projectId: projectA,
    validatedAsset: assetA.asset,
    binaryBlob: assetA.blob,
  });
  await storage.saveOrReplaceProjectSourceAsset({
    projectId: projectB,
    validatedAsset: assetB.asset,
    binaryBlob: assetB.blob,
  });

  const analysisA = normalizeRawVisionToObjectAnalysis(
    makeRawVisionResult(projectA, assetA.asset.id),
  );
  const descA = descService.createFromAnalysis(analysisA);
  const analysisB = normalizeRawVisionToObjectAnalysis(
    makeRawVisionResult(projectB, assetB.asset.id),
  );
  const descB = descService.createFromAnalysis(analysisB);
  assert.equal(descA.ok && descB.ok, true);
  if (!descA.ok || !descB.ok) return;

  await storage.saveAnalysisAndInitialDescription({
    projectId: projectA,
    analysis: analysisA,
    description: descA.data,
  });
  await storage.saveAnalysisAndInitialDescription({
    projectId: projectB,
    analysis: analysisB,
    description: descB.data,
  });

  // Inject QuotaExceededError when attempting to save edited description for Project A
  backing.fault = { type: 'quota_on_put', storeName: 'objectDescriptions' };
  const editedA = descService.normalizeAndValidate({
    projectId: projectA,
    analysis: analysisA,
    existingDescription: descA.data,
    draft: { objectName: 'Should Rollback' },
  });
  assert.equal(editedA.ok, true);
  if (!editedA.ok) return;

  const failedSave = await storage.saveEditedObjectDescription(editedA.data);
  assert.equal(failedSave.ok, false);
  if (!failedSave.ok) {
    assert.equal(failedSave.error.code, 'STORAGE_ERROR');
    assert.equal(failedSave.error.details?.reason, 'quota_exceeded');
  }
  backing.fault = { type: 'none' };

  // Project A's previously persisted description remains intact
  const restoredA = await storage.getProjectObjectAnalysisState(projectA);
  assert.equal(restoredA.ok, true);
  if (restoredA.ok && restoredA.data) {
    assert.equal(
      restoredA.data.description?.objectName,
      'Hand-thrown stoneware pitcher',
    );
  }

  // Replace Project A's source asset -> clears Project A's stale analysis/description, leaves Project B untouched
  const replacementA = makeValidatedSourceAsset(projectA, 'a-new.png');
  await storage.saveOrReplaceProjectSourceAsset({
    projectId: projectA,
    validatedAsset: replacementA.asset,
    binaryBlob: replacementA.blob,
  });

  const postReplaceA = await storage.getProjectObjectAnalysisState(projectA);
  assert.equal(postReplaceA.ok, true);
  if (postReplaceA.ok && postReplaceA.data) {
    assert.equal(postReplaceA.data.analysis, null);
    assert.equal(postReplaceA.data.description, null);
    assert.equal(postReplaceA.data.project.activeAnalysisId, null);
    assert.equal(postReplaceA.data.project.activeDescriptionId, null);
  }

  const postReplaceB = await storage.getProjectObjectAnalysisState(projectB);
  assert.equal(postReplaceB.ok, true);
  if (postReplaceB.ok && postReplaceB.data) {
    assert.equal(postReplaceB.data.analysis?.id, analysisB.id);
    assert.equal(postReplaceB.data.description?.id, descB.data.id);
  }
});

test('12. Parses list inputs cleanly and exposes Phase 03 Prompt Composer summary without leaking credentials or images', () => {
  assert.deepEqual(
    parseDelimitedListInput('Stoneware, cobalt glaze, stoneware , matte slip'),
    ['Stoneware', 'cobalt glaze', 'matte slip'],
  );
  assert.deepEqual(
    parseLineOrSemicolonListInput('- Curved handle\n- Flared rim; Cobalt drip'),
    ['Curved handle', 'Flared rim', 'Cobalt drip'],
  );

  const projectId = createEntityId('prj');
  const sourceAssetId = createEntityId('src');
  const analysis = normalizeRawVisionToObjectAnalysis(
    makeRawVisionResult(projectId, sourceAssetId),
  );
  const descService = new StudioObjectDescriptionService();
  const created = descService.createFromAnalysis(analysis);
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const summary = buildPromptReadyObjectSummary(created.data);
  assert.equal(summary.descriptionId, created.data.id);
  assert.equal(summary.analysisId, analysis.id);
  assert.equal(summary.objectName, created.data.objectName);
  assert.equal('blob' in summary, false);
  assert.equal('imageBytes' in summary, false);
});

test('13. Normalizes combined Gemini 4 Vision headings cleanly with lossless editor round-trip', () => {
  const projectId = createEntityId('prj');
  const sourceAssetId = createEntityId('src');
  const rawCombined: RawVisionAnalysisResult = {
    requestStatus: 'succeeded',
    providerId: 'gemini',
    modelId: 'gemini-4-hydrogen',
    analyzedAt: '2026-11-15T20:36:17.000Z',
    projectId,
    sourceAssetId,
    rawText: [
      '**Main Subject & Category:**',
      'A 2D digital illustration of a mug (drinkware).',
      '',
      '**Shape & Silhouette:**',
      'The mug has a tall, slightly barrel-shaped body with gently curved sides.',
      '',
      '**Colors & Surface Details:**',
      '* **Body:** Light beige/cream fill with a muted taupe outline.',
      '* **Top Accent:** A bright royal blue color block dips down from the front rim.',
      '* **Textures:** Flat, solid color fills with no visible surface texture, consistent with a minimalist vector-style illustration.',
      '',
      '**Composition & Perspective:**',
      'The mug is centered in the frame. It is viewed from a slightly elevated front angle.',
      '',
      '**Background:**',
      'A plain, solid off-white/cream background.',
      '',
      '**Ambiguous Attributes:**',
      'Because this is a stylized 2D illustration, the intended physical material cannot be determined.',
    ].join('\n'),
  };

  const analysis = normalizeRawVisionToObjectAnalysis(rawCombined);
  assert.equal(analysis.objectName, 'Mug');
  assert.equal(analysis.objectCategory, 'Drinkware');
  assert.equal(
    analysis.primaryDescription,
    'A 2D digital illustration of a mug (drinkware).',
  );
  assert.ok(!analysis.primaryDescription.includes('**'));
  assert.ok(analysis.dominantColors.length >= 2);
  assert.ok(analysis.surfaceDetails.includes('Body: Light beige/cream'));
  assert.equal(
    analysis.viewingAngle,
    'It is viewed from a slightly elevated front angle.',
  );
  assert.equal(analysis.uncertainAttributes.length, 1);

  const descService = new StudioObjectDescriptionService();
  const created = descService.createFromAnalysis(analysis);
  assert.equal(created.ok, true);
  if (!created.ok) return;

  // Verify round-trip through delimited/multi-line formatting produces zero false dirty state
  const roundTripped = {
    ...extractEditableFieldsFromDescription(created.data),
    materials: parseDelimitedListInput(created.data.materials.join(', ')),
    dominantColors: parseDelimitedListInput(created.data.dominantColors.join(', ')),
    distinctiveFeatures: parseLineOrSemicolonListInput(
      created.data.distinctiveFeatures.join('\n'),
    ),
    preservationPriorities: parseLineOrSemicolonListInput(
      created.data.preservationPriorities.join('\n'),
    ),
    uncertainAttributes: parseLineOrSemicolonListInput(
      created.data.uncertainAttributes.join('\n'),
    ),
  };

  assert.equal(
    areEditableFieldsEqual(
      roundTripped,
      extractEditableFieldsFromDescription(created.data),
    ),
    true,
  );
});

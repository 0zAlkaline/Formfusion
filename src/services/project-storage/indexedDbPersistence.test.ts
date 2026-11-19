import assert from 'node:assert/strict';
import test from 'node:test';
import type { SourceAsset } from '../../types/domain';
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
  | { type: 'quota_on_put'; storeName: string }
  | { type: 'abort_on_put'; storeName: string }
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
              true,
            );
            req.transaction = upgradeTx;
            if (typeof req.onupgradeneeded === 'function') {
              (req.onupgradeneeded as (ev: IDBVersionChangeEvent) => void)({
                target: req,
              } as unknown as IDBVersionChangeEvent);
            }
            // Ensure newly created stores are reflected
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

    const indexNamesList = () => ({
      contains: (name: string) => entry.indexes.has(name),
    });

    const handle: Record<string, unknown> = {
      name: storeName,
      indexNames: indexNamesList(),
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
          if (
            host.fault.type === 'abort_on_put' &&
            host.fault.storeName === storeName
          ) {
            const err = new DOMException('Write aborted', 'AbortError');
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
    // Snapshot all target stores for true atomic rollback on abort
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
        // Rollback
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
      // Allow initial synchronous + one microtask turn for chained requests
      queueMicrotask(() => {
        setTimeout(() => checkFinish(), 5);
      });
    }

    return tx as unknown as IDBTransaction;
  }
}

function makeValidatedSourceAsset(
  projectId: string,
  fileName: string,
  mimeType: SourceAsset['mimeType'],
  bytes: Uint8Array,
  width = 640,
  height = 480,
): { asset: SourceAsset; blob: Blob } {
  const now = nowIsoTimestamp();
  const ext =
    mimeType === 'image/png'
      ? 'png'
      : mimeType === 'image/webp'
        ? 'webp'
        : 'jpg';
  const asset: SourceAsset = {
    id: createEntityId('src'),
    projectId,
    originalFileName: fileName,
    mimeType,
    fileExtension: ext,
    fileSizeBytes: bytes.byteLength,
    width,
    height,
    aspectRatio: {
      widthRatio: 4,
      heightRatio: 3,
      label: '4:3',
      numeric: Number((width / height).toFixed(4)),
    },
    checksumSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    localBlobKey: null,
    validationStatus: 'validated',
    storageStatus: 'in_memory',
    createdAt: now,
    updatedAt: now,
  };
  return {
    asset,
    blob: new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], {
      type: mimeType,
    }),
  };
}

test('1-4. Saves and retrieves image Blob and SourceAsset metadata cleanly', async () => {
  const backing = new InMemoryIdbBackingStore();
  const gateway = new BrowserIndexedDbStorageGateway(backing.createFactory());
  const storage = new BrowserProjectStorageService(gateway);

  assert.equal(gateway.isAvailable(), true);
  assert.equal(gateway.isPersistent(), true);

  const projectId = createEntityId('prj');
  const payload = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6]);
  const { asset, blob } = makeValidatedSourceAsset(
    projectId,
    'ceramic-vase.png',
    'image/png',
    payload,
  );

  const saveRes = await storage.saveOrReplaceProjectSourceAsset({
    projectId,
    validatedAsset: asset,
    binaryBlob: blob,
  });

  assert.equal(saveRes.ok, true);
  if (!saveRes.ok) return;

  assert.equal(saveRes.data.project.id, projectId);
  assert.equal(saveRes.data.project.sourceAssetId, asset.id);
  assert.equal(saveRes.data.sourceAsset.storageStatus, 'persisted');
  assert.ok(saveRes.data.sourceAsset.localBlobKey?.startsWith('blb_'));

  const getRes = await storage.getProjectSourceAsset(projectId);
  assert.equal(getRes.ok, true);
  if (!getRes.ok || !getRes.data) return;

  assert.equal(getRes.data.sourceAsset?.id, asset.id);
  assert.equal(getRes.data.sourceAsset?.originalFileName, 'ceramic-vase.png');
  assert.equal(getRes.data.sourceAsset?.width, 640);
  assert.equal(getRes.data.sourceAsset?.height, 480);
  assert.equal(getRes.data.sourceAsset?.storageStatus, 'persisted');
  assert.ok(getRes.data.blob);

  const restoredBytes = new Uint8Array(await getRes.data.blob!.arrayBuffer());
  assert.deepEqual(restoredBytes, payload);
});

test('5. Restores active project, metadata, and Blob across simulated page reload', async () => {
  const backing = new InMemoryIdbBackingStore();
  const projectId = createEntityId('prj');
  const payload = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 10, 20, 30, 40]);

  {
    const gateway1 = new BrowserIndexedDbStorageGateway(backing.createFactory());
    const storage1 = new BrowserProjectStorageService(gateway1);
    const { asset, blob } = makeValidatedSourceAsset(
      projectId,
      'lamp-study.jpg',
      'image/jpeg',
      payload,
      1024,
      768,
    );
    const saveRes = await storage1.saveOrReplaceProjectSourceAsset({
      projectId,
      validatedAsset: asset,
      binaryBlob: blob,
    });
    assert.equal(saveRes.ok, true);
    await gateway1.close();
  }

  // Fresh gateway & service instance simulating browser reload
  const gateway2 = new BrowserIndexedDbStorageGateway(backing.createFactory());
  const storage2 = new BrowserProjectStorageService(gateway2);
  const restored = await storage2.restoreActiveSourceAsset(projectId);

  assert.equal(restored.ok, true);
  if (!restored.ok || !restored.data) return;

  assert.equal(restored.data.project.id, projectId);
  assert.equal(restored.data.sourceAsset?.originalFileName, 'lamp-study.jpg');
  assert.equal(restored.data.sourceAsset?.mimeType, 'image/jpeg');
  assert.equal(restored.data.sourceAsset?.width, 1024);
  assert.equal(restored.data.sourceAsset?.height, 768);
  assert.equal(restored.data.sourceAsset?.storageStatus, 'persisted');
  const restoredBytes = new Uint8Array(await restored.data.blob!.arrayBuffer());
  assert.deepEqual(restoredBytes, payload);
});

test('6. Replaces existing asset atomically and cleans up obsolete metadata & Blob', async () => {
  const backing = new InMemoryIdbBackingStore();
  const gateway = new BrowserIndexedDbStorageGateway(backing.createFactory());
  const storage = new BrowserProjectStorageService(gateway);

  const projectId = createEntityId('prj');
  const first = makeValidatedSourceAsset(
    projectId,
    'first.png',
    'image/png',
    new Uint8Array([1, 2, 3, 4]),
  );
  const save1 = await storage.saveOrReplaceProjectSourceAsset({
    projectId,
    validatedAsset: first.asset,
    binaryBlob: first.blob,
  });
  assert.equal(save1.ok, true);
  if (!save1.ok) return;
  const oldBlobKey = save1.data.sourceAsset.localBlobKey!;

  const second = makeValidatedSourceAsset(
    projectId,
    'second.webp',
    'image/webp',
    new Uint8Array([9, 8, 7, 6, 5]),
    800,
    600,
  );
  const save2 = await storage.saveOrReplaceProjectSourceAsset({
    projectId,
    validatedAsset: second.asset,
    binaryBlob: second.blob,
  });
  assert.equal(save2.ok, true);
  if (!save2.ok) return;
  assert.equal(save2.data.replacedAssetId, first.asset.id);

  // Obsolete asset & blob must be removed (no orphans)
  const oldAssetLookup = await gateway.getStore('sourceAssets').getById(first.asset.id);
  const oldBlobLookup = await gateway.getStore('assetBlobs').getById(oldBlobKey);
  assert.equal(oldAssetLookup.ok && oldAssetLookup.data, null);
  assert.equal(oldBlobLookup.ok && oldBlobLookup.data, null);

  // New asset & blob must be active
  const current = await storage.getProjectSourceAsset(projectId);
  assert.equal(current.ok, true);
  if (current.ok && current.data) {
    assert.equal(current.data.sourceAsset?.id, second.asset.id);
    assert.equal(current.data.sourceAsset?.originalFileName, 'second.webp');
  }
});

test('7 & 9. QuotaExceededError during replacement preserves previous valid asset intact', async () => {
  const backing = new InMemoryIdbBackingStore();
  const gateway = new BrowserIndexedDbStorageGateway(backing.createFactory());
  const storage = new BrowserProjectStorageService(gateway);

  const projectId = createEntityId('prj');
  const first = makeValidatedSourceAsset(
    projectId,
    'original.png',
    'image/png',
    new Uint8Array([11, 22, 33, 44]),
  );
  const save1 = await storage.saveOrReplaceProjectSourceAsset({
    projectId,
    validatedAsset: first.asset,
    binaryBlob: first.blob,
  });
  assert.equal(save1.ok, true);
  if (!save1.ok) return;

  // Inject QuotaExceededError when writing new blob
  backing.fault = { type: 'quota_on_put', storeName: 'assetBlobs' };

  const second = makeValidatedSourceAsset(
    projectId,
    'oversized.png',
    'image/png',
    new Uint8Array([99, 98, 97, 96]),
  );
  const save2 = await storage.saveOrReplaceProjectSourceAsset({
    projectId,
    validatedAsset: second.asset,
    binaryBlob: second.blob,
  });

  assert.equal(save2.ok, false);
  if (!save2.ok) {
    assert.equal(save2.error.code, 'STORAGE_ERROR');
    assert.equal(save2.error.details?.reason, 'quota_exceeded');
    assert.match(save2.error.message, /quota/i);
  }

  backing.fault = { type: 'none' };

  // Old asset, old blob, and project relationship must remain 100% intact
  const restored = await storage.getProjectSourceAsset(projectId);
  assert.equal(restored.ok, true);
  if (restored.ok && restored.data) {
    assert.equal(restored.data.sourceAsset?.id, first.asset.id);
    assert.equal(restored.data.sourceAsset?.originalFileName, 'original.png');
    assert.deepEqual(
      new Uint8Array(await restored.data.blob!.arrayBuffer()),
      new Uint8Array([11, 22, 33, 44]),
    );
  }

  const allAssets = await gateway.getStore('sourceAssets').listAll();
  assert.equal(allAssets.ok && allAssets.data.length, 1);
});

test('8. Removes active asset cleanly and clears project relationship without orphans', async () => {
  const backing = new InMemoryIdbBackingStore();
  const gateway = new BrowserIndexedDbStorageGateway(backing.createFactory());
  const storage = new BrowserProjectStorageService(gateway);

  const projectId = createEntityId('prj');
  const { asset, blob } = makeValidatedSourceAsset(
    projectId,
    'remove-me.png',
    'image/png',
    new Uint8Array([5, 4, 3, 2]),
  );
  const saveRes = await storage.saveOrReplaceProjectSourceAsset({
    projectId,
    validatedAsset: asset,
    binaryBlob: blob,
  });
  assert.equal(saveRes.ok, true);
  if (!saveRes.ok) return;

  const removeRes = await storage.removeProjectSourceAsset(projectId);
  assert.equal(removeRes.ok, true);
  if (removeRes.ok) {
    assert.equal(removeRes.data?.sourceAssetId, null);
  }

  const allAssets = await gateway.getStore('sourceAssets').listAll();
  const allBlobs = await gateway.getStore('assetBlobs').listAll();
  assert.equal(allAssets.ok && allAssets.data.length, 0);
  assert.equal(allBlobs.ok && allBlobs.data.length, 0);

  const restored = await storage.restoreActiveSourceAsset(projectId);
  assert.equal(restored.ok, true);
  if (restored.ok && restored.data) {
    assert.equal(restored.data.sourceAsset, null);
    assert.equal(restored.data.blob, null);
  }
});

test('10. Transaction abort failure rolls back all writes and never reports persisted', async () => {
  const backing = new InMemoryIdbBackingStore();
  const gateway = new BrowserIndexedDbStorageGateway(backing.createFactory());
  const storage = new BrowserProjectStorageService(gateway);

  backing.fault = { type: 'abort_after_puts' };

  const projectId = createEntityId('prj');
  const { asset, blob } = makeValidatedSourceAsset(
    projectId,
    'aborted.png',
    'image/png',
    new Uint8Array([7, 7, 7, 7]),
  );
  const saveRes = await storage.saveOrReplaceProjectSourceAsset({
    projectId,
    validatedAsset: asset,
    binaryBlob: blob,
  });

  assert.equal(saveRes.ok, false);
  if (!saveRes.ok) {
    assert.equal(saveRes.error.code, 'STORAGE_ERROR');
    assert.equal(saveRes.error.details?.reason, 'transaction_aborted');
  }

  backing.fault = { type: 'none' };

  const projects = await gateway.getStore('projects').listAll();
  const assets = await gateway.getStore('sourceAssets').listAll();
  const blobs = await gateway.getStore('assetBlobs').listAll();
  assert.equal(projects.ok && projects.data.length, 0);
  assert.equal(assets.ok && assets.data.length, 0);
  assert.equal(blobs.ok && blobs.data.length, 0);
});

test('11. Handles missing/unreadable Blob and unavailable IndexedDB gracefully', async () => {
  // Unavailable IndexedDB
  const unavailableGateway = new BrowserIndexedDbStorageGateway(null);
  assert.equal(unavailableGateway.isAvailable(), false);
  assert.equal(unavailableGateway.isPersistent(), false);
  const unavailableStorage = new BrowserProjectStorageService(unavailableGateway);
  const unavailableRes = await unavailableStorage.restoreActiveSourceAsset(null);
  assert.equal(unavailableRes.ok, false);
  if (!unavailableRes.ok) {
    assert.equal(unavailableRes.error.details?.reason, 'storage_unavailable');
  }

  // Missing Blob record after metadata exists
  const backing = new InMemoryIdbBackingStore();
  const gateway = new BrowserIndexedDbStorageGateway(backing.createFactory());
  const storage = new BrowserProjectStorageService(gateway);

  const projectId = createEntityId('prj');
  const { asset, blob } = makeValidatedSourceAsset(
    projectId,
    'corrupted.png',
    'image/png',
    new Uint8Array([1, 3, 5, 7]),
  );
  const saveRes = await storage.saveOrReplaceProjectSourceAsset({
    projectId,
    validatedAsset: asset,
    binaryBlob: blob,
  });
  assert.equal(saveRes.ok, true);
  if (!saveRes.ok) return;

  // Delete underlying blob out-of-band to simulate missing binary record
  await gateway.getStore('assetBlobs').delete(saveRes.data.sourceAsset.localBlobKey!);

  const restoreRes = await storage.restoreActiveSourceAsset(projectId);
  assert.equal(restoreRes.ok, false);
  if (!restoreRes.ok) {
    assert.equal(restoreRes.error.code, 'STORAGE_ERROR');
    assert.equal(restoreRes.error.details?.reason, 'missing_or_corrupted_asset');
  }
});

test('12. Preserves unrelated projects and assets during remove, replace, and bundle inspection', async () => {
  const backing = new InMemoryIdbBackingStore();
  const gateway = new BrowserIndexedDbStorageGateway(backing.createFactory());
  const storage = new BrowserProjectStorageService(gateway);

  const projectA = createEntityId('prj');
  const projectB = createEntityId('prj');

  const assetA = makeValidatedSourceAsset(
    projectA,
    'project-a.png',
    'image/png',
    new Uint8Array([1, 1, 1, 1]),
  );
  const assetB = makeValidatedSourceAsset(
    projectB,
    'project-b.jpg',
    'image/jpeg',
    new Uint8Array([2, 2, 2, 2]),
  );

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

  // Remove Project A's source asset -> Project B and its asset/blob must remain intact
  const removeARes = await storage.removeProjectSourceAsset(projectA);
  assert.equal(removeARes.ok, true);

  const bundleB = await storage.getProjectBundle(projectB);
  assert.equal(bundleB.ok, true);
  if (bundleB.ok && bundleB.data) {
    assert.equal(bundleB.data.project.id, projectB);
    assert.equal(bundleB.data.sourceAsset?.id, assetB.asset.id);
    assert.equal(bundleB.data.sourceAsset?.originalFileName, 'project-b.jpg');
  }

  const getB = await storage.getProjectSourceAsset(projectB);
  assert.equal(getB.ok, true);
  if (getB.ok && getB.data) {
    assert.deepEqual(
      new Uint8Array(await getB.data.blob!.arrayBuffer()),
      new Uint8Array([2, 2, 2, 2]),
    );
  }
});

test('13. Persists PromptDocument revisions, enforces generatedPrompt and approved immutability, preserves history, and restores across reload', async () => {
  const backing = new InMemoryIdbBackingStore();
  const factory = backing.createFactory();

  // First session: save project + source asset + analysis + description + prompt revisions
  const gateway1 = new BrowserIndexedDbStorageGateway(factory);
  const storage1 = new BrowserProjectStorageService(gateway1);
  const projectId = createEntityId('prj');
  const now = nowIsoTimestamp();

  const { asset, blob } = makeValidatedSourceAsset(
    projectId,
    'pitcher.png',
    'image/png',
    new Uint8Array([1, 2, 3, 4]),
  );
  const savedAsset = await storage1.saveOrReplaceProjectSourceAsset({
    projectId,
    validatedAsset: asset,
    binaryBlob: blob,
  });
  assert.equal(savedAsset.ok, true);

  const analysisId = createEntityId('anl');
  const descriptionId = createEntityId('dsc');
  const saveAnalysis = await storage1.saveAnalysisAndInitialDescription({
    projectId,
    analysis: {
      id: analysisId,
      projectId,
      sourceAssetId: asset.id,
      providerId: 'gemini',
      modelId: 'gemini-4-hydrogen',
      sceneSummary: 'Stoneware pitcher on neutral table.',
      detectedObjects: [],
      lightingNotes: 'Soft daylight.',
      compositionNotes: 'Centered three-quarter view.',
      objectName: 'Stoneware Pitcher',
      objectCategory: 'Ceramic Vessel',
      primaryDescription: 'A cream stoneware pitcher with cobalt rim.',
      shapeAndSilhouette: 'Tapered vessel.',
      materials: ['stoneware'],
      dominantColors: ['cream', 'cobalt'],
      surfaceDetails: 'Matte speckles.',
      distinctiveFeatures: ['Cobalt rim'],
      composition: 'Centered.',
      viewingAngle: 'Eye-level',
      preservationPriorities: ['Preserve silhouette'],
      uncertainAttributes: ['Back stamp unseen'],
      analyzedAt: now,
      createdAt: now,
      updatedAt: now,
    },
    description: {
      id: descriptionId,
      projectId,
      analysisId,
      sourceAssetId: asset.id,
      version: 1,
      objectName: 'Stoneware Pitcher',
      objectCategory: 'Ceramic Vessel',
      primaryDescription: 'A cream stoneware pitcher with cobalt rim.',
      shapeAndSilhouette: 'Tapered vessel.',
      materials: ['stoneware'],
      dominantColors: ['cream', 'cobalt'],
      surfaceDetails: 'Matte speckles.',
      distinctiveFeatures: ['Cobalt rim'],
      composition: 'Centered.',
      viewingAngle: 'Eye-level',
      preservationPriorities: ['Preserve silhouette'],
      uncertainAttributes: ['Back stamp unseen'],
      primarySubject: 'Stoneware Pitcher',
      environmentContext: 'Centered.',
      objects: [],
      moodAndAtmosphere: 'Soft daylight.',
      userNotes: '',
      isNormalized: true,
      createdAt: now,
      updatedAt: now,
    },
  });
  assert.equal(saveAnalysis.ok, true);

  const promptV1Id = createEntityId('prm');
  const promptV1 = {
    id: promptV1Id,
    promptId: promptV1Id,
    projectId,
    descriptionId,
    sourceDescriptionRevision: 1,
    styleId: null,
    selectedStyleId: null,
    userInstructions: 'Soft museum lighting.',
    creativeInstructions: 'Soft museum lighting.',
    generatedPrompt: 'Original AI-generated prompt v1 for stoneware pitcher.',
    finalPrompt: 'Original AI-generated prompt v1 for stoneware pitcher.',
    negativePrompt: 'harsh glare',
    approvalStatus: 'generated' as const,
    generatedAt: now,
    approvedAt: null,
    revision: 1,
    revisionNumber: 1,
    createdAt: now,
    updatedAt: now,
  };

  const savedV1 = await storage1.savePromptDocumentRevision(promptV1);
  assert.equal(savedV1.ok, true);
  if (!savedV1.ok) return;
  assert.equal(savedV1.data.project.status, 'prompt_ready');
  assert.equal(savedV1.data.project.activePromptId, promptV1Id);

  // Save edited finalPrompt on v1 (must keep generatedPrompt immutable)
  const savedV1Edited = await storage1.savePromptDocumentRevision({
    ...promptV1,
    finalPrompt: 'User-edited final prompt v1 with extra daylight warmth.',
    approvalStatus: 'edited',
    updatedAt: nowIsoTimestamp(),
  });
  assert.equal(savedV1Edited.ok, true);

  // Attempting to alter generatedPrompt on v1 in IndexedDB must fail
  const rejectedBaselineEdit = await storage1.savePromptDocumentRevision({
    ...promptV1,
    generatedPrompt: 'Altered baseline!',
    finalPrompt: 'User-edited final prompt v1 with extra daylight warmth.',
  });
  assert.equal(rejectedBaselineEdit.ok, false);

  // Approve v1
  const approvedV1 = await storage1.savePromptDocumentRevision({
    ...promptV1,
    finalPrompt: 'User-edited final prompt v1 with extra daylight warmth.',
    approvalStatus: 'approved',
    approvedAt: nowIsoTimestamp(),
    updatedAt: nowIsoTimestamp(),
  });
  assert.equal(approvedV1.ok, true);

  // Overwriting approved v1 in place must fail
  const overwriteApproved = await storage1.savePromptDocumentRevision({
    ...promptV1,
    finalPrompt: 'Silent overwrite attempt',
    approvalStatus: 'edited',
    approvedAt: null,
    updatedAt: nowIsoTimestamp(),
  });
  assert.equal(overwriteApproved.ok, false);

  // Save regenerated v2 -> v1 must remain preserved in revision history!
  const promptV2Id = createEntityId('prm');
  const savedV2 = await storage1.savePromptDocumentRevision({
    ...promptV1,
    id: promptV2Id,
    promptId: promptV2Id,
    generatedPrompt: 'Regenerated AI prompt v2 for stoneware pitcher.',
    finalPrompt: 'Regenerated AI prompt v2 for stoneware pitcher.',
    approvalStatus: 'generated',
    approvedAt: null,
    revision: 2,
    revisionNumber: 2,
    updatedAt: nowIsoTimestamp(),
  });
  assert.equal(savedV2.ok, true);
  if (savedV2.ok) {
    assert.equal(savedV2.data.revisions.length, 2);
  }

  // Simulate full reload with fresh service instance on same IndexedDB backing
  const gateway2 = new BrowserIndexedDbStorageGateway(factory);
  const storage2 = new BrowserProjectStorageService(gateway2);
  const restored = await storage2.getProjectPromptState(projectId);
  assert.equal(restored.ok, true);
  if (restored.ok && restored.data) {
    assert.equal(restored.data.activePrompt?.id, promptV2Id);
    assert.equal(restored.data.revisions.length, 2);
    const preservedV1 = restored.data.revisions.find((r) => r.id === promptV1Id);
    assert.ok(preservedV1);
    assert.equal(preservedV1.approvalStatus, 'approved');
    assert.equal(
      preservedV1.finalPrompt,
      'User-edited final prompt v1 with extra daylight warmth.',
    );
  }
});


import { errResult, okResult } from '../../types/common.ts';
import type { EntityId, ServiceResult } from '../../types/common.ts';
import { STORAGE_STORE_NAMES } from '../../types/storage.ts';
import type {
  IndexedDbStorageGateway,
  LocalStorageRepository,
  StorageFailureReason,
  StorageRecordMap,
  StorageSchemaDefinition,
  StorageStoreName,
  StorageTransactionContext,
  TransactionMode,
} from '../../types/storage.ts';
import {
  FORMFUSION_INDEXED_DB_SCHEMA,
  validateBasePersistedRecord,
} from './indexedDbContract.ts';

export interface ClassifiedStorageError {
  readonly reason: StorageFailureReason;
  readonly message: string;
}

export function classifyIndexedDbError(error: unknown): ClassifiedStorageError {
  const errObj =
    typeof error === 'object' && error !== null
      ? (error as { name?: unknown; code?: unknown; message?: unknown })
      : null;
  const name = typeof errObj?.name === 'string' ? errObj.name : '';
  const messageText = typeof errObj?.message === 'string' ? errObj.message : '';
  const code = typeof errObj?.code === 'number' ? errObj.code : -1;

  if (
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    code === 22 ||
    /quota/i.test(messageText)
  ) {
    return {
      reason: 'quota_exceeded',
      message:
        'Browser storage quota exceeded. Free up local storage space or remove an existing study before saving.',
    };
  }

  if (name === 'AbortError' || /abort/i.test(messageText)) {
    return {
      reason: 'transaction_aborted',
      message:
        'Storage transaction was aborted before completion. Existing persisted records were preserved.',
    };
  }

  if (
    name === 'ConstraintError' ||
    name === 'DataError' ||
    name === 'DataCloneError'
  ) {
    return {
      reason: 'constraint_or_validation',
      message:
        'Record could not be serialized or stored in IndexedDB due to a schema or data constraint.',
    };
  }

  if (
    name === 'SecurityError' ||
    name === 'InvalidStateError' ||
    name === 'VersionError'
  ) {
    return {
      reason: 'storage_unavailable',
      message:
        'Local IndexedDB storage is currently unavailable or blocked in this browser context.',
    };
  }

  return {
    reason: 'storage_error',
    message:
      'Local IndexedDB storage failed to complete the operation. No partial changes were committed.',
  };
}

export function resolveDefaultIndexedDbFactory(): IDBFactory | null {
  if (typeof globalThis === 'undefined' || !('indexedDB' in globalThis)) {
    return null;
  }
  return globalThis.indexedDB ?? null;
}

function applySchemaOnUpgrade(
  db: IDBDatabase,
  tx: IDBTransaction | null,
  schema: StorageSchemaDefinition,
): void {
  for (const storeDef of schema.stores) {
    let objectStore: IDBObjectStore;
    if (!db.objectStoreNames.contains(storeDef.storeName)) {
      objectStore = db.createObjectStore(storeDef.storeName, {
        keyPath: storeDef.keyPath,
      });
    } else if (tx) {
      objectStore = tx.objectStore(storeDef.storeName);
    } else {
      continue;
    }

    for (const indexDef of storeDef.indexes) {
      if (!objectStore.indexNames.contains(indexDef.name)) {
        objectStore.createIndex(
          indexDef.name,
          indexDef.keyPath as string | string[],
          { unique: indexDef.unique },
        );
      }
    }
  }
}

export type TransactionStoreMap<K extends StorageStoreName> = {
  readonly [P in K]: IDBObjectStore;
};

export interface TransactionExecutionControls<TResult> {
  readonly settle: (result: ServiceResult<TResult>) => void;
  readonly abortWithError: (error: unknown) => void;
  readonly abortWithMessage: (
    reason: StorageFailureReason,
    message: string,
  ) => void;
}

class IndexedDbStoreRepository<K extends StorageStoreName>
  implements LocalStorageRepository<K>
{
  readonly storeName: K;
  private readonly gateway: BrowserIndexedDbStorageGateway;

  constructor(gateway: BrowserIndexedDbStorageGateway, storeName: K) {
    this.gateway = gateway;
    this.storeName = storeName;
  }

  async getById(
    id: EntityId,
  ): Promise<ServiceResult<StorageRecordMap[K] | null>> {
    return this.gateway.executeTransaction(
      [this.storeName],
      'readonly',
      (stores, { settle, abortWithError }) => {
        const req = stores[this.storeName].get(id);
        req.onsuccess = () => {
          const result = req.result as StorageRecordMap[K] | undefined;
          settle(okResult(result ?? null));
        };
        req.onerror = () => abortWithError(req.error);
      },
    );
  }

  async listAll(): Promise<ServiceResult<readonly StorageRecordMap[K][]>> {
    return this.gateway.executeTransaction(
      [this.storeName],
      'readonly',
      (stores, { settle, abortWithError }) => {
        const req = stores[this.storeName].getAll();
        req.onsuccess = () => {
          const rows = (req.result as StorageRecordMap[K][] | undefined) ?? [];
          settle(okResult(rows));
        };
        req.onerror = () => abortWithError(req.error);
      },
    );
  }

  async put(
    record: StorageRecordMap[K],
  ): Promise<ServiceResult<StorageRecordMap[K]>> {
    const validated = validateBasePersistedRecord(this.storeName, record);
    if (!validated.ok) {
      return validated;
    }

    return this.gateway.executeTransaction(
      [this.storeName],
      'readwrite',
      (stores, { settle, abortWithError }) => {
        const req = stores[this.storeName].put(record);
        req.onsuccess = () => {
          settle(okResult(record));
        };
        req.onerror = () => abortWithError(req.error);
      },
    );
  }

  async delete(id: EntityId): Promise<ServiceResult<void>> {
    return this.gateway.executeTransaction(
      [this.storeName],
      'readwrite',
      (stores, { settle, abortWithError }) => {
        const req = stores[this.storeName].delete(id);
        req.onsuccess = () => {
          settle(okResult(undefined));
        };
        req.onerror = () => abortWithError(req.error);
      },
    );
  }
}

export class BrowserIndexedDbStorageGateway implements IndexedDbStorageGateway {
  readonly schema: StorageSchemaDefinition = FORMFUSION_INDEXED_DB_SCHEMA;
  private readonly idbFactory: IDBFactory | null;
  private openDbPromise: Promise<ServiceResult<IDBDatabase>> | null = null;

  constructor(idbFactory: IDBFactory | null = resolveDefaultIndexedDbFactory()) {
    this.idbFactory = idbFactory;
  }

  isAvailable(): boolean {
    return this.idbFactory !== null;
  }

  isPersistent(): boolean {
    return this.isAvailable();
  }

  getStore<K extends StorageStoreName>(
    storeName: K,
  ): LocalStorageRepository<K> {
    if (!STORAGE_STORE_NAMES.includes(storeName)) {
      throw new Error(`Unknown IndexedDB store: ${storeName}`);
    }
    return new IndexedDbStoreRepository(this, storeName);
  }

  async runInTransaction<TResult>(
    context: StorageTransactionContext,
    work: () => Promise<ServiceResult<TResult>>,
  ): Promise<ServiceResult<TResult>> {
    if (!this.isAvailable()) {
      return errResult(
        'STORAGE_ERROR',
        'Local IndexedDB storage is unavailable in this browser environment.',
        { reason: 'storage_unavailable' },
      );
    }
    const dbResult = await this.openDatabase();
    if (!dbResult.ok) {
      return dbResult;
    }
    for (const storeName of context.stores) {
      if (!dbResult.data.objectStoreNames.contains(storeName)) {
        return errResult(
          'STORAGE_ERROR',
          `IndexedDB object store "${storeName}" is missing from the local database.`,
          { reason: 'storage_error', storeName },
        );
      }
    }
    return work();
  }

  async close(): Promise<void> {
    if (!this.openDbPromise) {
      return;
    }
    const current = await this.openDbPromise;
    this.openDbPromise = null;
    if (current.ok) {
      current.data.close();
    }
  }

  async openDatabase(): Promise<ServiceResult<IDBDatabase>> {
    if (!this.idbFactory) {
      return errResult(
        'STORAGE_ERROR',
        'Local IndexedDB storage is unavailable in this browser environment.',
        { reason: 'storage_unavailable' },
      );
    }

    if (this.openDbPromise) {
      const existing = await this.openDbPromise;
      if (existing.ok) {
        return existing;
      }
      this.openDbPromise = null;
    }

    const factory = this.idbFactory;
    this.openDbPromise = new Promise<ServiceResult<IDBDatabase>>((resolve) => {
      let request: IDBOpenDBRequest;
      try {
        request = factory.open(this.schema.databaseName, this.schema.version);
      } catch (err) {
        const classified = classifyIndexedDbError(err);
        resolve(
          errResult('STORAGE_ERROR', classified.message, {
            reason: classified.reason,
          }),
        );
        return;
      }

      request.onupgradeneeded = () => {
        try {
          applySchemaOnUpgrade(
            request.result,
            request.transaction,
            this.schema,
          );
        } catch (err) {
          try {
            request.transaction?.abort();
          } catch {
            // Ignore secondary abort failures.
          }
          const classified = classifyIndexedDbError(err);
          resolve(
            errResult('STORAGE_ERROR', classified.message, {
              reason: classified.reason,
            }),
          );
        }
      };

      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          this.openDbPromise = null;
        };
        db.onclose = () => {
          this.openDbPromise = null;
        };
        resolve(okResult(db));
      };

      request.onerror = () => {
        this.openDbPromise = null;
        const classified = classifyIndexedDbError(request.error);
        resolve(
          errResult('STORAGE_ERROR', classified.message, {
            reason: classified.reason,
          }),
        );
      };

      request.onblocked = () => {
        this.openDbPromise = null;
        resolve(
          errResult(
            'STORAGE_ERROR',
            'IndexedDB database upgrade is blocked by another open tab.',
            { reason: 'storage_unavailable' },
          ),
        );
      };
    });

    return this.openDbPromise;
  }

  /**
   * Executes synchronous IndexedDB request chains inside a real transaction and
   * resolves ONLY after transaction.oncomplete commits. Any error or abort
   * guarantees rollback and returns a classified STORAGE_ERROR.
   */
  async executeTransaction<K extends StorageStoreName, TResult>(
    storeNames: readonly K[],
    mode: TransactionMode,
    executor: (
      stores: TransactionStoreMap<K>,
      controls: TransactionExecutionControls<TResult>,
    ) => void,
  ): Promise<ServiceResult<TResult>> {
    const dbResult = await this.openDatabase();
    if (!dbResult.ok) {
      return dbResult;
    }

    const db = dbResult.data;

    return new Promise<ServiceResult<TResult>>((resolve) => {
      let tx: IDBTransaction;
      try {
        tx = db.transaction(storeNames as unknown as string[], mode);
      } catch (err) {
        const classified = classifyIndexedDbError(err);
        resolve(
          errResult('STORAGE_ERROR', classified.message, {
            reason: classified.reason,
          }),
        );
        return;
      }

      const stores = {} as Record<K, IDBObjectStore>;
      for (const name of storeNames) {
        try {
          stores[name] = tx.objectStore(name);
        } catch (err) {
          const classified = classifyIndexedDbError(err);
          resolve(
            errResult('STORAGE_ERROR', classified.message, {
              reason: classified.reason,
            }),
          );
          return;
        }
      }

      let resolved = false;
      let pendingResult: ServiceResult<TResult> | null = null;
      let explicitFailure: ServiceResult<TResult> | null = null;

      const finish = (result: ServiceResult<TResult>) => {
        if (!resolved) {
          resolved = true;
          resolve(result);
        }
      };

      tx.oncomplete = () => {
        if (explicitFailure) {
          finish(explicitFailure);
          return;
        }
        if (pendingResult) {
          finish(pendingResult);
          return;
        }
        finish(
          errResult(
            'STORAGE_ERROR',
            'Storage transaction completed without producing a result.',
            { reason: 'storage_error' },
          ),
        );
      };

      tx.onabort = () => {
        if (explicitFailure) {
          finish(explicitFailure);
          return;
        }
        const classified = classifyIndexedDbError(
          tx.error ?? new DOMException('Transaction aborted', 'AbortError'),
        );
        finish(
          errResult('STORAGE_ERROR', classified.message, {
            reason: classified.reason,
          }),
        );
      };

      tx.onerror = () => {
        if (explicitFailure) {
          finish(explicitFailure);
          return;
        }
        const classified = classifyIndexedDbError(tx.error);
        finish(
          errResult('STORAGE_ERROR', classified.message, {
            reason: classified.reason,
          }),
        );
      };

      const controls: TransactionExecutionControls<TResult> = {
        settle: (result) => {
          pendingResult = result;
        },
        abortWithError: (error) => {
          const classified = classifyIndexedDbError(error);
          explicitFailure = errResult('STORAGE_ERROR', classified.message, {
            reason: classified.reason,
          });
          try {
            tx.abort();
          } catch {
            finish(explicitFailure);
          }
        },
        abortWithMessage: (reason, message) => {
          explicitFailure = errResult('STORAGE_ERROR', message, { reason });
          try {
            tx.abort();
          } catch {
            finish(explicitFailure);
          }
        },
      };

      try {
        executor(stores as TransactionStoreMap<K>, controls);
      } catch (err) {
        controls.abortWithError(err);
      }
    });
  }
}

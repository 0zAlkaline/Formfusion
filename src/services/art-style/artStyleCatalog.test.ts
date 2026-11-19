import assert from 'node:assert/strict';
import test from 'node:test';
import type { ArtStyle, Project, StyleCatalogItem } from '../../types/domain.ts';
import { INDEXED_DB_NAME } from '../../types/storage.ts';
import { createEntityId, nowIsoTimestamp } from '../../utils/ids.ts';
import { BrowserIndexedDbStorageGateway } from '../project-storage/indexedDbGateway.ts';
import { BrowserProjectStorageService } from '../project-storage/browserProjectStorage.ts';
import { StudioArtStyleService, buildFavoriteRecordId } from './artStyleService.ts';
import {
  CURATED_ART_STYLES,
  CURATED_STYLE_CATEGORIES,
  computeStyleCategoryCounts,
  filterAndSortStyleCatalog,
  formatArtStyleCategoryLabel,
  getCuratedStyleByIdSync,
  validateArtStyleRecord,
} from './curatedCatalog.ts';

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

class InMemoryIdbBackingStore {
  readonly dbs = new Map<string, DbBacking>();

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
        return host.makeStoreHandle(storeName, entry, () => false);
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
    scheduleWork?: (fn: () => void) => void,
  ): IDBObjectStore {
    const enqueue = scheduleWork ?? ((fn) => queueMicrotask(fn));

    const handle: Record<string, unknown> = {
      name: storeName,
      indexNames: {
        contains: (name: string) => entry.indexes.has(name),
      },
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

test('Curated catalog provides 12 distinct immutable styles across taxonomy categories', () => {
  assert.equal(CURATED_ART_STYLES.length, 12);

  const expectedNames = [
    'Flat Editorial Illustration',
    'Japanese Anime Background',
    'Geometric Editorial Illustration',
    'Retro Psychedelic Gradient',
    'Monoline Geometric Line Art',
    'Matisse Cut-Out Floral',
    'Bauhaus Geometric',
    'Vintage Engraving',
    'Watercolor Storybook',
    '3D Clay Render',
    'Chrome Futurism',
    'Gothic Ornamental',
  ];
  assert.deepEqual(
    CURATED_ART_STYLES.map((s) => s.name),
    expectedNames,
  );

  const ids = new Set<string>();
  const slugs = new Set<string>();
  const allowedCategories = new Set<string>(
    CURATED_STYLE_CATEGORIES.filter((c) => c.id !== 'all').map((c) => c.id),
  );

  for (const style of CURATED_ART_STYLES) {
    assert.equal(Object.isFrozen(style), true);
    assert.equal(Object.isFrozen(style.styleDirectives), true);
    assert.equal(style.isCurated, true);
    assert.equal(style.isActive, true);
    assert.ok(allowedCategories.has(style.category), `Unexpected category: ${style.category}`);
    assert.ok(style.shortDescription && style.shortDescription.length > 10);
    assert.ok(style.description && style.description.length > 20);
    assert.ok(style.renderingTechnique && style.renderingTechnique.length > 10);
    assert.ok(style.tags && style.tags.length >= 3);
    assert.ok(style.previewAsset && style.previewAsset.kind === 'editorial_svg');
    assert.equal(ids.has(style.id), false);
    assert.equal(slugs.has(style.slug), false);
    ids.add(style.id);
    slugs.add(style.slug);

    const valid = validateArtStyleRecord(style);
    assert.equal(valid.ok, true);
  }

  assert.equal(formatArtStyleCategoryLabel('3d_art'), '3D Art');
  assert.equal(formatArtStyleCategoryLabel('graphic_design'), 'Graphic Design');
  assert.ok(getCuratedStyleByIdSync('sty_bauhaus_geom_07'));
});

test('ArtStyleService idempotently seeds 12 curated styles and avoids duplicates on repeated calls', async () => {
  const backing = new InMemoryIdbBackingStore();
  const gateway = new BrowserIndexedDbStorageGateway(backing.createFactory());
  const service = new StudioArtStyleService(gateway);

  const first = await service.ensureCatalogSeeded();
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.data.length, 12);

  const second = await service.ensureCatalogSeeded();
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.data.length, 12);

  // Concurrent calls also deduplicate cleanly
  const [c1, c2] = await Promise.all([
    service.ensureCatalogSeeded(),
    service.ensureCatalogSeeded(),
  ]);
  assert.equal(c1.ok && c1.data.length, 12);
  assert.equal(c2.ok && c2.data.length, 12);
});

test('Upgrading IndexedDB from v1 to v2 adds styleFavorites store while preserving existing v1 records', async () => {
  const backing = new InMemoryIdbBackingStore();
  const projectId = createEntityId('prj');
  const now = nowIsoTimestamp();

  // Seed a v1 database layout before opening v2 gateway
  const v1Stores = new Map<string, StoreEntry>();
  const existingProject: Project = {
    id: projectId,
    title: 'Preserved V1 Study',
    description: 'Pre-Phase-04 workspace',
    status: 'analyzed',
    sourceAssetId: createEntityId('src'),
    activeAnalysisId: createEntityId('anl'),
    activeDescriptionId: createEntityId('dsc'),
    selectedStyleId: null,
    activePromptId: null,
    activeGenerationJobId: null,
    tags: [],
    createdAt: now,
    updatedAt: now,
  };
  v1Stores.set('projects', {
    keyPath: 'id',
    records: new Map([[projectId, existingProject]]),
    indexes: new Map(),
  });
  for (const name of [
    'sourceAssets',
    'assetBlobs',
    'objectAnalyses',
    'objectDescriptions',
    'artStyles',
    'presets',
    'promptDocuments',
    'generationHistory',
    'generatedArtworks',
  ]) {
    v1Stores.set(name, {
      keyPath: 'id',
      records: new Map(),
      indexes: new Map(),
    });
  }
  backing.dbs.set(INDEXED_DB_NAME, {
    version: 1,
    stores: v1Stores,
  });

  const gateway = new BrowserIndexedDbStorageGateway(backing.createFactory());
  const storage = new BrowserProjectStorageService(gateway);
  const styleService = new StudioArtStyleService(gateway);

  const restoredProject = await storage.getProjectById(projectId);
  assert.equal(restoredProject.ok, true);
  if (restoredProject.ok) {
    assert.equal(restoredProject.data?.title, 'Preserved V1 Study');
    assert.equal(restoredProject.data?.status, 'analyzed');
  }

  const favToggle = await styleService.toggleFavoriteStyle('sty_bauhaus_geom_07');
  assert.equal(favToggle.ok, true);
  if (favToggle.ok) {
    assert.equal(favToggle.data, true);
  }
});

test('ArtStyle catalog filtering, category counts, search, sorting, and persistent favorites work across reload', async () => {
  const backing = new InMemoryIdbBackingStore();
  const factory = backing.createFactory();

  // Session 1: toggle favorites
  const gateway1 = new BrowserIndexedDbStorageGateway(factory);
  const styleService1 = new StudioArtStyleService(gateway1);

  const fav1 = await styleService1.toggleFavoriteStyle('sty_japanese_anime_02');
  const fav2 = await styleService1.toggleFavoriteStyle('sty_gothic_ornament_12');
  assert.equal(fav1.ok && fav1.data, true);
  assert.equal(fav2.ok && fav2.data, true);

  // Toggling again un-favorites and removes record cleanly
  const unfav = await styleService1.toggleFavoriteStyle('sty_gothic_ornament_12');
  assert.equal(unfav.ok && unfav.data, false);

  await gateway1.close();

  // Session 2: fresh service instance simulating page reload
  const gateway2 = new BrowserIndexedDbStorageGateway(factory);
  const styleService2 = new StudioArtStyleService(gateway2);

  const favIds = await styleService2.listFavoriteStyleIds();
  assert.equal(favIds.ok, true);
  if (favIds.ok) {
    assert.deepEqual(favIds.data, ['sty_japanese_anime_02']);
  }

  // Verify no duplicate favorite records exist in store
  const rawFavs = await gateway2.getStore('styleFavorites').listAll();
  assert.equal(rawFavs.ok, true);
  if (rawFavs.ok) {
    assert.equal(rawFavs.data.length, 1);
    assert.equal(rawFavs.data[0].id, buildFavoriteRecordId('sty_japanese_anime_02'));
  }

  const allCatalog = await styleService2.listCatalogWithFavorites();
  assert.equal(allCatalog.ok, true);
  if (!allCatalog.ok) return;

  const counts = computeStyleCategoryCounts(allCatalog.data);
  assert.equal(counts.all, 12);
  assert.equal(counts.illustration, 4);
  assert.equal(counts.graphic_design, 3);
  assert.equal(counts.line_art, 1);
  assert.equal(counts.traditional_art, 2);
  assert.equal(counts.digital_art, 1);
  assert.equal(counts['3d_art'], 1);

  // Case-insensitive search across name, category, and keywords
  const gouacheHits = filterAndSortStyleCatalog(allCatalog.data, { search: 'GOUACHE' });
  assert.ok(gouacheHits.length >= 2);
  assert.ok(gouacheHits.some((item) => item.style.id === 'sty_japanese_anime_02'));

  // Category filter
  const graphicStyles = filterAndSortStyleCatalog(allCatalog.data, {
    category: 'graphic_design',
  });
  assert.equal(graphicStyles.length, 3);

  // Favorites filter
  const favoritesOnly = filterAndSortStyleCatalog(allCatalog.data, {
    favoritesOnly: true,
  });
  assert.equal(favoritesOnly.length, 1);
  assert.equal(favoritesOnly[0].style.id, 'sty_japanese_anime_02');

  // Name A-Z sort
  const sortedAsc = filterAndSortStyleCatalog(allCatalog.data, {
    sortBy: 'name_asc',
  });
  assert.equal(sortedAsc[0].style.name, '3D Clay Render');
  assert.equal(sortedAsc[sortedAsc.length - 1].style.name, 'Watercolor Storybook');

  // Favorites-first sort
  const favFirst = filterAndSortStyleCatalog(allCatalog.data, {
    sortBy: 'favorites_first',
  });
  assert.equal(favFirst[0].style.id, 'sty_japanese_anime_02');
});

test('ArtStyle validation rejects image payloads and credential-like keys', () => {
  const base: ArtStyle = { ...CURATED_ART_STYLES[0] };

  const withImage = {
    ...base,
    sourceImageDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
  };
  const imgRes = validateArtStyleRecord(withImage);
  assert.equal(imgRes.ok, false);
  if (!imgRes.ok) {
    assert.equal(imgRes.error.code, 'SECURITY_BOUNDARY_VIOLATION');
  }

  const withSecret = {
    ...base,
    apiKey: 'AIzaSyFakeSecretValue',
  };
  const credRes = validateArtStyleRecord(withSecret);
  assert.equal(credRes.ok, false);
  if (!credRes.ok) {
    assert.equal(credRes.error.code, 'SECURITY_BOUNDARY_VIOLATION');
  }

  // Ensure helper works cleanly on an empty catalog
  const emptyCounts = computeStyleCategoryCounts([] as readonly StyleCatalogItem[]);
  assert.equal(emptyCounts.all, 0);
});

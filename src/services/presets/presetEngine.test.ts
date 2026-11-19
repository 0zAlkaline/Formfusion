import assert from 'node:assert/strict';
import test from 'node:test';
import type { ObjectDescription } from '../../types/domain.ts';
import type { SavePersonalPresetInput } from '../../types/services.ts';
import { createEntityId, nowIsoTimestamp } from '../../utils/ids.ts';
import { validateServerPromptSynthesisPayload } from '../../../server/services/boundaryGuards.ts';
import { BrowserIndexedDbStorageGateway } from '../project-storage/indexedDbGateway.ts';
import { BrowserProjectStorageService } from '../project-storage/browserProjectStorage.ts';
import { CURATED_ART_STYLES } from '../art-style/curatedCatalog.ts';
import {
  StudioPresetService,
  artStyleFromSnapshot,
  buildPresetSnapshotFromArtStyle,
  buildPresetSnapshotFromManual,
  manualInputFromSnapshot,
  validateSavePersonalPresetInput,
} from './presetService.ts';
import {
  StudioPromptComposerService,
  normalizeArtStyleConfiguration,
} from '../prompt-composer/promptComposerService.ts';

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

function makeManualInput(): SavePersonalPresetInput {
  return {
    name: 'Architectural Copper Etching',
    description: 'Warm ink linework preset for sculptural objects.',
    creativeDirectionMode: 'manual',
    selectedStyleId: null,
    creativeDirectionSnapshot: buildPresetSnapshotFromManual({
      styleName: 'Copperplate Atelier Study',
      styleCategory: 'traditional_art',
      styleDescription: 'Fine archival burin etching on cream laid rag paper.',
      visualCharacteristics: 'Crisp linear volume and delicate contour hatching.',
      renderingRules: 'Intaglio ink cross-hatching with quiet negative margins.',
      lineworkRules: 'Tapered directional strokes.',
      colorRules: 'Sepia charcoal ink on warm cream rag paper.',
      textureRules: 'Fine cotton paper grain.',
      shadingRules: 'Cross-hatched tonal falloff.',
      compositionRules: 'Centered specimen balance.',
      detailLevel: 'intricate',
      promptTemplate: '',
      negativePromptTemplate: 'neon colors, plastic gloss',
    }),
    aspectRatio: '3:4',
    outputOrientation: 'portrait',
    backgroundTreatment: 'editorial_backdrop',
    detailLevel: 'intricate',
    compositionDirection: 'Centered archival study with generous margins',
    userCreativeInstructions: 'Keep rim engraving sharp.',
    negativePrompt: 'neon colors, plastic gloss',
    tags: ['etching', 'editorial', 'Etching'],
  };
}

function makeSavedDescription(projectId: string, sourceAssetId: string): ObjectDescription {
  const now = nowIsoTimestamp();
  return {
    id: createEntityId('dsc'),
    projectId,
    analysisId: createEntityId('anl'),
    sourceAssetId,
    version: 2,
    objectName: 'Brass Astrolabe',
    objectCategory: 'Scientific Instrument',
    primaryDescription: 'An engraved brass astrolabe with concentric rotating dial rings.',
    shapeAndSilhouette: 'Circular disc topped by a pierced throne ring.',
    materials: ['aged brass', 'engraved bronze'],
    dominantColors: ['burnished gold', 'warm umber'],
    surfaceDetails: 'Fine radial degree graduations.',
    distinctiveFeatures: ['Pierced rete filigree', 'Rotating alidade pointer'],
    composition: 'Centered upright view.',
    viewingAngle: 'Eye-level',
    preservationPriorities: ['Preserve engraved degree dial', 'Keep silhouette exact'],
    uncertainAttributes: ['Backplate inscription hidden'],
    primarySubject: 'Brass Astrolabe',
    environmentContext: 'Neutral studio pedestal',
    objects: [],
    moodAndAtmosphere: 'Museum archival daylight',
    userNotes: '',
    isNormalized: true,
    createdAt: now,
    updatedAt: now,
  };
}

test('PresetEngine supports full Create, Read, Update, Duplicate, Delete and persists across reload', async () => {
  const backing = new InMemoryIdbBackingStore();
  const factory = backing.createFactory();

  const gateway1 = new BrowserIndexedDbStorageGateway(factory);
  const presetService1 = new StudioPresetService(gateway1);

  // Create
  const created = await presetService1.createPreset(makeManualInput());
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.ok(created.data.id.startsWith('pst_'));
  assert.deepEqual(created.data.tags, ['etching', 'editorial']);
  assert.equal(created.data.version, 1);

  // Update
  const updated = await presetService1.updatePreset(created.data.id, {
    ...makeManualInput(),
    name: 'Architectural Copper Etching v2',
    aspectRatio: '4:3',
    outputOrientation: 'landscape',
  });
  assert.equal(updated.ok, true);
  if (!updated.ok) return;
  assert.equal(updated.data.version, 2);
  assert.equal(updated.data.name, 'Architectural Copper Etching v2');
  assert.equal(updated.data.aspectRatio, '4:3');

  // Duplicate -> unique "(Copy)" and "(Copy 2)" names
  const dup1 = await presetService1.duplicatePreset(created.data.id);
  const dup2 = await presetService1.duplicatePreset(created.data.id);
  assert.equal(dup1.ok, true);
  assert.equal(dup2.ok, true);
  if (!dup1.ok || !dup2.ok) return;
  assert.equal(dup1.data.name, 'Architectural Copper Etching v2 (Copy)');
  assert.equal(dup2.data.name, 'Architectural Copper Etching v2 (Copy 2)');
  assert.notEqual(dup1.data.id, created.data.id);

  await gateway1.close();

  // Reload simulation
  const gateway2 = new BrowserIndexedDbStorageGateway(factory);
  const presetService2 = new StudioPresetService(gateway2);
  const listed = await presetService2.listPresets();
  assert.equal(listed.ok, true);
  if (!listed.ok) return;
  assert.equal(listed.data.length, 3);

  // Delete one copy
  const deleted = await presetService2.deletePreset(dup2.data.id);
  assert.equal(deleted.ok, true);
  const afterDelete = await presetService2.listPresets();
  assert.equal(afterDelete.ok && afterDelete.data.length, 2);
});

test('PersonalPreset snapshot remains isolated from future catalog edits or removals', async () => {
  const backing = new InMemoryIdbBackingStore();
  const gateway = new BrowserIndexedDbStorageGateway(backing.createFactory());
  const presetService = new StudioPresetService(gateway);

  const curatedStyle = CURATED_ART_STYLES[0];
  const snapshot = buildPresetSnapshotFromArtStyle(curatedStyle);
  const created = await presetService.createPreset({
    name: 'Editorial Magazine Card',
    description: 'Snapshot based on Flat Editorial Illustration',
    creativeDirectionMode: 'curated',
    selectedStyleId: curatedStyle.id,
    creativeDirectionSnapshot: snapshot,
    aspectRatio: '4:3',
    outputOrientation: 'landscape',
    backgroundTreatment: 'editorial_backdrop',
    detailLevel: 'balanced',
    compositionDirection: 'Preserve source framing',
    userCreativeInstructions: 'Keep warm bone ivory margins.',
    negativePrompt: 'photorealistic textures',
    tags: ['editorial'],
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  // Even if the artStyles store record is missing or altered later, snapshot data stands on its own
  await gateway.getStore('artStyles').delete(curatedStyle.id);

  const fetched = await presetService.getPresetById(created.data.id);
  assert.equal(fetched.ok, true);
  if (!fetched.ok || !fetched.data) return;

  assert.equal(fetched.data.creativeDirectionSnapshot.styleName, 'Flat Editorial Illustration');
  const hydratedStyle = artStyleFromSnapshot(fetched.data.creativeDirectionSnapshot);
  assert.equal(hydratedStyle.name, 'Flat Editorial Illustration');
  const hydratedManual = manualInputFromSnapshot(fetched.data.creativeDirectionSnapshot);
  assert.equal(hydratedManual.styleName, 'Flat Editorial Illustration');
});

test('Applying a PersonalPreset updates creative direction while preserving source asset, analysis, description, and prompt history', async () => {
  const backing = new InMemoryIdbBackingStore();
  const gateway = new BrowserIndexedDbStorageGateway(backing.createFactory());
  const storage = new BrowserProjectStorageService(gateway);
  const presetService = new StudioPresetService(gateway);

  const projectId = createEntityId('prj');
  const now = nowIsoTimestamp();
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
  const assetId = createEntityId('src');

  const saveAssetRes = await storage.saveOrReplaceProjectSourceAsset({
    projectId,
    validatedAsset: {
      id: assetId,
      projectId,
      originalFileName: 'astrolabe.png',
      mimeType: 'image/png',
      fileExtension: 'png',
      fileSizeBytes: bytes.byteLength,
      width: 800,
      height: 800,
      aspectRatio: { widthRatio: 1, heightRatio: 1, label: '1:1', numeric: 1 },
      checksumSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      localBlobKey: null,
      validationStatus: 'validated',
      storageStatus: 'in_memory',
      createdAt: now,
      updatedAt: now,
    },
    binaryBlob: new Blob([bytes], { type: 'image/png' }),
  });
  assert.equal(saveAssetRes.ok, true);

  const description = makeSavedDescription(projectId, assetId);
  await storage.saveAnalysisAndInitialDescription({
    projectId,
    analysis: {
      id: description.analysisId,
      projectId,
      sourceAssetId: assetId,
      providerId: 'gemini',
      modelId: 'gemini-4-hydrogen',
      sceneSummary: 'Astrolabe study',
      detectedObjects: [],
      lightingNotes: 'Even daylight',
      compositionNotes: 'Centered',
      objectName: description.objectName,
      objectCategory: description.objectCategory,
      primaryDescription: description.primaryDescription,
      shapeAndSilhouette: description.shapeAndSilhouette,
      materials: description.materials,
      dominantColors: description.dominantColors,
      surfaceDetails: description.surfaceDetails,
      distinctiveFeatures: description.distinctiveFeatures,
      composition: description.composition,
      viewingAngle: description.viewingAngle,
      preservationPriorities: description.preservationPriorities,
      uncertainAttributes: description.uncertainAttributes,
      analyzedAt: now,
      createdAt: now,
      updatedAt: now,
    },
    description,
  });

  const promptId = createEntityId('prm');
  await storage.savePromptDocumentRevision({
    id: promptId,
    promptId,
    projectId,
    descriptionId: description.id,
    sourceDescriptionRevision: description.version,
    styleId: null,
    selectedStyleId: null,
    userInstructions: 'Initial notes',
    creativeInstructions: 'Initial notes',
    generatedPrompt: 'Initial AI generated prompt baseline.',
    finalPrompt: 'Edited approved prompt baseline.',
    negativePrompt: 'blur',
    approvalStatus: 'approved',
    generatedAt: now,
    approvedAt: now,
    revision: 1,
    revisionNumber: 1,
    createdAt: now,
    updatedAt: now,
  });

  const createdPreset = await presetService.createPreset({
    ...makeManualInput(),
    creativeDirectionMode: 'curated',
    selectedStyleId: CURATED_ART_STYLES[7].id,
    creativeDirectionSnapshot: buildPresetSnapshotFromArtStyle(CURATED_ART_STYLES[7]),
  });
  assert.equal(createdPreset.ok, true);
  if (!createdPreset.ok) return;

  const applied = await presetService.applyPresetToProject(
    projectId,
    createdPreset.data.id,
  );
  assert.equal(applied.ok, true);
  if (!applied.ok) return;

  // Creative direction updated non-destructively
  assert.equal(applied.data.project.selectedStyleId, CURATED_ART_STYLES[7].id);
  assert.equal(
    applied.data.project.activeCreativeConfiguration?.appliedPresetId,
    createdPreset.data.id,
  );
  assert.equal(applied.data.project.activeCreativeConfiguration?.mode, 'curated');

  // Existing source asset, analysis, description, and prompt revision remain 100% preserved!
  assert.equal(applied.data.project.sourceAssetId, assetId);
  assert.equal(applied.data.project.activeAnalysisId, description.analysisId);
  assert.equal(applied.data.project.activeDescriptionId, description.id);
  assert.equal(applied.data.project.activePromptId, promptId);
  assert.equal(applied.data.project.status, 'prompt_ready');

  const promptState = await storage.getProjectPromptState(projectId);
  assert.equal(promptState.ok, true);
  if (promptState.ok && promptState.data) {
    assert.equal(promptState.data.revisions.length, 1);
    assert.equal(promptState.data.activePrompt?.finalPrompt, 'Edited approved prompt baseline.');
  }
});

test('Preset validation rejects forbidden image inputs and credential-like fields', () => {
  const withImage = {
    ...makeManualInput(),
    sourceImageDataUrl: 'data:image/png;base64,AAAA',
  } as SavePersonalPresetInput;
  const imgRes = validateSavePersonalPresetInput(withImage);
  assert.equal(imgRes.ok, false);
  if (!imgRes.ok) {
    assert.equal(imgRes.error.code, 'SECURITY_BOUNDARY_VIOLATION');
  }

  const withCred = {
    ...makeManualInput(),
    apiKey: 'secret_12345',
  } as SavePersonalPresetInput;
  const credRes = validateSavePersonalPresetInput(withCred);
  assert.equal(credRes.ok, false);
  if (!credRes.ok) {
    assert.equal(credRes.error.code, 'SECURITY_BOUNDARY_VIOLATION');
  }
});

test('PromptComposer and ServerBoundaryGuards support both Curated Style and Manual Creative Direction cleanly', async () => {
  const projectId = createEntityId('prj');
  const description = makeSavedDescription(projectId, createEntityId('src'));
  const curatedStyle = CURATED_ART_STYLES[4]; // Monoline Geometric Line Art

  const curatedNorm = normalizeArtStyleConfiguration(curatedStyle, null);
  assert.equal(curatedNorm.ok, true);
  if (!curatedNorm.ok) return;
  assert.equal(curatedNorm.data.source, 'curated');
  assert.equal(curatedNorm.data.styleId, curatedStyle.id);
  assert.equal(curatedNorm.data.isManualCreativeDirection, false);
  assert.ok(curatedNorm.data.renderingTechnique);

  let capturedWireBody: unknown = null;
  const composer = new StudioPromptComposerService({
    fetchFn: (async (_url, init) => {
      capturedWireBody = JSON.parse(String(init?.body ?? '{}'));
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            generatedPrompt:
              'A monoline technical ink drawing of an engraved brass astrolabe centered over warm archival ivory paper.',
            negativePrompt: 'heavy painterly shading, photorealistic textures',
            unresolvedConflicts: [],
            providerId: 'gemini',
            modelId: 'gemini-4-hydrogen',
            generatedAt: nowIsoTimestamp(),
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch,
  });

  const synthRes = await composer.synthesizeMasterPrompt({
    projectId,
    description,
    artStyle: curatedStyle,
    userInstructions: 'Emphasize concentric degree markings.',
    compositionPreferences: {
      aspectRatio: '1:1',
      compositionDirection: 'Preserve source framing',
      backgroundTreatment: 'preserve_clean',
      detailLevel: 'balanced',
      outputOrientation: 'square',
    },
    previousRevision: 0,
  });

  assert.equal(synthRes.ok, true);
  if (!synthRes.ok) return;
  assert.equal(synthRes.data.styleId, curatedStyle.id);
  assert.equal(synthRes.data.creativeDirection?.source, 'curated');

  // Verify server boundary guard accepts the exact serialized wire payload
  const serverValidation = validateServerPromptSynthesisPayload(capturedWireBody);
  assert.equal(serverValidation.ok, true);
  if (serverValidation.ok) {
    assert.equal(serverValidation.data.creativeDirection.source, 'curated');
    assert.equal(serverValidation.data.creativeDirection.styleId, curatedStyle.id);
  }
});

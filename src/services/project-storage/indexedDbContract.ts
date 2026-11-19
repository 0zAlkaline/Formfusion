import { errResult, okResult } from '../../types/common.ts';
import type { EntityId, ServiceResult } from '../../types/common.ts';
import {
  GENERATION_JOB_STATUSES,
  type Preset,
  type Project,
} from '../../types/domain.ts';
import type {
  ProjectBundle,
  ProjectStorageService,
} from '../../types/services.ts';
import {
  INDEXED_DB_NAME,
  INDEXED_DB_SCHEMA_VERSION,
  STORAGE_STORE_NAMES,
} from '../../types/storage.ts';
import type {
  IndexedDbStorageGateway,
  LocalStorageRepository,
  StorageRecordMap,
  StorageSchemaDefinition,
  StorageStoreName,
  StorageTransactionContext,
} from '../../types/storage.ts';
import {
  isValidEntityId,
  isValidIsoTimestamp,
} from '../../utils/ids.ts';
import {
  findCredentialLeakKey,
  isNonEmptyString,
  isPlainRecord,
  validateProviderConfigRef,
} from '../../utils/validation.ts';
import { findForbiddenImageInput } from '../image-generation/contract.ts';

const ALLOWED_PROMPT_APPROVAL_STATUSES: ReadonlySet<string> = new Set([
  'draft',
  'generated',
  'edited',
  'approved',
  'needs_review',
  'rejected',
]);

const ALLOWED_PROJECT_STATUSES: ReadonlySet<string> = new Set([
  'draft',
  'analyzed',
  'prompt_ready',
  'generated',
  'archived',
]);

export const FORMFUSION_INDEXED_DB_SCHEMA: StorageSchemaDefinition = {
  databaseName: INDEXED_DB_NAME,
  version: INDEXED_DB_SCHEMA_VERSION,
  stores: [
    {
      storeName: 'projects',
      keyPath: 'id',
      indexes: [
        { name: 'by_status', keyPath: 'status', unique: false },
        { name: 'by_updatedAt', keyPath: 'updatedAt', unique: false },
      ],
    },
    {
      storeName: 'sourceAssets',
      keyPath: 'id',
      indexes: [
        { name: 'by_projectId', keyPath: 'projectId', unique: false },
      ],
    },
    {
      storeName: 'assetBlobs',
      keyPath: 'id',
      indexes: [
        { name: 'by_projectId', keyPath: 'projectId', unique: false },
        { name: 'by_ownerAssetId', keyPath: 'ownerAssetId', unique: false },
      ],
    },
    {
      storeName: 'objectAnalyses',
      keyPath: 'id',
      indexes: [
        { name: 'by_projectId', keyPath: 'projectId', unique: false },
        { name: 'by_sourceAssetId', keyPath: 'sourceAssetId', unique: false },
      ],
    },
    {
      storeName: 'objectDescriptions',
      keyPath: 'id',
      indexes: [
        { name: 'by_projectId', keyPath: 'projectId', unique: false },
        { name: 'by_analysisId', keyPath: 'analysisId', unique: false },
      ],
    },
    {
      storeName: 'artStyles',
      keyPath: 'id',
      indexes: [
        { name: 'by_slug', keyPath: 'slug', unique: true },
        { name: 'by_category', keyPath: 'category', unique: false },
      ],
    },
    {
      storeName: 'styleFavorites',
      keyPath: 'id',
      indexes: [
        { name: 'by_styleId', keyPath: 'styleId', unique: true },
      ],
    },
    {
      storeName: 'promptDocuments',
      keyPath: 'id',
      indexes: [
        { name: 'by_projectId', keyPath: 'projectId', unique: false },
        { name: 'by_approvalStatus', keyPath: 'approvalStatus', unique: false },
      ],
    },
    {
      storeName: 'generationHistory',
      keyPath: 'id',
      indexes: [
        { name: 'by_projectId', keyPath: 'projectId', unique: false },
        { name: 'by_status', keyPath: 'status', unique: false },
        { name: 'by_queuedAt', keyPath: 'queuedAt', unique: false },
      ],
    },
    {
      storeName: 'generatedArtworks',
      keyPath: 'id',
      indexes: [
        { name: 'by_projectId', keyPath: 'projectId', unique: false },
        { name: 'by_generationJobId', keyPath: 'generationJobId', unique: false },
      ],
    },
    {
      storeName: 'presets',
      keyPath: 'id',
      indexes: [
        { name: 'by_styleId', keyPath: 'styleId', unique: false },
        { name: 'by_name', keyPath: 'name', unique: false },
      ],
    },
  ],
  migrations: [
    {
      fromVersion: 0,
      toVersion: 1,
      description:
        'Initial FormFusion v2.0 IndexedDB object stores and relationship indexes.',
    },
    {
      fromVersion: 1,
      toVersion: 2,
      description:
        'Add styleFavorites object store for persistent local style favorites decoupled from immutable catalog styles.',
    },
  ],
};

export function validateBasePersistedRecord(
  storeName: StorageStoreName,
  record: unknown,
): ServiceResult<Record<string, unknown>> {
  if (!isPlainRecord(record)) {
    return errResult(
      'VALIDATION_ERROR',
      `Persisted record for "${storeName}" must be a plain object.`,
    );
  }

  const credentialKey = findCredentialLeakKey(record, storeName);
  if (credentialKey !== null) {
    return errResult(
      'SECURITY_BOUNDARY_VIOLATION',
      `Credential-like field "${credentialKey}" must never be persisted in IndexedDB.`,
      { storeName, field: credentialKey },
    );
  }

  if (!isValidEntityId(record.id)) {
    return errResult(
      'VALIDATION_ERROR',
      `Record in "${storeName}" requires a stable prefixed entity id.`,
    );
  }

  if (!isValidIsoTimestamp(record.createdAt) || !isValidIsoTimestamp(record.updatedAt)) {
    return errResult(
      'VALIDATION_ERROR',
      `Record in "${storeName}" requires valid ISO-8601 createdAt and updatedAt timestamps.`,
    );
  }

  if (storeName === 'projects') {
    if (!isNonEmptyString(record.title)) {
      return errResult(
        'VALIDATION_ERROR',
        'Project record requires a non-empty title.',
      );
    }
    if (
      record.status !== undefined &&
      (typeof record.status !== 'string' ||
        !ALLOWED_PROJECT_STATUSES.has(record.status))
    ) {
      return errResult(
        'VALIDATION_ERROR',
        'Project record has an invalid status value.',
      );
    }
    if (
      record.previousStatus !== undefined &&
      record.previousStatus !== null &&
      (typeof record.previousStatus !== 'string' ||
        !ALLOWED_PROJECT_STATUSES.has(record.previousStatus) ||
        record.previousStatus === 'archived')
    ) {
      return errResult(
        'VALIDATION_ERROR',
        'Project record previousStatus must be a valid non-archived ProjectStatus.',
      );
    }
  }

  if (storeName === 'artStyles') {
    const forbiddenImage = findForbiddenImageInput(record, 'artStyles');
    if (forbiddenImage !== null) {
      return errResult(
        'SECURITY_BOUNDARY_VIOLATION',
        `${forbiddenImage.reason} ArtStyle catalog records must not store source image payloads.`,
        { path: forbiddenImage.path },
      );
    }
    if (!isNonEmptyString(record.slug) || !isNonEmptyString(record.name)) {
      return errResult(
        'VALIDATION_ERROR',
        'ArtStyle record requires non-empty slug and name.',
      );
    }
  }

  if (storeName === 'styleFavorites') {
    if (!isValidEntityId(record.styleId)) {
      return errResult(
        'VALIDATION_ERROR',
        'StyleFavorite record requires a valid styleId.',
      );
    }
    if (typeof record.isFavorite !== 'boolean') {
      return errResult(
        'VALIDATION_ERROR',
        'StyleFavorite record requires a boolean isFavorite value.',
      );
    }
  }

  if (storeName === 'presets') {
    const forbiddenImage = findForbiddenImageInput(record, 'presets');
    if (forbiddenImage !== null) {
      return errResult(
        'SECURITY_BOUNDARY_VIOLATION',
        `${forbiddenImage.reason} Preset records must never include source image data.`,
        { path: forbiddenImage.path },
      );
    }
    if (!isNonEmptyString(record.name)) {
      return errResult(
        'VALIDATION_ERROR',
        'Preset record requires a non-empty name.',
      );
    }
    if (
      'creativeDirectionSnapshot' in record &&
      record.creativeDirectionSnapshot !== undefined
    ) {
      if (
        !isPlainRecord(record.creativeDirectionSnapshot) ||
        !isNonEmptyString(record.creativeDirectionSnapshot.styleName)
      ) {
        return errResult(
          'VALIDATION_ERROR',
          'PersonalPreset requires a valid creativeDirectionSnapshot with a non-empty styleName.',
        );
      }
    }
  }

  if (storeName === 'sourceAssets') {
    if (!isValidEntityId(record.projectId)) {
      return errResult(
        'VALIDATION_ERROR',
        'SourceAsset record requires a valid projectId.',
      );
    }
    if (!isNonEmptyString(record.originalFileName)) {
      return errResult(
        'VALIDATION_ERROR',
        'SourceAsset record requires a non-empty originalFileName.',
      );
    }
  }

  if (storeName === 'assetBlobs') {
    if (!isValidEntityId(record.projectId) || !isValidEntityId(record.ownerAssetId)) {
      return errResult(
        'VALIDATION_ERROR',
        'AssetBlob record requires valid projectId and ownerAssetId.',
      );
    }
    const maybeBlob = record.blob as { size?: unknown } | undefined;
    if (
      !maybeBlob ||
      typeof maybeBlob !== 'object' ||
      typeof maybeBlob.size !== 'number' ||
      maybeBlob.size <= 0
    ) {
      return errResult(
        'VALIDATION_ERROR',
        'AssetBlob record requires a non-empty Blob payload.',
      );
    }
  }

  if (storeName === 'objectAnalyses') {
    if (!isValidEntityId(record.projectId) || !isValidEntityId(record.sourceAssetId)) {
      return errResult(
        'VALIDATION_ERROR',
        'ObjectAnalysis record requires valid projectId and sourceAssetId.',
      );
    }
    if (!isNonEmptyString(record.objectName) || !isNonEmptyString(record.sceneSummary)) {
      return errResult(
        'VALIDATION_ERROR',
        'ObjectAnalysis record requires non-empty objectName and sceneSummary.',
      );
    }
    if (!isValidIsoTimestamp(record.analyzedAt)) {
      return errResult(
        'VALIDATION_ERROR',
        'ObjectAnalysis record requires a valid analyzedAt timestamp.',
      );
    }
  }

  if (storeName === 'objectDescriptions') {
    if (
      !isValidEntityId(record.projectId) ||
      !isValidEntityId(record.analysisId) ||
      !isValidEntityId(record.sourceAssetId)
    ) {
      return errResult(
        'VALIDATION_ERROR',
        'ObjectDescription record requires valid projectId, analysisId, and sourceAssetId.',
      );
    }
    if (
      !isNonEmptyString(record.objectName) ||
      !isNonEmptyString(record.objectCategory) ||
      !isNonEmptyString(record.primaryDescription)
    ) {
      return errResult(
        'VALIDATION_ERROR',
        'ObjectDescription requires non-empty Object Name, Object Category, and Primary Description.',
      );
    }
    if (typeof record.version !== 'number' || !Number.isInteger(record.version) || record.version < 1) {
      return errResult(
        'VALIDATION_ERROR',
        'ObjectDescription record requires a positive integer version.',
      );
    }
  }

  if (storeName === 'promptDocuments') {
    const forbiddenImage = findForbiddenImageInput(record, 'promptDocuments');
    if (forbiddenImage !== null) {
      return errResult(
        'SECURITY_BOUNDARY_VIOLATION',
        `${forbiddenImage.reason} PromptDocument records must not contain source image payloads.`,
        { path: forbiddenImage.path },
      );
    }
    if (!isValidEntityId(record.projectId) || !isValidEntityId(record.descriptionId)) {
      return errResult(
        'VALIDATION_ERROR',
        'PromptDocument record requires valid projectId and descriptionId.',
      );
    }
    if (
      typeof record.approvalStatus !== 'string' ||
      !ALLOWED_PROMPT_APPROVAL_STATUSES.has(record.approvalStatus)
    ) {
      return errResult(
        'VALIDATION_ERROR',
        'PromptDocument record requires a valid approvalStatus.',
      );
    }
    if (
      typeof record.revision !== 'number' ||
      !Number.isInteger(record.revision) ||
      record.revision < 1
    ) {
      return errResult(
        'VALIDATION_ERROR',
        'PromptDocument record requires a positive integer revision.',
      );
    }
    if (typeof record.generatedPrompt !== 'string' || !isNonEmptyString(record.generatedPrompt)) {
      return errResult(
        'VALIDATION_ERROR',
        'PromptDocument record requires a non-empty generatedPrompt baseline.',
      );
    }
    if (typeof record.finalPrompt !== 'string') {
      return errResult(
        'VALIDATION_ERROR',
        'PromptDocument record requires a string finalPrompt.',
      );
    }
    if (
      record.approvalStatus === 'approved' &&
      (!isNonEmptyString(record.finalPrompt) || !isValidIsoTimestamp(record.approvedAt))
    ) {
      return errResult(
        'VALIDATION_ERROR',
        'Approved PromptDocument requires non-empty finalPrompt and valid approvedAt timestamp.',
      );
    }
    if (
      record.parentPromptId !== undefined &&
      record.parentPromptId !== null &&
      !isValidEntityId(record.parentPromptId)
    ) {
      return errResult(
        'VALIDATION_ERROR',
        'PromptDocument parentPromptId must be a valid entity ID when provided.',
      );
    }
    if (
      record.parentGenerationId !== undefined &&
      record.parentGenerationId !== null &&
      !isValidEntityId(record.parentGenerationId)
    ) {
      return errResult(
        'VALIDATION_ERROR',
        'PromptDocument parentGenerationId must be a valid entity ID when provided.',
      );
    }
    if (
      record.variationId !== undefined &&
      record.variationId !== null &&
      !isValidEntityId(record.variationId)
    ) {
      return errResult(
        'VALIDATION_ERROR',
        'PromptDocument variationId must be a valid entity ID when provided.',
      );
    }
  }

  if (storeName === 'generationHistory') {
    const forbiddenImage = findForbiddenImageInput(record, 'generationHistory');
    if (forbiddenImage !== null) {
      return errResult(
        'SECURITY_BOUNDARY_VIOLATION',
        `${forbiddenImage.reason} GenerationJob history must never store source images or base64 blobs.`,
        { path: forbiddenImage.path },
      );
    }
    if (!isValidEntityId(record.projectId) || !isValidEntityId(record.promptDocumentId)) {
      return errResult(
        'VALIDATION_ERROR',
        'GenerationJob record requires valid projectId and promptDocumentId.',
      );
    }
    if (
      record.parentGenerationId !== undefined &&
      record.parentGenerationId !== null &&
      !isValidEntityId(record.parentGenerationId)
    ) {
      return errResult(
        'VALIDATION_ERROR',
        'GenerationJob parentGenerationId must be a valid entity ID when provided.',
      );
    }
    if (
      record.parentPromptId !== undefined &&
      record.parentPromptId !== null &&
      !isValidEntityId(record.parentPromptId)
    ) {
      return errResult(
        'VALIDATION_ERROR',
        'GenerationJob parentPromptId must be a valid entity ID when provided.',
      );
    }
    if (
      record.variationId !== undefined &&
      record.variationId !== null &&
      !isValidEntityId(record.variationId)
    ) {
      return errResult(
        'VALIDATION_ERROR',
        'GenerationJob variationId must be a valid entity ID when provided.',
      );
    }
    if (
      record.variationPromptId !== undefined &&
      record.variationPromptId !== null &&
      !isValidEntityId(record.variationPromptId)
    ) {
      return errResult(
        'VALIDATION_ERROR',
        'GenerationJob variationPromptId must be a valid entity ID when provided.',
      );
    }
    const providerRefValidation = validateProviderConfigRef(record.providerConfigRef);
    if (!providerRefValidation.ok) {
      return providerRefValidation;
    }
    if (
      typeof record.status !== 'string' ||
      !(GENERATION_JOB_STATUSES as readonly string[]).includes(record.status)
    ) {
      return errResult(
        'VALIDATION_ERROR',
        'GenerationJob record requires a valid status.',
      );
    }
    if (!isValidIsoTimestamp(record.queuedAt)) {
      return errResult(
        'VALIDATION_ERROR',
        'GenerationJob record requires a valid queuedAt timestamp.',
      );
    }
  }

  if (storeName === 'generatedArtworks') {
    const forbiddenImage = findForbiddenImageInput(record, 'generatedArtworks');
    if (forbiddenImage !== null) {
      return errResult(
        'SECURITY_BOUNDARY_VIOLATION',
        `${forbiddenImage.reason} GeneratedArtwork metadata must store only a localBlobKey reference.`,
        { path: forbiddenImage.path },
      );
    }
    if (
      !isValidEntityId(record.projectId) ||
      !isValidEntityId(record.generationJobId) ||
      !isValidEntityId(record.promptDocumentId) ||
      !isValidEntityId(record.localBlobKey)
    ) {
      return errResult(
        'VALIDATION_ERROR',
        'GeneratedArtwork record requires valid projectId, generationJobId, promptDocumentId, and localBlobKey.',
      );
    }
    if (
      record.parentGenerationId !== undefined &&
      record.parentGenerationId !== null &&
      !isValidEntityId(record.parentGenerationId)
    ) {
      return errResult(
        'VALIDATION_ERROR',
        'GeneratedArtwork parentGenerationId must be a valid entity ID when provided.',
      );
    }
    if (
      record.variationId !== undefined &&
      record.variationId !== null &&
      !isValidEntityId(record.variationId)
    ) {
      return errResult(
        'VALIDATION_ERROR',
        'GeneratedArtwork variationId must be a valid entity ID when provided.',
      );
    }
    if (
      record.mimeType !== 'image/png' &&
      record.mimeType !== 'image/jpeg' &&
      record.mimeType !== 'image/webp'
    ) {
      return errResult(
        'VALIDATION_ERROR',
        'GeneratedArtwork record requires mimeType "image/png", "image/jpeg", or "image/webp".',
      );
    }
    if (
      typeof record.width !== 'number' ||
      !Number.isInteger(record.width) ||
      record.width <= 0 ||
      typeof record.height !== 'number' ||
      !Number.isInteger(record.height) ||
      record.height <= 0
    ) {
      return errResult(
        'VALIDATION_ERROR',
        'GeneratedArtwork record requires positive integer width and height.',
      );
    }
    if (!isNonEmptyString(record.providerModelId)) {
      return errResult(
        'VALIDATION_ERROR',
        'GeneratedArtwork record requires a non-empty providerModelId.',
      );
    }
  }

  return okResult(record);
}

export function isIndexedDbEnvironmentSupported(): boolean {
  return typeof globalThis !== 'undefined' && 'indexedDB' in globalThis;
}

class UnimplementedStoreRepository<K extends StorageStoreName>
  implements LocalStorageRepository<K>
{
  readonly storeName: K;

  constructor(storeName: K) {
    this.storeName = storeName;
  }

  async getById(
    _id: EntityId,
  ): Promise<ServiceResult<StorageRecordMap[K] | null>> {
    return errResult(
      'NOT_IMPLEMENTED',
      `IndexedDB persistence for "${this.storeName}" is deferred beyond Phase 01.1.`,
    );
  }

  async listAll(): Promise<ServiceResult<readonly StorageRecordMap[K][]>> {
    return errResult(
      'NOT_IMPLEMENTED',
      `IndexedDB persistence for "${this.storeName}" is deferred beyond Phase 01.1.`,
    );
  }

  async put(
    record: StorageRecordMap[K],
  ): Promise<ServiceResult<StorageRecordMap[K]>> {
    const validated = validateBasePersistedRecord(this.storeName, record);
    if (!validated.ok) {
      return validated;
    }
    return errResult(
      'NOT_IMPLEMENTED',
      `IndexedDB write for "${this.storeName}" is deferred beyond Phase 01.1.`,
    );
  }

  async delete(_id: EntityId): Promise<ServiceResult<void>> {
    return errResult(
      'NOT_IMPLEMENTED',
      `IndexedDB delete for "${this.storeName}" is deferred beyond Phase 01.1.`,
    );
  }
}

/**
 * Architectural gateway foundation for IndexedDB persistence.
 * Explicitly reports non-persistent status in Phase 01.1 until the full
 * IndexedDB driver is implemented in the storage phase.
 */
export class IndexedDbStorageGatewayFoundation
  implements IndexedDbStorageGateway
{
  readonly schema: StorageSchemaDefinition = FORMFUSION_INDEXED_DB_SCHEMA;

  isAvailable(): boolean {
    return isIndexedDbEnvironmentSupported();
  }

  isPersistent(): boolean {
    return false;
  }

  getStore<K extends StorageStoreName>(
    storeName: K,
  ): LocalStorageRepository<K> {
    if (!STORAGE_STORE_NAMES.includes(storeName)) {
      throw new Error(`Unknown IndexedDB store: ${storeName}`);
    }
    return new UnimplementedStoreRepository(storeName);
  }

  async runInTransaction<TResult>(
    _context: StorageTransactionContext,
    _work: () => Promise<ServiceResult<TResult>>,
  ): Promise<ServiceResult<TResult>> {
    return errResult(
      'NOT_IMPLEMENTED',
      'IndexedDB transaction execution is deferred beyond Phase 01.1.',
    );
  }
}

export class ProjectStorageServiceFoundation implements ProjectStorageService {
  readonly gateway: IndexedDbStorageGateway;

  constructor(gateway: IndexedDbStorageGateway = new IndexedDbStorageGatewayFoundation()) {
    this.gateway = gateway;
  }

  async listProjects(): Promise<ServiceResult<readonly Project[]>> {
    return this.gateway.getStore('projects').listAll();
  }

  async getProjectById(
    projectId: EntityId,
  ): Promise<ServiceResult<Project | null>> {
    return this.gateway.getStore('projects').getById(projectId);
  }

  async getProjectBundle(
    _projectId: EntityId,
  ): Promise<ServiceResult<ProjectBundle | null>> {
    return errResult(
      'NOT_IMPLEMENTED',
      'ProjectStorageService bundle retrieval is deferred beyond Phase 01.1.',
    );
  }

  async saveProject(project: Project): Promise<ServiceResult<Project>> {
    return this.gateway.getStore('projects').put(project);
  }

  async deleteProject(projectId: EntityId): Promise<ServiceResult<void>> {
    return this.gateway.getStore('projects').delete(projectId);
  }

  async listPresets(): Promise<ServiceResult<readonly Preset[]>> {
    const res = await this.gateway.getStore('presets').listAll();
    if (!res.ok) {
      return res;
    }
    return okResult(res.data as unknown as readonly Preset[]);
  }

  async savePreset(preset: Preset): Promise<ServiceResult<Preset>> {
    const res = await this.gateway.getStore('presets').put(preset);
    if (!res.ok) {
      return res;
    }
    return okResult(res.data as unknown as Preset);
  }

  async deletePreset(presetId: EntityId): Promise<ServiceResult<void>> {
    return this.gateway.getStore('presets').delete(presetId);
  }
}

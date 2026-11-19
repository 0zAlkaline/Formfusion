import type { EntityId, EntityTimestamps, ServiceResult } from './common.ts';
import type {
  ArtStyle,
  GeneratedArtwork,
  GenerationJob,
  ObjectAnalysis,
  ObjectDescription,
  PersonalPreset,
  Preset,
  Project,
  PromptDocument,
  SourceAsset,
  StyleFavoriteRecord,
  SupportedSourceMimeType,
} from './domain.ts';

export const INDEXED_DB_NAME = 'formfusion_studio_db' as const;
export const INDEXED_DB_SCHEMA_VERSION = 2 as const;

export const STORAGE_STORE_NAMES = [
  'projects',
  'sourceAssets',
  'assetBlobs',
  'objectAnalyses',
  'objectDescriptions',
  'artStyles',
  'styleFavorites',
  'promptDocuments',
  'generationHistory',
  'generatedArtworks',
  'presets',
] as const;

export type StorageStoreName = (typeof STORAGE_STORE_NAMES)[number];

export type StorageFailureReason =
  | 'storage_unavailable'
  | 'quota_exceeded'
  | 'transaction_aborted'
  | 'missing_or_corrupted_asset'
  | 'constraint_or_validation'
  | 'storage_error';

export interface PersistedAssetBlob extends EntityTimestamps {
  readonly id: EntityId;
  readonly ownerAssetId: EntityId;
  readonly projectId: EntityId;
  readonly mimeType: SupportedSourceMimeType;
  readonly fileSizeBytes: number;
  readonly blob: Blob;
}

export interface StorageRecordMap {
  readonly projects: Project;
  readonly sourceAssets: SourceAsset;
  readonly assetBlobs: PersistedAssetBlob;
  readonly objectAnalyses: ObjectAnalysis;
  readonly objectDescriptions: ObjectDescription;
  readonly artStyles: ArtStyle;
  readonly styleFavorites: StyleFavoriteRecord;
  readonly promptDocuments: PromptDocument;
  readonly generationHistory: GenerationJob;
  readonly generatedArtworks: GeneratedArtwork;
  readonly presets: PersonalPreset | Preset;
}

export interface StoreIndexDefinition {
  readonly name: string;
  readonly keyPath: string | readonly string[];
  readonly unique: boolean;
}

export interface StoreSchemaDefinition<K extends StorageStoreName = StorageStoreName> {
  readonly storeName: K;
  readonly keyPath: 'id';
  readonly indexes: readonly StoreIndexDefinition[];
}

export interface StorageMigrationStep {
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly description: string;
}

export interface StorageSchemaDefinition {
  readonly databaseName: string;
  readonly version: number;
  readonly stores: readonly StoreSchemaDefinition[];
  readonly migrations: readonly StorageMigrationStep[];
}

export type TransactionMode = 'readonly' | 'readwrite';

export interface StorageTransactionContext {
  readonly stores: readonly StorageStoreName[];
  readonly mode: TransactionMode;
}

export interface StorageRecordValidator<T> {
  validate(record: unknown): ServiceResult<T>;
}

export interface LocalStorageRepository<K extends StorageStoreName> {
  readonly storeName: K;
  getById(id: EntityId): Promise<ServiceResult<StorageRecordMap[K] | null>>;
  listAll(): Promise<ServiceResult<readonly StorageRecordMap[K][]>>;
  put(record: StorageRecordMap[K]): Promise<ServiceResult<StorageRecordMap[K]>>;
  delete(id: EntityId): Promise<ServiceResult<void>>;
}

export interface IndexedDbStorageGateway {
  readonly schema: StorageSchemaDefinition;
  isAvailable(): boolean;
  isPersistent(): boolean;
  getStore<K extends StorageStoreName>(storeName: K): LocalStorageRepository<K>;
  runInTransaction<TResult>(
    context: StorageTransactionContext,
    work: () => Promise<ServiceResult<TResult>>,
  ): Promise<ServiceResult<TResult>>;
}

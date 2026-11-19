import { errResult, okResult } from '../../types/common.ts';
import type { EntityId, ServiceResult } from '../../types/common.ts';
import type {
  CreativeDirectionMode,
  GeneratedArtwork,
  GenerationJob,
  ObjectAnalysis,
  ObjectDescription,
  Preset,
  Project,
  ProjectCreativeConfiguration,
  PromptDocument,
  SourceAsset,
} from '../../types/domain.ts';
import type {
  ProjectBundle,
  ProjectStorageService,
} from '../../types/services.ts';
import type { PersistedAssetBlob } from '../../types/storage.ts';
import { createEntityId, isValidEntityId, nowIsoTimestamp } from '../../utils/ids.ts';
import {
  resolveGenerationKind,
  type PersistedGenerationRecordBundle,
} from '../image-generation/generationHistoryService.ts';
import { validateBasePersistedRecord } from './indexedDbContract.ts';
import { BrowserIndexedDbStorageGateway } from './indexedDbGateway.ts';
import {
  computeProjectWorkflowStage,
  inferRestorableProjectStatus,
  normalizeProjectDescription,
  validateProjectTitle,
  type ProjectSummary,
} from './projectManagement.ts';

export const ACTIVE_PROJECT_STORAGE_KEY = 'formfusion:activeProjectId' as const;

export interface SaveProjectSourceAssetInput {
  readonly projectId: EntityId;
  readonly validatedAsset: SourceAsset;
  readonly binaryBlob: Blob;
  readonly projectTitle?: string;
}

export interface PersistedSourceAssetResult {
  readonly project: Project;
  readonly sourceAsset: SourceAsset;
  readonly replacedAssetId: EntityId | null;
}

export interface RestoredSourceAssetResult {
  readonly project: Project;
  readonly sourceAsset: SourceAsset | null;
  readonly blob: Blob | null;
}

export interface SaveAnalysisAndDescriptionInput {
  readonly projectId: EntityId;
  readonly analysis: ObjectAnalysis;
  readonly description: ObjectDescription;
}

export interface PersistedObjectAnalysisState {
  readonly project: Project;
  readonly analysis: ObjectAnalysis | null;
  readonly description: ObjectDescription | null;
}

export interface ResetObjectDescriptionInput {
  readonly projectId: EntityId;
  readonly analysisId: EntityId;
  readonly resetDescription: ObjectDescription;
}

export interface SourceAssetStorageService {
  saveOrReplaceProjectSourceAsset(
    input: SaveProjectSourceAssetInput,
  ): Promise<ServiceResult<PersistedSourceAssetResult>>;
  getProjectSourceAsset(
    projectId: EntityId,
  ): Promise<ServiceResult<RestoredSourceAssetResult | null>>;
  restoreActiveSourceAsset(
    preferredProjectId?: EntityId | null,
  ): Promise<ServiceResult<RestoredSourceAssetResult | null>>;
  removeProjectSourceAsset(
    projectId: EntityId,
  ): Promise<ServiceResult<Project | null>>;
}

export interface ObjectDescriptionStorageService {
  saveAnalysisAndInitialDescription(
    input: SaveAnalysisAndDescriptionInput,
  ): Promise<ServiceResult<{
    readonly project: Project;
    readonly analysis: ObjectAnalysis;
    readonly description: ObjectDescription;
  }>>;
  saveEditedObjectDescription(
    description: ObjectDescription,
  ): Promise<ServiceResult<{
    readonly project: Project;
    readonly analysis: ObjectAnalysis;
    readonly description: ObjectDescription;
  }>>;
  resetObjectDescriptionFromAnalysis(
    input: ResetObjectDescriptionInput,
  ): Promise<ServiceResult<{
    readonly project: Project;
    readonly analysis: ObjectAnalysis;
    readonly description: ObjectDescription;
  }>>;
  getProjectObjectAnalysisState(
    projectId: EntityId,
  ): Promise<ServiceResult<PersistedObjectAnalysisState | null>>;
}

export interface PersistedPromptState {
  readonly project: Project;
  readonly activePrompt: PromptDocument | null;
  readonly revisions: readonly PromptDocument[];
}

export interface PromptDocumentStorageService {
  savePromptDocumentRevision(
    promptDocument: PromptDocument,
  ): Promise<ServiceResult<PersistedPromptState>>;
  getProjectPromptState(
    projectId: EntityId,
  ): Promise<ServiceResult<PersistedPromptState | null>>;
  listProjectPromptDocuments(
    projectId: EntityId,
  ): Promise<ServiceResult<readonly PromptDocument[]>>;
}

export interface SaveGenerationResultInput {
  readonly job: GenerationJob;
  readonly artwork: GeneratedArtwork;
  readonly imageBlob: Blob;
  readonly variationPromptDocument?: PromptDocument;
}

export interface PersistedGenerationState {
  readonly project: Project;
  readonly latestJob: GenerationJob | null;
  readonly artwork: GeneratedArtwork | null;
  readonly imageBlob: Blob | null;
  readonly jobHistory: readonly GenerationJob[];
}

export interface ProjectGenerationHistorySnapshot {
  readonly project: Project;
  readonly entries: readonly PersistedGenerationRecordBundle[];
  readonly activeJob: GenerationJob | null;
  readonly activeArtwork: GeneratedArtwork | null;
  readonly activeImageBlob: Blob | null;
}

export interface GenerationStorageService {
  saveGeneratedArtworkResult(
    input: SaveGenerationResultInput,
  ): Promise<ServiceResult<PersistedGenerationState>>;
  saveGenerationHistoryEntry(
    job: GenerationJob,
    variationPromptDocument?: PromptDocument,
  ): Promise<ServiceResult<PersistedGenerationState>>;
  getProjectGenerationState(
    projectId: EntityId,
  ): Promise<ServiceResult<PersistedGenerationState | null>>;
  getProjectGenerationHistory(
    projectId: EntityId,
  ): Promise<ServiceResult<ProjectGenerationHistorySnapshot | null>>;
}

export interface ProjectCreativeStateStorageService {
  getOrCreateActiveProject(
    preferredProjectId?: EntityId | null,
  ): Promise<ServiceResult<Project>>;
  setProjectSelectedStyle(
    projectId: EntityId | null,
    styleId: EntityId | null,
    mode?: CreativeDirectionMode,
  ): Promise<ServiceResult<Project>>;
  setProjectCreativeConfiguration(
    projectId: EntityId | null,
    config: ProjectCreativeConfiguration,
  ): Promise<ServiceResult<Project>>;
}

export interface CreateProjectInput {
  readonly title: string;
  readonly description?: string;
  readonly setAsActive?: boolean;
}

export interface ProjectManagementStorageService {
  listProjectSummaries(
    activeProjectId?: EntityId | null,
  ): Promise<ServiceResult<readonly ProjectSummary[]>>;
  createProject(input: CreateProjectInput): Promise<ServiceResult<Project>>;
  openProject(projectId: EntityId): Promise<ServiceResult<Project>>;
  renameProject(
    projectId: EntityId,
    newTitle: string,
  ): Promise<ServiceResult<Project>>;
  archiveProject(projectId: EntityId): Promise<ServiceResult<Project>>;
  restoreProject(projectId: EntityId): Promise<ServiceResult<Project>>;
  deleteProject(projectId: EntityId): Promise<ServiceResult<void>>;
}

export function readStoredActiveProjectId(): EntityId | null {
  try {
    if (
      typeof globalThis === 'undefined' ||
      !('localStorage' in globalThis) ||
      !globalThis.localStorage
    ) {
      return null;
    }
    const raw = globalThis.localStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY);
    return isValidEntityId(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function writeStoredActiveProjectId(projectId: EntityId | null): void {
  try {
    if (
      typeof globalThis === 'undefined' ||
      !('localStorage' in globalThis) ||
      !globalThis.localStorage
    ) {
      return;
    }
    if (projectId === null) {
      globalThis.localStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY);
    } else {
      globalThis.localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, projectId);
    }
  } catch {
    // Ignore restricted localStorage environments.
  }
}

function isReadableBlob(value: unknown): value is Blob {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Blob).size === 'number' &&
    (value as Blob).size > 0 &&
    typeof (value as Blob).arrayBuffer === 'function'
  );
}

function createDraftProject(
  projectId: EntityId,
  sourceAssetId: EntityId | null,
  title: string,
  timestamp: string,
  description = 'Active source asset study workspace.',
): Project {
  return {
    id: projectId,
    title,
    description,
    status: 'draft',
    previousStatus: null,
    sourceAssetId,
    activeAnalysisId: null,
    activeDescriptionId: null,
    selectedStyleId: null,
    activePromptId: null,
    activeGenerationJobId: null,
    tags: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export class BrowserProjectStorageService
  implements
    ProjectStorageService,
    SourceAssetStorageService,
    ObjectDescriptionStorageService,
    PromptDocumentStorageService,
    GenerationStorageService,
    ProjectCreativeStateStorageService,
    ProjectManagementStorageService
{
  readonly gateway: BrowserIndexedDbStorageGateway;

  constructor(
    gateway: BrowserIndexedDbStorageGateway = new BrowserIndexedDbStorageGateway(),
  ) {
    this.gateway = gateway;
  }

  async listProjects(): Promise<ServiceResult<readonly Project[]>> {
    const res = await this.gateway.getStore('projects').listAll();
    if (!res.ok) {
      return res;
    }
    const sorted = [...res.data].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
    return okResult(sorted);
  }

  async getProjectById(
    projectId: EntityId,
  ): Promise<ServiceResult<Project | null>> {
    return this.gateway.getStore('projects').getById(projectId);
  }

  async getProjectBundle(
    projectId: EntityId,
  ): Promise<ServiceResult<ProjectBundle | null>> {
    return this.gateway.executeTransaction(
      [
        'projects',
        'sourceAssets',
        'objectAnalyses',
        'objectDescriptions',
        'promptDocuments',
        'generationHistory',
        'generatedArtworks',
      ],
      'readonly',
      (stores, { settle, abortWithError }) => {
        const projectReq = stores.projects.get(projectId);
        projectReq.onerror = () => abortWithError(projectReq.error);
        projectReq.onsuccess = () => {
          const project = projectReq.result as Project | undefined;
          if (!project) {
            settle(okResult(null));
            return;
          }

          const analysesReq = stores.objectAnalyses.getAll();
          const descReq = stores.objectDescriptions.getAll();
          const promptsReq = stores.promptDocuments.getAll();
          const jobsReq = stores.generationHistory.getAll();
          const artworksReq = stores.generatedArtworks.getAll();
          const assetReq = project.sourceAssetId
            ? stores.sourceAssets.get(project.sourceAssetId)
            : null;

          let completed = 0;
          const total = assetReq ? 6 : 5;
          let sourceAsset: SourceAsset | null = null;
          let analyses: ProjectBundle['analyses'] = [];
          let descriptions: ProjectBundle['descriptions'] = [];
          let prompts: ProjectBundle['prompts'] = [];
          let generationJobs: ProjectBundle['generationJobs'] = [];
          let artworks: ProjectBundle['artworks'] = [];

          const maybeFinish = () => {
            completed += 1;
            if (completed === total) {
              settle(
                okResult({
                  project,
                  sourceAsset,
                  analyses,
                  descriptions,
                  prompts,
                  generationJobs,
                  artworks,
                }),
              );
            }
          };

          if (assetReq) {
            assetReq.onerror = () => abortWithError(assetReq.error);
            assetReq.onsuccess = () => {
              sourceAsset = (assetReq.result as SourceAsset | undefined) ?? null;
              maybeFinish();
            };
          }

          analysesReq.onerror = () => abortWithError(analysesReq.error);
          analysesReq.onsuccess = () => {
            analyses = (
              (analysesReq.result as ProjectBundle['analyses'] | undefined) ?? []
            ).filter((item) => item.projectId === projectId);
            maybeFinish();
          };

          descReq.onerror = () => abortWithError(descReq.error);
          descReq.onsuccess = () => {
            descriptions = (
              (descReq.result as ProjectBundle['descriptions'] | undefined) ?? []
            ).filter((item) => item.projectId === projectId);
            maybeFinish();
          };

          promptsReq.onerror = () => abortWithError(promptsReq.error);
          promptsReq.onsuccess = () => {
            prompts = (
              (promptsReq.result as ProjectBundle['prompts'] | undefined) ?? []
            ).filter((item) => item.projectId === projectId);
            maybeFinish();
          };

          jobsReq.onerror = () => abortWithError(jobsReq.error);
          jobsReq.onsuccess = () => {
            generationJobs = (
              (jobsReq.result as ProjectBundle['generationJobs'] | undefined) ??
              []
            ).filter((item) => item.projectId === projectId);
            maybeFinish();
          };

          artworksReq.onerror = () => abortWithError(artworksReq.error);
          artworksReq.onsuccess = () => {
            artworks = (
              (artworksReq.result as ProjectBundle['artworks'] | undefined) ?? []
            ).filter((item) => item.projectId === projectId);
            maybeFinish();
          };
        };
      },
    );
  }

  async saveProject(project: Project): Promise<ServiceResult<Project>> {
    return this.gateway.getStore('projects').put(project);
  }

  async deleteProject(projectId: EntityId): Promise<ServiceResult<void>> {
    if (!isValidEntityId(projectId)) {
      return errResult(
        'VALIDATION_ERROR',
        'A valid project ID is required before deleting a project.',
      );
    }

    const txRes = await this.gateway.executeTransaction(
      [
        'projects',
        'sourceAssets',
        'assetBlobs',
        'objectAnalyses',
        'objectDescriptions',
        'promptDocuments',
        'generationHistory',
        'generatedArtworks',
      ],
      'readwrite',
      (stores, { settle, abortWithError }) => {
        const projectsReq = stores.projects.getAll();
        const assetsReq = stores.sourceAssets.getAll();
        const blobsReq = stores.assetBlobs.getAll();
        const analysesReq = stores.objectAnalyses.getAll();
        const descriptionsReq = stores.objectDescriptions.getAll();
        const promptsReq = stores.promptDocuments.getAll();
        const jobsReq = stores.generationHistory.getAll();
        const artworksReq = stores.generatedArtworks.getAll();

        let allProjects: Project[] | null = null;
        let allAssets: SourceAsset[] | null = null;
        let allBlobs: PersistedAssetBlob[] | null = null;
        let allAnalyses: ObjectAnalysis[] | null = null;
        let allDescriptions: ObjectDescription[] | null = null;
        let allPrompts: PromptDocument[] | null = null;
        let allJobs: GenerationJob[] | null = null;
        let allArtworks: GeneratedArtwork[] | null = null;

        const proceed = () => {
          if (
            !allProjects ||
            !allAssets ||
            !allBlobs ||
            !allAnalyses ||
            !allDescriptions ||
            !allPrompts ||
            !allJobs ||
            !allArtworks
          ) {
            return;
          }

          const targetProject = allProjects.find((p) => p.id === projectId);
          if (!targetProject) {
            settle(
              errResult(
                'NOT_FOUND',
                'The selected project does not exist or has already been deleted.',
              ),
            );
            return;
          }

          const remainingProjects = allProjects.filter(
            (p) => p.id !== projectId,
          );
          const referencedAssetIdsByOtherProjects = new Set<EntityId>(
            remainingProjects
              .map((p) => p.sourceAssetId)
              .filter((id): id is EntityId => Boolean(id)),
          );

          const blobIdsInStore = new Set<string>(allBlobs.map((b) => b.id));

          // Delete target project record
          const deleteProjectReq = stores.projects.delete(projectId);
          deleteProjectReq.onerror = () => abortWithError(deleteProjectReq.error);

          // Delete analyses, descriptions, prompts, and generation jobs owned by target project
          for (const analysis of allAnalyses) {
            if (analysis.projectId === projectId) {
              const delReq = stores.objectAnalyses.delete(analysis.id);
              delReq.onerror = () => abortWithError(delReq.error);
            }
          }

          for (const description of allDescriptions) {
            if (description.projectId === projectId) {
              const delReq = stores.objectDescriptions.delete(description.id);
              delReq.onerror = () => abortWithError(delReq.error);
            }
          }

          for (const promptDoc of allPrompts) {
            if (promptDoc.projectId === projectId) {
              const delReq = stores.promptDocuments.delete(promptDoc.id);
              delReq.onerror = () => abortWithError(delReq.error);
            }
          }

          for (const job of allJobs) {
            if (job.projectId === projectId) {
              const delReq = stores.generationHistory.delete(job.id);
              delReq.onerror = () => abortWithError(delReq.error);
            }
          }

          // Track which sourceAssets survive deletion (owned by or referenced by other projects)
          const deletedSourceAssetIds = new Set<EntityId>();
          for (const asset of allAssets) {
            const belongsToTarget =
              asset.projectId === projectId ||
              asset.id === targetProject.sourceAssetId;
            if (!belongsToTarget) {
              continue;
            }
            const sharedByOtherProject =
              referencedAssetIdsByOtherProjects.has(asset.id) ||
              asset.projectId !== projectId;
            if (!sharedByOtherProject) {
              deletedSourceAssetIds.add(asset.id);
              const deleteAssetReq = stores.sourceAssets.delete(asset.id);
              deleteAssetReq.onerror = () => abortWithError(deleteAssetReq.error);
            }
          }

          // Delete artworks owned by target project
          const deletedArtworkIds = new Set<EntityId>();
          const candidateBlobKeysForDeletion = new Set<string>();
          for (const artwork of allArtworks) {
            if (artwork.projectId === projectId) {
              deletedArtworkIds.add(artwork.id);
              const delArtReq = stores.generatedArtworks.delete(artwork.id);
              delArtReq.onerror = () => abortWithError(delArtReq.error);
              if (artwork.localBlobKey) {
                candidateBlobKeysForDeletion.add(artwork.localBlobKey);
              }
            }
          }

          for (const asset of allAssets) {
            if (deletedSourceAssetIds.has(asset.id) && asset.localBlobKey) {
              candidateBlobKeysForDeletion.add(asset.localBlobKey);
            }
          }

          for (const blobRecord of allBlobs) {
            if (
              blobRecord.projectId === projectId &&
              !referencedAssetIdsByOtherProjects.has(blobRecord.ownerAssetId)
            ) {
              candidateBlobKeysForDeletion.add(blobRecord.id);
            }
          }

          // Never delete any Blob key still referenced by surviving sourceAssets or surviving generatedArtworks
          const survivingBlobKeys = new Set<string>();
          for (const asset of allAssets) {
            if (!deletedSourceAssetIds.has(asset.id) && asset.localBlobKey) {
              survivingBlobKeys.add(asset.localBlobKey);
            }
          }
          for (const artwork of allArtworks) {
            if (!deletedArtworkIds.has(artwork.id) && artwork.localBlobKey) {
              survivingBlobKeys.add(artwork.localBlobKey);
            }
          }

          for (const blobKey of candidateBlobKeysForDeletion) {
            if (!survivingBlobKeys.has(blobKey) && blobIdsInStore.has(blobKey)) {
              const delBlobReq = stores.assetBlobs.delete(blobKey);
              delBlobReq.onerror = () => abortWithError(delBlobReq.error);
            }
          }

          settle(okResult(undefined));
        };

        projectsReq.onerror = () => abortWithError(projectsReq.error);
        projectsReq.onsuccess = () => {
          allProjects = (projectsReq.result as Project[] | undefined) ?? [];
          proceed();
        };

        assetsReq.onerror = () => abortWithError(assetsReq.error);
        assetsReq.onsuccess = () => {
          allAssets = (assetsReq.result as SourceAsset[] | undefined) ?? [];
          proceed();
        };

        blobsReq.onerror = () => abortWithError(blobsReq.error);
        blobsReq.onsuccess = () => {
          allBlobs = (blobsReq.result as PersistedAssetBlob[] | undefined) ?? [];
          proceed();
        };

        analysesReq.onerror = () => abortWithError(analysesReq.error);
        analysesReq.onsuccess = () => {
          allAnalyses = (analysesReq.result as ObjectAnalysis[] | undefined) ?? [];
          proceed();
        };

        descriptionsReq.onerror = () => abortWithError(descriptionsReq.error);
        descriptionsReq.onsuccess = () => {
          allDescriptions =
            (descriptionsReq.result as ObjectDescription[] | undefined) ?? [];
          proceed();
        };

        promptsReq.onerror = () => abortWithError(promptsReq.error);
        promptsReq.onsuccess = () => {
          allPrompts = (promptsReq.result as PromptDocument[] | undefined) ?? [];
          proceed();
        };

        jobsReq.onerror = () => abortWithError(jobsReq.error);
        jobsReq.onsuccess = () => {
          allJobs = (jobsReq.result as GenerationJob[] | undefined) ?? [];
          proceed();
        };

        artworksReq.onerror = () => abortWithError(artworksReq.error);
        artworksReq.onsuccess = () => {
          allArtworks = (artworksReq.result as GeneratedArtwork[] | undefined) ?? [];
          proceed();
        };
      },
    );

    if (!txRes.ok) {
      return txRes;
    }

    if (readStoredActiveProjectId() === projectId) {
      writeStoredActiveProjectId(null);
    }

    return okResult(undefined);
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

  async getOrCreateActiveProject(
    preferredProjectId?: EntityId | null,
  ): Promise<ServiceResult<Project>> {
    const candidateId =
      preferredProjectId && isValidEntityId(preferredProjectId)
        ? preferredProjectId
        : readStoredActiveProjectId();

    const listRes = await this.listProjects();
    if (!listRes.ok) {
      return listRes;
    }

    const nonArchived = listRes.data.filter(
      (item) => item.status !== 'archived',
    );
    const existing =
      (candidateId
        ? listRes.data.find((item) => item.id === candidateId)
        : undefined) ??
      nonArchived.find((item) => item.sourceAssetId !== null) ??
      nonArchived[0] ??
      null;

    if (existing) {
      writeStoredActiveProjectId(existing.id);
      return okResult(existing);
    }

    const now = nowIsoTimestamp();
    const freshId = candidateId ?? createEntityId('prj');
    const draft = createDraftProject(
      freshId,
      null,
      'Untitled Studio Study',
      now,
    );
    const saved = await this.saveProject(draft);
    if (!saved.ok) {
      return saved;
    }
    writeStoredActiveProjectId(saved.data.id);
    return saved;
  }

  async setProjectSelectedStyle(
    projectId: EntityId | null,
    styleId: EntityId | null,
    mode: CreativeDirectionMode = styleId ? 'curated' : 'manual',
  ): Promise<ServiceResult<Project>> {
    if (styleId !== null && !isValidEntityId(styleId)) {
      return errResult(
        'VALIDATION_ERROR',
        'A valid Art Style ID is required when selecting a curated style.',
      );
    }

    const projectRes = await this.getOrCreateActiveProject(projectId);
    if (!projectRes.ok) {
      return projectRes;
    }

    const now = nowIsoTimestamp();
    const existingConfig = projectRes.data.activeCreativeConfiguration ?? null;
    const nextConfig: ProjectCreativeConfiguration = {
      mode,
      selectedStyleId: styleId,
      appliedPresetId: null,
      appliedPresetName: null,
      creativeDirectionSnapshot: null,
      compositionPreferences: existingConfig?.compositionPreferences ?? null,
      userCreativeInstructions: existingConfig?.userCreativeInstructions ?? '',
      negativePromptOverride: '',
      updatedAt: now,
    };

    const updatedProject: Project = {
      ...projectRes.data,
      selectedStyleId: styleId,
      activeCreativeConfiguration: nextConfig,
      updatedAt: now,
    };

    const saved = await this.saveProject(updatedProject);
    if (!saved.ok) {
      return saved;
    }
    writeStoredActiveProjectId(saved.data.id);
    return saved;
  }

  async setProjectCreativeConfiguration(
    projectId: EntityId | null,
    config: ProjectCreativeConfiguration,
  ): Promise<ServiceResult<Project>> {
    const projectRes = await this.getOrCreateActiveProject(projectId);
    if (!projectRes.ok) {
      return projectRes;
    }

    const now = nowIsoTimestamp();
    const updatedProject: Project = {
      ...projectRes.data,
      selectedStyleId: config.selectedStyleId,
      activeCreativeConfiguration: {
        ...config,
        updatedAt: now,
      },
      updatedAt: now,
    };

    const saved = await this.saveProject(updatedProject);
    if (!saved.ok) {
      return saved;
    }
    writeStoredActiveProjectId(saved.data.id);
    return saved;
  }

  async saveOrReplaceProjectSourceAsset(
    input: SaveProjectSourceAssetInput,
  ): Promise<ServiceResult<PersistedSourceAssetResult>> {
    if (!isValidEntityId(input.projectId)) {
      return errResult(
        'VALIDATION_ERROR',
        'A valid projectId is required before persisting a source asset.',
      );
    }

    if (input.validatedAsset.validationStatus !== 'validated') {
      return errResult(
        'VALIDATION_ERROR',
        'Only validated source assets may be persisted to IndexedDB.',
      );
    }

    if (!isReadableBlob(input.binaryBlob)) {
      return errResult(
        'VALIDATION_ERROR',
        'A readable non-empty image Blob is required for persistence.',
      );
    }

    const now = nowIsoTimestamp();
    const blobKey = createEntityId('blb');

    const persistedAsset: SourceAsset = {
      ...input.validatedAsset,
      projectId: input.projectId,
      localBlobKey: blobKey,
      validationStatus: 'validated',
      storageStatus: 'persisted',
      updatedAt: now,
    };

    const blobRecord: PersistedAssetBlob = {
      id: blobKey,
      ownerAssetId: persistedAsset.id,
      projectId: input.projectId,
      mimeType: persistedAsset.mimeType,
      fileSizeBytes: persistedAsset.fileSizeBytes,
      blob: input.binaryBlob,
      createdAt: persistedAsset.createdAt,
      updatedAt: now,
    };

    const assetCheck = validateBasePersistedRecord('sourceAssets', persistedAsset);
    if (!assetCheck.ok) {
      return assetCheck;
    }

    const blobCheck = validateBasePersistedRecord('assetBlobs', blobRecord);
    if (!blobCheck.ok) {
      return blobCheck;
    }

    return this.gateway.executeTransaction(
      [
        'projects',
        'sourceAssets',
        'assetBlobs',
        'objectAnalyses',
        'objectDescriptions',
          'promptDocuments',
        'generationHistory',
        'generatedArtworks',
      ],
      'readwrite',
      (stores, { settle, abortWithError }) => {
        const projectsReq = stores.projects.getAll();
        const assetsReq = stores.sourceAssets.getAll();
        const analysesReq = stores.objectAnalyses.getAll();
        const descriptionsReq = stores.objectDescriptions.getAll();
        const promptsReq = stores.promptDocuments.getAll();
        const jobsReq = stores.generationHistory.getAll();
        const artworksReq = stores.generatedArtworks.getAll();

        let allProjects: Project[] | null = null;
        let allAssets: SourceAsset[] | null = null;
        let allAnalyses: ObjectAnalysis[] | null = null;
        let allDescriptions: ObjectDescription[] | null = null;
        let allPrompts: PromptDocument[] | null = null;
        let allJobs: GenerationJob[] | null = null;
        let allArtworks: GeneratedArtwork[] | null = null;

        const runMutations = () => {
          if (
            !allProjects ||
            !allAssets ||
            !allAnalyses ||
            !allDescriptions ||
            !allPrompts ||
            !allJobs ||
            !allArtworks
          ) {
            return;
          }

          const existingProject =
            allProjects.find((p) => p.id === input.projectId) ?? null;
          const previousAssetId = existingProject?.sourceAssetId ?? null;
          const assetWasReplaced =
            previousAssetId !== null && previousAssetId !== persistedAsset.id;

          const nextProject: Project = existingProject
            ? {
                ...existingProject,
                sourceAssetId: persistedAsset.id,
                ...(assetWasReplaced
                  ? {
                      activeAnalysisId: null,
                      activeDescriptionId: null,
                      activePromptId: null,
                      activeGenerationJobId: null,
                      status: 'draft' as const,
                    }
                  : {}),
                updatedAt: now,
              }
            : createDraftProject(
                input.projectId,
                persistedAsset.id,
                input.projectTitle ??
                  (input.validatedAsset.originalFileName.replace(/\.[^.]+$/, '') ||
                    'Untitled Studio Study'),
                now,
              );

          const projectValidation = validateBasePersistedRecord(
            'projects',
            nextProject,
          );
          if (!projectValidation.ok) {
            abortWithError(new Error(projectValidation.error.message));
            return;
          }

          const putBlobReq = stores.assetBlobs.put(blobRecord);
          putBlobReq.onerror = () => abortWithError(putBlobReq.error);

          const putAssetReq = stores.sourceAssets.put(persistedAsset);
          putAssetReq.onerror = () => abortWithError(putAssetReq.error);

          const putProjectReq = stores.projects.put(nextProject);
          putProjectReq.onerror = () => abortWithError(putProjectReq.error);

          let replacedAssetId: EntityId | null = null;
          if (assetWasReplaced && previousAssetId) {
            for (const oldAnalysis of allAnalyses) {
              if (
                oldAnalysis.projectId === input.projectId &&
                oldAnalysis.sourceAssetId === previousAssetId
              ) {
                const delAnlReq = stores.objectAnalyses.delete(oldAnalysis.id);
                delAnlReq.onerror = () => abortWithError(delAnlReq.error);
              }
            }
            for (const oldDesc of allDescriptions) {
              if (
                oldDesc.projectId === input.projectId &&
                oldDesc.sourceAssetId === previousAssetId
              ) {
                const delDescReq = stores.objectDescriptions.delete(oldDesc.id);
                delDescReq.onerror = () => abortWithError(delDescReq.error);
              }
            }
            for (const oldPrompt of allPrompts) {
              if (oldPrompt.projectId === input.projectId) {
                const delPromptReq = stores.promptDocuments.delete(oldPrompt.id);
                delPromptReq.onerror = () => abortWithError(delPromptReq.error);
              }
            }
            for (const oldJob of allJobs) {
              if (oldJob.projectId === input.projectId) {
                const delJobReq = stores.generationHistory.delete(oldJob.id);
                delJobReq.onerror = () => abortWithError(delJobReq.error);
              }
            }
            for (const oldArtwork of allArtworks) {
              if (oldArtwork.projectId === input.projectId) {
                const delArtReq = stores.generatedArtworks.delete(oldArtwork.id);
                delArtReq.onerror = () => abortWithError(delArtReq.error);
                if (oldArtwork.localBlobKey && oldArtwork.localBlobKey !== blobKey) {
                  const delArtBlobReq = stores.assetBlobs.delete(oldArtwork.localBlobKey);
                  delArtBlobReq.onerror = () => abortWithError(delArtBlobReq.error);
                }
              }
            }

            const referencedByOtherProject = allProjects.some(
              (p) => p.id !== input.projectId && p.sourceAssetId === previousAssetId,
            );
            if (!referencedByOtherProject) {
              replacedAssetId = previousAssetId;
              const previousAsset = allAssets.find((a) => a.id === previousAssetId);
              const delOldAssetReq = stores.sourceAssets.delete(previousAssetId);
              delOldAssetReq.onerror = () => abortWithError(delOldAssetReq.error);

              if (
                previousAsset?.localBlobKey &&
                previousAsset.localBlobKey !== blobKey
              ) {
                const oldBlobKey = previousAsset.localBlobKey;
                const blobUsedElsewhere = allAssets.some(
                  (a) => a.id !== previousAssetId && a.localBlobKey === oldBlobKey,
                );
                if (!blobUsedElsewhere) {
                  const delOldBlobReq = stores.assetBlobs.delete(oldBlobKey);
                  delOldBlobReq.onerror = () => abortWithError(delOldBlobReq.error);
                }
              }
            }
          }

          settle(
            okResult({
              project: nextProject,
              sourceAsset: persistedAsset,
              replacedAssetId,
            }),
          );
        };

        projectsReq.onerror = () => abortWithError(projectsReq.error);
        projectsReq.onsuccess = () => {
          allProjects = (projectsReq.result as Project[] | undefined) ?? [];
          runMutations();
        };

        assetsReq.onerror = () => abortWithError(assetsReq.error);
        assetsReq.onsuccess = () => {
          allAssets = (assetsReq.result as SourceAsset[] | undefined) ?? [];
          runMutations();
        };

        analysesReq.onerror = () => abortWithError(analysesReq.error);
        analysesReq.onsuccess = () => {
          allAnalyses = (analysesReq.result as ObjectAnalysis[] | undefined) ?? [];
          runMutations();
        };

        descriptionsReq.onerror = () => abortWithError(descriptionsReq.error);
        descriptionsReq.onsuccess = () => {
          allDescriptions =
            (descriptionsReq.result as ObjectDescription[] | undefined) ?? [];
          runMutations();
        };

        promptsReq.onerror = () => abortWithError(promptsReq.error);
        promptsReq.onsuccess = () => {
          allPrompts = (promptsReq.result as PromptDocument[] | undefined) ?? [];
          runMutations();
        };

        jobsReq.onerror = () => abortWithError(jobsReq.error);
        jobsReq.onsuccess = () => {
          allJobs = (jobsReq.result as GenerationJob[] | undefined) ?? [];
          runMutations();
        };

        artworksReq.onerror = () => abortWithError(artworksReq.error);
        artworksReq.onsuccess = () => {
          allArtworks = (artworksReq.result as GeneratedArtwork[] | undefined) ?? [];
          runMutations();
        };
      },
    );
  }

  async getProjectSourceAsset(
    projectId: EntityId,
  ): Promise<ServiceResult<RestoredSourceAssetResult | null>> {
    return this.gateway.executeTransaction(
      ['projects', 'sourceAssets', 'assetBlobs'],
      'readonly',
      (stores, { settle, abortWithError, abortWithMessage }) => {
        const projectReq = stores.projects.get(projectId);
        projectReq.onerror = () => abortWithError(projectReq.error);
        projectReq.onsuccess = () => {
          const project = projectReq.result as Project | undefined;
          if (!project) {
            settle(okResult(null));
            return;
          }

          if (project.sourceAssetId === null) {
            settle(
              okResult({
                project,
                sourceAsset: null,
                blob: null,
              }),
            );
            return;
          }

          const assetReq = stores.sourceAssets.get(project.sourceAssetId);
          assetReq.onerror = () => abortWithError(assetReq.error);
          assetReq.onsuccess = () => {
            const asset = assetReq.result as SourceAsset | undefined;
            if (
              !asset ||
              asset.projectId !== project.id ||
              !asset.localBlobKey
            ) {
              abortWithMessage(
                'missing_or_corrupted_asset',
                'Saved source asset metadata is missing or no longer matches the active study.',
              );
              return;
            }

            const blobReq = stores.assetBlobs.get(asset.localBlobKey);
            blobReq.onerror = () => abortWithError(blobReq.error);
            blobReq.onsuccess = () => {
              const blobRecord = blobReq.result as PersistedAssetBlob | undefined;
              if (
                !blobRecord ||
                blobRecord.ownerAssetId !== asset.id ||
                blobRecord.projectId !== project.id ||
                !isReadableBlob(blobRecord.blob)
              ) {
                abortWithMessage(
                  'missing_or_corrupted_asset',
                  'Saved source image binary data is missing or unreadable in local storage.',
                );
                return;
              }

              settle(
                okResult({
                  project,
                  sourceAsset: asset,
                  blob: blobRecord.blob,
                }),
              );
            };
          };
        };
      },
    );
  }

  async restoreActiveSourceAsset(
    preferredProjectId?: EntityId | null,
  ): Promise<ServiceResult<RestoredSourceAssetResult | null>> {
    return this.gateway.executeTransaction(
      ['projects', 'sourceAssets', 'assetBlobs'],
      'readonly',
      (stores, { settle, abortWithError, abortWithMessage }) => {
        const projectsReq = stores.projects.getAll();
        projectsReq.onerror = () => abortWithError(projectsReq.error);
        projectsReq.onsuccess = () => {
          const allProjects = (projectsReq.result as Project[] | undefined) ?? [];
          if (allProjects.length === 0) {
            settle(okResult(null));
            return;
          }

          const sorted = [...allProjects].sort((a, b) =>
            b.updatedAt.localeCompare(a.updatedAt),
          );
          const preferred =
            preferredProjectId && isValidEntityId(preferredProjectId)
              ? sorted.find((p) => p.id === preferredProjectId) ?? null
              : null;
          const nonArchived = sorted.filter((p) => p.status !== 'archived');
          const activeProject =
            preferred ??
            nonArchived.find((p) => p.sourceAssetId !== null) ??
            nonArchived[0] ??
            null;

          if (!activeProject) {
            settle(okResult(null));
            return;
          }

          if (activeProject.sourceAssetId === null) {
            settle(
              okResult({
                project: activeProject,
                sourceAsset: null,
                blob: null,
              }),
            );
            return;
          }

          const assetReq = stores.sourceAssets.get(activeProject.sourceAssetId);
          assetReq.onerror = () => abortWithError(assetReq.error);
          assetReq.onsuccess = () => {
            const asset = assetReq.result as SourceAsset | undefined;
            if (
              !asset ||
              asset.projectId !== activeProject.id ||
              !asset.localBlobKey
            ) {
              abortWithMessage(
                'missing_or_corrupted_asset',
                'Saved source asset metadata is missing or inconsistent with the active study.',
              );
              return;
            }

            const blobReq = stores.assetBlobs.get(asset.localBlobKey);
            blobReq.onerror = () => abortWithError(blobReq.error);
            blobReq.onsuccess = () => {
              const blobRecord = blobReq.result as PersistedAssetBlob | undefined;
              if (
                !blobRecord ||
                blobRecord.ownerAssetId !== asset.id ||
                blobRecord.projectId !== activeProject.id ||
                !isReadableBlob(blobRecord.blob)
              ) {
                abortWithMessage(
                  'missing_or_corrupted_asset',
                  'Saved source image binary data is missing or unreadable in local storage.',
                );
                return;
              }

              settle(
                okResult({
                  project: activeProject,
                  sourceAsset: asset,
                  blob: blobRecord.blob,
                }),
              );
            };
          };
        };
      },
    );
  }

  async removeProjectSourceAsset(
    projectId: EntityId,
  ): Promise<ServiceResult<Project | null>> {
    if (!isValidEntityId(projectId)) {
      return errResult('VALIDATION_ERROR', 'Invalid projectId for asset removal.');
    }

    const now = nowIsoTimestamp();

    return this.gateway.executeTransaction(
      [
        'projects',
        'sourceAssets',
        'assetBlobs',
        'objectAnalyses',
        'objectDescriptions',
        'promptDocuments',
        'generationHistory',
        'generatedArtworks',
      ],
      'readwrite',
      (stores, { settle, abortWithError }) => {
        const projectsReq = stores.projects.getAll();
        const assetsReq = stores.sourceAssets.getAll();
        const analysesReq = stores.objectAnalyses.getAll();
        const descriptionsReq = stores.objectDescriptions.getAll();
        const promptsReq = stores.promptDocuments.getAll();
        const jobsReq = stores.generationHistory.getAll();
        const artworksReq = stores.generatedArtworks.getAll();

        let allProjects: Project[] | null = null;
        let allAssets: SourceAsset[] | null = null;
        let allAnalyses: ObjectAnalysis[] | null = null;
        let allDescriptions: ObjectDescription[] | null = null;
        let allPrompts: PromptDocument[] | null = null;
        let allJobs: GenerationJob[] | null = null;
        let allArtworks: GeneratedArtwork[] | null = null;

        const runRemoval = () => {
          if (
            !allProjects ||
            !allAssets ||
            !allAnalyses ||
            !allDescriptions ||
            !allPrompts ||
            !allJobs ||
            !allArtworks
          ) {
            return;
          }

          const existingProject =
            allProjects.find((p) => p.id === projectId) ?? null;
          if (!existingProject) {
            settle(okResult(null));
            return;
          }

          const targetAssetId = existingProject.sourceAssetId;
          const updatedProject: Project = {
            ...existingProject,
            sourceAssetId: null,
            activeAnalysisId: null,
            activeDescriptionId: null,
            activePromptId: null,
            activeGenerationJobId: null,
            status: 'draft',
            updatedAt: now,
          };

          const putProjectReq = stores.projects.put(updatedProject);
          putProjectReq.onerror = () => abortWithError(putProjectReq.error);

          for (const analysis of allAnalyses) {
            if (analysis.projectId === projectId) {
              const delAnlReq = stores.objectAnalyses.delete(analysis.id);
              delAnlReq.onerror = () => abortWithError(delAnlReq.error);
            }
          }

          for (const description of allDescriptions) {
            if (description.projectId === projectId) {
              const delDescReq = stores.objectDescriptions.delete(description.id);
              delDescReq.onerror = () => abortWithError(delDescReq.error);
            }
          }

          for (const promptDoc of allPrompts) {
            if (promptDoc.projectId === projectId) {
              const delPromptReq = stores.promptDocuments.delete(promptDoc.id);
              delPromptReq.onerror = () => abortWithError(delPromptReq.error);
            }
          }

          for (const job of allJobs) {
            if (job.projectId === projectId) {
              const delJobReq = stores.generationHistory.delete(job.id);
              delJobReq.onerror = () => abortWithError(delJobReq.error);
            }
          }

          for (const artwork of allArtworks) {
            if (artwork.projectId === projectId) {
              const delArtReq = stores.generatedArtworks.delete(artwork.id);
              delArtReq.onerror = () => abortWithError(delArtReq.error);
              if (artwork.localBlobKey) {
                const delArtBlobReq = stores.assetBlobs.delete(artwork.localBlobKey);
                delArtBlobReq.onerror = () => abortWithError(delArtBlobReq.error);
              }
            }
          }

          if (targetAssetId) {
            const referencedByOtherProject = allProjects.some(
              (p) => p.id !== projectId && p.sourceAssetId === targetAssetId,
            );
            if (!referencedByOtherProject) {
              const targetAsset = allAssets.find((a) => a.id === targetAssetId);
              const delAssetReq = stores.sourceAssets.delete(targetAssetId);
              delAssetReq.onerror = () => abortWithError(delAssetReq.error);

              if (targetAsset?.localBlobKey) {
                const blobKey = targetAsset.localBlobKey;
                const blobReferencedElsewhere = allAssets.some(
                  (a) => a.id !== targetAssetId && a.localBlobKey === blobKey,
                );
                if (!blobReferencedElsewhere) {
                  const delBlobReq = stores.assetBlobs.delete(blobKey);
                  delBlobReq.onerror = () => abortWithError(delBlobReq.error);
                }
              }
            }
          }

          settle(okResult(updatedProject));
        };

        projectsReq.onerror = () => abortWithError(projectsReq.error);
        projectsReq.onsuccess = () => {
          allProjects = (projectsReq.result as Project[] | undefined) ?? [];
          runRemoval();
        };

        assetsReq.onerror = () => abortWithError(assetsReq.error);
        assetsReq.onsuccess = () => {
          allAssets = (assetsReq.result as SourceAsset[] | undefined) ?? [];
          runRemoval();
        };

        analysesReq.onerror = () => abortWithError(analysesReq.error);
        analysesReq.onsuccess = () => {
          allAnalyses = (analysesReq.result as ObjectAnalysis[] | undefined) ?? [];
          runRemoval();
        };

        descriptionsReq.onerror = () => abortWithError(descriptionsReq.error);
        descriptionsReq.onsuccess = () => {
          allDescriptions =
            (descriptionsReq.result as ObjectDescription[] | undefined) ?? [];
          runRemoval();
        };

        promptsReq.onerror = () => abortWithError(promptsReq.error);
        promptsReq.onsuccess = () => {
          allPrompts = (promptsReq.result as PromptDocument[] | undefined) ?? [];
          runRemoval();
        };

        jobsReq.onerror = () => abortWithError(jobsReq.error);
        jobsReq.onsuccess = () => {
          allJobs = (jobsReq.result as GenerationJob[] | undefined) ?? [];
          runRemoval();
        };

        artworksReq.onerror = () => abortWithError(artworksReq.error);
        artworksReq.onsuccess = () => {
          allArtworks = (artworksReq.result as GeneratedArtwork[] | undefined) ?? [];
          runRemoval();
        };
      },
    );
  }

  async saveAnalysisAndInitialDescription(
    input: SaveAnalysisAndDescriptionInput,
  ): Promise<
    ServiceResult<{
      readonly project: Project;
      readonly analysis: ObjectAnalysis;
      readonly description: ObjectDescription;
    }>
  > {
    if (!isValidEntityId(input.projectId)) {
      return errResult(
        'VALIDATION_ERROR',
        'A valid projectId is required to save object analysis.',
      );
    }

    if (
      input.analysis.projectId !== input.projectId ||
      input.description.projectId !== input.projectId ||
      input.description.analysisId !== input.analysis.id ||
      input.description.sourceAssetId !== input.analysis.sourceAssetId
    ) {
      return errResult(
        'VALIDATION_ERROR',
        'ObjectAnalysis and ObjectDescription identifiers do not match the active project and source asset.',
      );
    }

    const analysisValidation = validateBasePersistedRecord(
      'objectAnalyses',
      input.analysis,
    );
    if (!analysisValidation.ok) {
      return analysisValidation;
    }

    const descriptionValidation = validateBasePersistedRecord(
      'objectDescriptions',
      input.description,
    );
    if (!descriptionValidation.ok) {
      return descriptionValidation;
    }

    const now = nowIsoTimestamp();

    return this.gateway.executeTransaction(
      ['projects', 'objectAnalyses', 'objectDescriptions'],
      'readwrite',
      (stores, { settle, abortWithError, abortWithMessage }) => {
        const projectReq = stores.projects.get(input.projectId);
        projectReq.onerror = () => abortWithError(projectReq.error);
        projectReq.onsuccess = () => {
          const existingProject = projectReq.result as Project | undefined;
          if (!existingProject) {
            abortWithMessage(
              'constraint_or_validation',
              'Active project could not be found in local storage.',
            );
            return;
          }

          if (existingProject.sourceAssetId !== input.analysis.sourceAssetId) {
            abortWithMessage(
              'constraint_or_validation',
              'Object analysis does not match the project active source image.',
            );
            return;
          }

          const existingAnalysisReq = stores.objectAnalyses.get(input.analysis.id);
          existingAnalysisReq.onerror = () => abortWithError(existingAnalysisReq.error);
          existingAnalysisReq.onsuccess = () => {
            if (existingAnalysisReq.result) {
              abortWithMessage(
                'constraint_or_validation',
                'Original AI analysis records are immutable and cannot be overwritten in place.',
              );
              return;
            }

            const updatedProject: Project = {
              ...existingProject,
              activeAnalysisId: input.analysis.id,
              activeDescriptionId: input.description.id,
              status:
                existingProject.status === 'draft'
                  ? 'analyzed'
                  : existingProject.status,
              updatedAt: now,
            };

            const putAnalysisReq = stores.objectAnalyses.put(input.analysis);
            putAnalysisReq.onerror = () => abortWithError(putAnalysisReq.error);

            const putDescriptionReq = stores.objectDescriptions.put(
              input.description,
            );
            putDescriptionReq.onerror = () =>
              abortWithError(putDescriptionReq.error);

            const putProjectReq = stores.projects.put(updatedProject);
            putProjectReq.onerror = () => abortWithError(putProjectReq.error);

            settle(
              okResult({
                project: updatedProject,
                analysis: input.analysis,
                description: input.description,
              }),
            );
          };
        };
      },
    );
  }

  async saveEditedObjectDescription(
    description: ObjectDescription,
  ): Promise<
    ServiceResult<{
      readonly project: Project;
      readonly analysis: ObjectAnalysis;
      readonly description: ObjectDescription;
    }>
  > {
    const validation = validateBasePersistedRecord(
      'objectDescriptions',
      description,
    );
    if (!validation.ok) {
      return validation;
    }

    const now = nowIsoTimestamp();

    return this.gateway.executeTransaction(
      ['projects', 'objectAnalyses', 'objectDescriptions'],
      'readwrite',
      (stores, { settle, abortWithError, abortWithMessage }) => {
        const projectReq = stores.projects.get(description.projectId);
        const analysisReq = stores.objectAnalyses.get(description.analysisId);

        let project: Project | undefined;
        let analysis: ObjectAnalysis | undefined;
        let loaded = 0;

        const proceed = () => {
          loaded += 1;
          if (loaded < 2) {
            return;
          }

          if (!project) {
            abortWithMessage(
              'constraint_or_validation',
              'Active project could not be found while saving object description.',
            );
            return;
          }

          if (!analysis || analysis.projectId !== project.id) {
            abortWithMessage(
              'constraint_or_validation',
              'Referenced Original AI Analysis record could not be found for this study.',
            );
            return;
          }

          if (description.sourceAssetId !== analysis.sourceAssetId) {
            abortWithMessage(
              'constraint_or_validation',
              'Object description source asset does not match the referenced analysis.',
            );
            return;
          }

          const updatedProject: Project = {
            ...project,
            activeAnalysisId: analysis.id,
            activeDescriptionId: description.id,
            updatedAt: now,
          };

          // Strictly write ONLY to objectDescriptions and projects; objectAnalyses remains immutable.
          const putDescReq = stores.objectDescriptions.put(description);
          putDescReq.onerror = () => abortWithError(putDescReq.error);

          const putProjReq = stores.projects.put(updatedProject);
          putProjReq.onerror = () => abortWithError(putProjReq.error);

          settle(
            okResult({
              project: updatedProject,
              analysis,
              description,
            }),
          );
        };

        projectReq.onerror = () => abortWithError(projectReq.error);
        projectReq.onsuccess = () => {
          project = projectReq.result as Project | undefined;
          proceed();
        };

        analysisReq.onerror = () => abortWithError(analysisReq.error);
        analysisReq.onsuccess = () => {
          analysis = analysisReq.result as ObjectAnalysis | undefined;
          proceed();
        };
      },
    );
  }

  async resetObjectDescriptionFromAnalysis(
    input: ResetObjectDescriptionInput,
  ): Promise<
    ServiceResult<{
      readonly project: Project;
      readonly analysis: ObjectAnalysis;
      readonly description: ObjectDescription;
    }>
  > {
    if (!isValidEntityId(input.projectId) || !isValidEntityId(input.analysisId)) {
      return errResult(
        'VALIDATION_ERROR',
        'Valid projectId and analysisId are required to reset the object description.',
      );
    }

    if (
      input.resetDescription.projectId !== input.projectId ||
      input.resetDescription.analysisId !== input.analysisId
    ) {
      return errResult(
        'VALIDATION_ERROR',
        'Reset description does not match the active project or analysis.',
      );
    }

    const validation = validateBasePersistedRecord(
      'objectDescriptions',
      input.resetDescription,
    );
    if (!validation.ok) {
      return validation;
    }

    const now = nowIsoTimestamp();

    return this.gateway.executeTransaction(
      ['projects', 'objectAnalyses', 'objectDescriptions'],
      'readwrite',
      (stores, { settle, abortWithError, abortWithMessage }) => {
        const projectReq = stores.projects.get(input.projectId);
        const analysisReq = stores.objectAnalyses.get(input.analysisId);

        let project: Project | undefined;
        let analysis: ObjectAnalysis | undefined;
        let loaded = 0;

        const proceed = () => {
          loaded += 1;
          if (loaded < 2) {
            return;
          }

          if (!project) {
            abortWithMessage(
              'constraint_or_validation',
              'Active project could not be found in IndexedDB.',
            );
            return;
          }

          if (!analysis || analysis.projectId !== project.id) {
            abortWithMessage(
              'constraint_or_validation',
              'Original AI Analysis record is missing and cannot be used for reset.',
            );
            return;
          }

          const updatedProject: Project = {
            ...project,
            activeAnalysisId: analysis.id,
            activeDescriptionId: input.resetDescription.id,
            updatedAt: now,
          };

          const putDescReq = stores.objectDescriptions.put(
            input.resetDescription,
          );
          putDescReq.onerror = () => abortWithError(putDescReq.error);

          const putProjReq = stores.projects.put(updatedProject);
          putProjReq.onerror = () => abortWithError(putProjReq.error);

          settle(
            okResult({
              project: updatedProject,
              analysis,
              description: input.resetDescription,
            }),
          );
        };

        projectReq.onerror = () => abortWithError(projectReq.error);
        projectReq.onsuccess = () => {
          project = projectReq.result as Project | undefined;
          proceed();
        };

        analysisReq.onerror = () => abortWithError(analysisReq.error);
        analysisReq.onsuccess = () => {
          analysis = analysisReq.result as ObjectAnalysis | undefined;
          proceed();
        };
      },
    );
  }

  async getProjectObjectAnalysisState(
    projectId: EntityId,
  ): Promise<ServiceResult<PersistedObjectAnalysisState | null>> {
    if (!isValidEntityId(projectId)) {
      return okResult(null);
    }

    return this.gateway.executeTransaction(
      ['projects', 'objectAnalyses', 'objectDescriptions'],
      'readonly',
      (stores, { settle, abortWithError }) => {
        const projectReq = stores.projects.get(projectId);
        projectReq.onerror = () => abortWithError(projectReq.error);
        projectReq.onsuccess = () => {
          const project = projectReq.result as Project | undefined;
          if (!project) {
            settle(okResult(null));
            return;
          }

          if (!project.activeAnalysisId) {
            settle(
              okResult({
                project,
                analysis: null,
                description: null,
              }),
            );
            return;
          }

          const analysisReq = stores.objectAnalyses.get(project.activeAnalysisId);
          analysisReq.onerror = () => abortWithError(analysisReq.error);
          analysisReq.onsuccess = () => {
            const analysis =
              (analysisReq.result as ObjectAnalysis | undefined) ?? null;
            if (
              !analysis ||
              analysis.projectId !== project.id ||
              (project.sourceAssetId !== null &&
                analysis.sourceAssetId !== project.sourceAssetId)
            ) {
              settle(
                okResult({
                  project,
                  analysis: null,
                  description: null,
                }),
              );
              return;
            }

            if (!project.activeDescriptionId) {
              settle(
                okResult({
                  project,
                  analysis,
                  description: null,
                }),
              );
              return;
            }

            const descReq = stores.objectDescriptions.get(
              project.activeDescriptionId,
            );
            descReq.onerror = () => abortWithError(descReq.error);
            descReq.onsuccess = () => {
              const description =
                (descReq.result as ObjectDescription | undefined) ?? null;
              if (
                !description ||
                description.projectId !== project.id ||
                description.analysisId !== analysis.id
              ) {
                settle(
                  okResult({
                    project,
                    analysis,
                    description: null,
                  }),
                );
                return;
              }

              settle(
                okResult({
                  project,
                  analysis,
                  description,
                }),
              );
            };
          };
        };
      },
    );
  }

  async savePromptDocumentRevision(
    promptDocument: PromptDocument,
  ): Promise<ServiceResult<PersistedPromptState>> {
    if (promptDocument.promptKind === 'variation') {
      return errResult(
        'VALIDATION_ERROR',
        'Child variation prompts must be persisted independently and cannot overwrite the active Final Master Prompt.',
      );
    }

    const validation = validateBasePersistedRecord(
      'promptDocuments',
      promptDocument,
    );
    if (!validation.ok) {
      return validation;
    }

    const now = nowIsoTimestamp();

    return this.gateway.executeTransaction(
      ['projects', 'objectDescriptions', 'promptDocuments'],
      'readwrite',
      (stores, { settle, abortWithError, abortWithMessage }) => {
        const projectReq = stores.projects.get(promptDocument.projectId);
        const descReq = stores.objectDescriptions.get(
          promptDocument.descriptionId,
        );
        const promptsReq = stores.promptDocuments.getAll();

        let project: Project | undefined;
        let description: ObjectDescription | undefined;
        let allPrompts: PromptDocument[] | undefined;
        let loaded = 0;

        const proceed = () => {
          loaded += 1;
          if (loaded < 3) {
            return;
          }

          if (!project) {
            abortWithMessage(
              'constraint_or_validation',
              'Active study project could not be found while saving PromptDocument.',
            );
            return;
          }

          if (!description || description.projectId !== project.id) {
            abortWithMessage(
              'constraint_or_validation',
              'Referenced Editable Object Description could not be found for this study.',
            );
            return;
          }

          const projectPrompts = (allPrompts ?? []).filter(
            (item) => item.projectId === project!.id,
          );
          const existingSameId = projectPrompts.find(
            (item) => item.id === promptDocument.id,
          );

          if (existingSameId) {
            if (existingSameId.generatedPrompt !== promptDocument.generatedPrompt) {
              abortWithMessage(
                'constraint_or_validation',
                'Original AI-generated prompt baseline (generatedPrompt) is immutable and cannot be modified.',
              );
              return;
            }
            if (existingSameId.approvalStatus === 'approved') {
              abortWithMessage(
                'constraint_or_validation',
                'Approved prompt revisions cannot be overwritten in place. Unlock and create a new revision instead.',
              );
              return;
            }
          }

          const updatedProject: Project = {
            ...project,
            activePromptId: promptDocument.id,
            selectedStyleId:
              promptDocument.selectedStyleId ?? promptDocument.styleId ?? null,
            status:
              project.status === 'generated' || project.status === 'archived'
                ? project.status
                : 'prompt_ready',
            updatedAt: now,
          };

          const putPromptReq = stores.promptDocuments.put(promptDocument);
          putPromptReq.onerror = () => abortWithError(putPromptReq.error);

          const putProjectReq = stores.projects.put(updatedProject);
          putProjectReq.onerror = () => abortWithError(putProjectReq.error);

          const projectMasterPrompts = projectPrompts.filter(
            (item) => item.promptKind !== 'variation',
          );
          const nextRevisionMap = new Map<EntityId, PromptDocument>();
          for (const item of projectMasterPrompts) {
            nextRevisionMap.set(item.id, item);
          }
          nextRevisionMap.set(promptDocument.id, promptDocument);

          const sortedRevisions = Array.from(nextRevisionMap.values()).sort(
            (a, b) =>
              (b.revisionNumber ?? b.revision) - (a.revisionNumber ?? a.revision) ||
              b.updatedAt.localeCompare(a.updatedAt),
          );

          settle(
            okResult({
              project: updatedProject,
              activePrompt: promptDocument,
              revisions: sortedRevisions,
            }),
          );
        };

        projectReq.onerror = () => abortWithError(projectReq.error);
        projectReq.onsuccess = () => {
          project = projectReq.result as Project | undefined;
          proceed();
        };

        descReq.onerror = () => abortWithError(descReq.error);
        descReq.onsuccess = () => {
          description = descReq.result as ObjectDescription | undefined;
          proceed();
        };

        promptsReq.onerror = () => abortWithError(promptsReq.error);
        promptsReq.onsuccess = () => {
          allPrompts =
            (promptsReq.result as PromptDocument[] | undefined) ?? [];
          proceed();
        };
      },
    );
  }

  async getProjectPromptState(
    projectId: EntityId,
  ): Promise<ServiceResult<PersistedPromptState | null>> {
    if (!isValidEntityId(projectId)) {
      return okResult(null);
    }

    return this.gateway.executeTransaction(
      ['projects', 'promptDocuments'],
      'readonly',
      (stores, { settle, abortWithError }) => {
        const projectReq = stores.projects.get(projectId);
        const promptsReq = stores.promptDocuments.getAll();

        let project: Project | undefined;
        let allPrompts: PromptDocument[] | undefined;
        let loaded = 0;

        const proceed = () => {
          loaded += 1;
          if (loaded < 2) {
            return;
          }

          if (!project) {
            settle(okResult(null));
            return;
          }

          const revisions = (allPrompts ?? [])
            .filter(
              (item) =>
                item.projectId === project!.id && item.promptKind !== 'variation',
            )
            .sort(
              (a, b) =>
                (b.revisionNumber ?? b.revision) -
                  (a.revisionNumber ?? a.revision) ||
                b.updatedAt.localeCompare(a.updatedAt),
            );

          const activePrompt = project.activePromptId
            ? revisions.find((item) => item.id === project!.activePromptId) ??
              revisions[0] ??
              null
            : revisions[0] ?? null;

          settle(
            okResult({
              project,
              activePrompt,
              revisions,
            }),
          );
        };

        projectReq.onerror = () => abortWithError(projectReq.error);
        projectReq.onsuccess = () => {
          project = projectReq.result as Project | undefined;
          proceed();
        };

        promptsReq.onerror = () => abortWithError(promptsReq.error);
        promptsReq.onsuccess = () => {
          allPrompts =
            (promptsReq.result as PromptDocument[] | undefined) ?? [];
          proceed();
        };
      },
    );
  }

  async listProjectPromptDocuments(
    projectId: EntityId,
  ): Promise<ServiceResult<readonly PromptDocument[]>> {
    const state = await this.getProjectPromptState(projectId);
    if (!state.ok) {
      return state;
    }
    return okResult(state.data?.revisions ?? []);
  }

  async saveGeneratedArtworkResult(
    input: SaveGenerationResultInput,
  ): Promise<ServiceResult<PersistedGenerationState>> {
    const { job, artwork, imageBlob, variationPromptDocument } = input;

    if (
      job.projectId !== artwork.projectId ||
      artwork.generationJobId !== job.id ||
      artwork.promptDocumentId !== job.promptDocumentId ||
      !job.artworkIds.includes(artwork.id)
    ) {
      return errResult(
        'VALIDATION_ERROR',
        'GenerationJob and GeneratedArtwork identifiers do not match the active study and approved prompt.',
      );
    }

    if (!isReadableBlob(imageBlob)) {
      return errResult(
        'VALIDATION_ERROR',
        'A readable non-empty generated image Blob is required for local persistence.',
      );
    }

    if (variationPromptDocument) {
      if (
        variationPromptDocument.projectId !== job.projectId ||
        variationPromptDocument.promptKind !== 'variation' ||
        variationPromptDocument.approvalStatus !== 'approved' ||
        variationPromptDocument.id !== job.promptDocumentId
      ) {
        return errResult(
          'VALIDATION_ERROR',
          'Child variation prompt document must be approved and match the variation generation job.',
        );
      }
      const varPromptValidation = validateBasePersistedRecord(
        'promptDocuments',
        variationPromptDocument,
      );
      if (!varPromptValidation.ok) {
        return varPromptValidation;
      }
    }

    const normalizedKind = resolveGenerationKind(job, variationPromptDocument ?? null);
    const persistedJob: GenerationJob = {
      ...job,
      generationKind: normalizedKind,
      parentGenerationId: job.parentGenerationId ?? null,
      parentPromptId: job.parentPromptId ?? null,
      variationId: job.variationId ?? null,
      variationPromptId: job.variationPromptId ?? null,
      variationInstructions: job.variationInstructions ?? null,
      variationLabel: job.variationLabel ?? null,
    };

    const persistedArtwork: GeneratedArtwork = {
      ...artwork,
      fileSizeBytes: artwork.fileSizeBytes ?? imageBlob.size,
      generationKind: normalizedKind,
      parentGenerationId: artwork.parentGenerationId ?? job.parentGenerationId ?? null,
      variationId: artwork.variationId ?? job.variationId ?? null,
      variationLabel: artwork.variationLabel ?? job.variationLabel ?? null,
    };

    const jobValidation = validateBasePersistedRecord('generationHistory', persistedJob);
    if (!jobValidation.ok) {
      return jobValidation;
    }

    const artworkValidation = validateBasePersistedRecord(
      'generatedArtworks',
      persistedArtwork,
    );
    if (!artworkValidation.ok) {
      return artworkValidation;
    }

    const now = nowIsoTimestamp();
    const blobRecord: PersistedAssetBlob = {
      id: persistedArtwork.localBlobKey,
      ownerAssetId: persistedArtwork.id,
      projectId: persistedArtwork.projectId,
      mimeType: persistedArtwork.mimeType,
      fileSizeBytes: imageBlob.size,
      blob: imageBlob,
      createdAt: persistedArtwork.createdAt,
      updatedAt: now,
    };

    const blobValidation = validateBasePersistedRecord('assetBlobs', blobRecord);
    if (!blobValidation.ok) {
      return blobValidation;
    }

    return this.gateway.executeTransaction(
      [
        'projects',
        'promptDocuments',
        'generationHistory',
        'generatedArtworks',
        'assetBlobs',
      ],
      'readwrite',
      (stores, { settle, abortWithError, abortWithMessage }) => {
        const projectReq = stores.projects.get(persistedJob.projectId);
        const promptLookupId = variationPromptDocument
          ? (variationPromptDocument.parentPromptId ?? persistedJob.promptDocumentId)
          : persistedJob.promptDocumentId;
        const promptReq = stores.promptDocuments.get(promptLookupId);
        const jobsReq = stores.generationHistory.getAll();

        let project: Project | undefined;
        let promptDoc: PromptDocument | undefined;
        let allJobs: GenerationJob[] | undefined;
        let loaded = 0;

        const proceed = () => {
          loaded += 1;
          if (loaded < 3) {
            return;
          }

          if (!project) {
            abortWithMessage(
              'constraint_or_validation',
              'Active project could not be found while saving generated artwork.',
            );
            return;
          }

          if (
            !promptDoc ||
            promptDoc.projectId !== project.id ||
            promptDoc.approvalStatus !== 'approved'
          ) {
            abortWithMessage(
              'constraint_or_validation',
              'Referenced PromptDocument is missing or not approved in IndexedDB.',
            );
            return;
          }

          if (variationPromptDocument) {
            const putVarPromptReq = stores.promptDocuments.put(variationPromptDocument);
            putVarPromptReq.onerror = () => abortWithError(putVarPromptReq.error);
          }

          // Preserve all original source asset, analysis, description, style, and master activePromptId links.
          const updatedProject: Project = {
            ...project,
            activeGenerationJobId: persistedJob.id,
            status: project.status === 'archived' ? 'archived' : 'generated',
            updatedAt: now,
          };

          const putBlobReq = stores.assetBlobs.put(blobRecord);
          putBlobReq.onerror = () => abortWithError(putBlobReq.error);

          const putArtworkReq = stores.generatedArtworks.put(persistedArtwork);
          putArtworkReq.onerror = () => abortWithError(putArtworkReq.error);

          const putJobReq = stores.generationHistory.put(persistedJob);
          putJobReq.onerror = () => abortWithError(putJobReq.error);

          const putProjectReq = stores.projects.put(updatedProject);
          putProjectReq.onerror = () => abortWithError(putProjectReq.error);

          const jobMap = new Map<EntityId, GenerationJob>();
          for (const item of allJobs ?? []) {
            if (item.projectId === project.id) {
              jobMap.set(item.id, item);
            }
          }
          jobMap.set(persistedJob.id, persistedJob);

          const sortedHistory = Array.from(jobMap.values()).sort(
            (a, b) =>
              b.queuedAt.localeCompare(a.queuedAt) ||
              b.updatedAt.localeCompare(a.updatedAt),
          );

          settle(
            okResult({
              project: updatedProject,
              latestJob: persistedJob,
              artwork: persistedArtwork,
              imageBlob,
              jobHistory: sortedHistory,
            }),
          );
        };

        projectReq.onerror = () => abortWithError(projectReq.error);
        projectReq.onsuccess = () => {
          project = projectReq.result as Project | undefined;
          proceed();
        };

        promptReq.onerror = () => abortWithError(promptReq.error);
        promptReq.onsuccess = () => {
          promptDoc = promptReq.result as PromptDocument | undefined;
          proceed();
        };

        jobsReq.onerror = () => abortWithError(jobsReq.error);
        jobsReq.onsuccess = () => {
          allJobs = (jobsReq.result as GenerationJob[] | undefined) ?? [];
          proceed();
        };
      },
    );
  }

  async saveGenerationHistoryEntry(
    job: GenerationJob,
    variationPromptDocument?: PromptDocument,
  ): Promise<ServiceResult<PersistedGenerationState>> {
    if (variationPromptDocument) {
      if (
        variationPromptDocument.projectId !== job.projectId ||
        variationPromptDocument.promptKind !== 'variation' ||
        variationPromptDocument.approvalStatus !== 'approved' ||
        variationPromptDocument.id !== job.promptDocumentId
      ) {
        return errResult(
          'VALIDATION_ERROR',
          'Child variation prompt document must be approved and match the variation generation entry.',
        );
      }
      const varValidation = validateBasePersistedRecord(
        'promptDocuments',
        variationPromptDocument,
      );
      if (!varValidation.ok) {
        return varValidation;
      }
    }

    const normalizedJob: GenerationJob = {
      ...job,
      generationKind: resolveGenerationKind(job, variationPromptDocument ?? null),
      parentGenerationId: job.parentGenerationId ?? null,
      parentPromptId: job.parentPromptId ?? null,
      variationId: job.variationId ?? null,
      variationPromptId: job.variationPromptId ?? null,
      variationInstructions: job.variationInstructions ?? null,
      variationLabel: job.variationLabel ?? null,
    };

    const jobValidation = validateBasePersistedRecord(
      'generationHistory',
      normalizedJob,
    );
    if (!jobValidation.ok) {
      return jobValidation;
    }

    const now = nowIsoTimestamp();

    return this.gateway.executeTransaction(
      [
        'projects',
        'promptDocuments',
        'generationHistory',
        'generatedArtworks',
        'assetBlobs',
      ],
      'readwrite',
      (stores, { settle, abortWithError, abortWithMessage }) => {
        const projectReq = stores.projects.get(normalizedJob.projectId);
        const jobsReq = stores.generationHistory.getAll();
        const artworksReq = stores.generatedArtworks.getAll();

        let project: Project | undefined;
        let allJobs: GenerationJob[] | undefined;
        let allArtworks: GeneratedArtwork[] | undefined;
        let loaded = 0;

        const proceed = () => {
          loaded += 1;
          if (loaded < 3) {
            return;
          }

          if (!project) {
            abortWithMessage(
              'constraint_or_validation',
              'Active project could not be found while recording generation history.',
            );
            return;
          }

          if (variationPromptDocument) {
            const putVarPromptReq = stores.promptDocuments.put(variationPromptDocument);
            putVarPromptReq.onerror = () => abortWithError(putVarPromptReq.error);
          }

          const updatedProject: Project = {
            ...project,
            activeGenerationJobId: normalizedJob.id,
            updatedAt: now,
          };

          const putJobReq = stores.generationHistory.put(normalizedJob);
          putJobReq.onerror = () => abortWithError(putJobReq.error);

          const putProjReq = stores.projects.put(updatedProject);
          putProjReq.onerror = () => abortWithError(putProjReq.error);

          const jobMap = new Map<EntityId, GenerationJob>();
          for (const item of allJobs ?? []) {
            if (item.projectId === project.id) {
              jobMap.set(item.id, item);
            }
          }
          jobMap.set(normalizedJob.id, normalizedJob);

          const sortedHistory = Array.from(jobMap.values()).sort(
            (a, b) =>
              b.queuedAt.localeCompare(a.queuedAt) ||
              b.updatedAt.localeCompare(a.updatedAt),
          );

          const projectArtworks = (allArtworks ?? [])
            .filter((item) => item.projectId === project!.id)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

          const latestArtwork = projectArtworks[0] ?? null;
          if (!latestArtwork || !latestArtwork.localBlobKey) {
            settle(
              okResult({
                project: updatedProject,
                latestJob: normalizedJob,
                artwork: null,
                imageBlob: null,
                jobHistory: sortedHistory,
              }),
            );
            return;
          }

          const blobReq = stores.assetBlobs.get(latestArtwork.localBlobKey);
          blobReq.onerror = () => abortWithError(blobReq.error);
          blobReq.onsuccess = () => {
            const blobRecord = blobReq.result as PersistedAssetBlob | undefined;
            const validBlob =
              blobRecord &&
              blobRecord.ownerAssetId === latestArtwork.id &&
              blobRecord.projectId === project!.id &&
              isReadableBlob(blobRecord.blob)
                ? blobRecord.blob
                : null;
            settle(
              okResult({
                project: updatedProject,
                latestJob: normalizedJob,
                artwork: validBlob ? latestArtwork : null,
                imageBlob: validBlob,
                jobHistory: sortedHistory,
              }),
            );
          };
        };

        projectReq.onerror = () => abortWithError(projectReq.error);
        projectReq.onsuccess = () => {
          project = projectReq.result as Project | undefined;
          proceed();
        };

        jobsReq.onerror = () => abortWithError(jobsReq.error);
        jobsReq.onsuccess = () => {
          allJobs = (jobsReq.result as GenerationJob[] | undefined) ?? [];
          proceed();
        };

        artworksReq.onerror = () => abortWithError(artworksReq.error);
        artworksReq.onsuccess = () => {
          allArtworks = (artworksReq.result as GeneratedArtwork[] | undefined) ?? [];
          proceed();
        };
      },
    );
  }

  async getProjectGenerationState(
    projectId: EntityId,
  ): Promise<ServiceResult<PersistedGenerationState | null>> {
    if (!isValidEntityId(projectId)) {
      return okResult(null);
    }

    return this.gateway.executeTransaction(
      ['projects', 'generationHistory', 'generatedArtworks', 'assetBlobs'],
      'readonly',
      (stores, { settle, abortWithError, abortWithMessage }) => {
        const projectReq = stores.projects.get(projectId);
        const jobsReq = stores.generationHistory.getAll();
        const artworksReq = stores.generatedArtworks.getAll();

        let project: Project | undefined;
        let allJobs: GenerationJob[] | undefined;
        let allArtworks: GeneratedArtwork[] | undefined;
        let loaded = 0;

        const proceed = () => {
          loaded += 1;
          if (loaded < 3) {
            return;
          }

          if (!project) {
            settle(okResult(null));
            return;
          }

          const jobHistory = (allJobs ?? [])
            .filter((item) => item.projectId === project!.id)
            .sort(
              (a, b) =>
                b.queuedAt.localeCompare(a.queuedAt) ||
                b.updatedAt.localeCompare(a.updatedAt),
            );

          const latestJob = project.activeGenerationJobId
            ? jobHistory.find((j) => j.id === project!.activeGenerationJobId) ??
              jobHistory[0] ??
              null
            : jobHistory[0] ?? null;

          const projectArtworks = (allArtworks ?? [])
            .filter((item) => item.projectId === project!.id)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

          const targetArtwork =
            (latestJob?.status === 'completed' && latestJob.artworkIds[0]
              ? projectArtworks.find((a) => a.id === latestJob.artworkIds[0])
              : undefined) ??
            projectArtworks[0] ??
            null;

          if (!targetArtwork) {
            settle(
              okResult({
                project,
                latestJob,
                artwork: null,
                imageBlob: null,
                jobHistory,
              }),
            );
            return;
          }

          const blobReq = stores.assetBlobs.get(targetArtwork.localBlobKey);
          blobReq.onerror = () => abortWithError(blobReq.error);
          blobReq.onsuccess = () => {
            const blobRecord = blobReq.result as PersistedAssetBlob | undefined;
            if (
              !blobRecord ||
              blobRecord.ownerAssetId !== targetArtwork.id ||
              blobRecord.projectId !== project!.id ||
              !isReadableBlob(blobRecord.blob)
            ) {
              abortWithMessage(
                'missing_or_corrupted_asset',
                'Saved generated artwork binary data is missing or unreadable in local IndexedDB storage.',
              );
              return;
            }

            settle(
              okResult({
                project: project!,
                latestJob,
                artwork: targetArtwork,
                imageBlob: blobRecord.blob,
                jobHistory,
              }),
            );
          };
        };

        projectReq.onerror = () => abortWithError(projectReq.error);
        projectReq.onsuccess = () => {
          project = projectReq.result as Project | undefined;
          proceed();
        };

        jobsReq.onerror = () => abortWithError(jobsReq.error);
        jobsReq.onsuccess = () => {
          allJobs = (jobsReq.result as GenerationJob[] | undefined) ?? [];
          proceed();
        };

        artworksReq.onerror = () => abortWithError(artworksReq.error);
        artworksReq.onsuccess = () => {
          allArtworks = (artworksReq.result as GeneratedArtwork[] | undefined) ?? [];
          proceed();
        };
      },
    );
  }

  async getProjectGenerationHistory(
    projectId: EntityId,
  ): Promise<ServiceResult<ProjectGenerationHistorySnapshot | null>> {
    if (!isValidEntityId(projectId)) {
      return okResult(null);
    }

    return this.gateway.executeTransaction(
      [
        'projects',
        'generationHistory',
        'generatedArtworks',
        'assetBlobs',
        'promptDocuments',
      ],
      'readonly',
      (stores, { settle, abortWithError }) => {
        const projectReq = stores.projects.get(projectId);
        const jobsReq = stores.generationHistory.getAll();
        const artworksReq = stores.generatedArtworks.getAll();
        const promptsReq = stores.promptDocuments.getAll();

        let project: Project | undefined;
        let allJobs: GenerationJob[] | undefined;
        let allArtworks: GeneratedArtwork[] | undefined;
        let allPrompts: PromptDocument[] | undefined;
        let loaded = 0;

        const proceed = () => {
          loaded += 1;
          if (loaded < 4) {
            return;
          }

          if (!project) {
            settle(okResult(null));
            return;
          }

          const promptMap = new Map<EntityId, PromptDocument>();
          for (const promptDoc of allPrompts ?? []) {
            if (promptDoc.projectId === project!.id) {
              promptMap.set(promptDoc.id, promptDoc);
            }
          }

          const projectJobs = (allJobs ?? [])
            .filter((item) => item.projectId === project!.id)
            .sort(
              (a, b) =>
                b.queuedAt.localeCompare(a.queuedAt) ||
                b.updatedAt.localeCompare(a.updatedAt),
            );

          const projectArtworks = (allArtworks ?? []).filter(
            (item) => item.projectId === project!.id,
          );
          const artworkByJobId = new Map<EntityId, GeneratedArtwork>();
          const artworkById = new Map<EntityId, GeneratedArtwork>();
          for (const art of projectArtworks) {
            artworkById.set(art.id, art);
            artworkByJobId.set(art.generationJobId, art);
          }

          const buildEntriesFromBlobMap = (
            blobByArtworkId: Map<EntityId, PersistedAssetBlob | null>,
          ) => {
            const entries: PersistedGenerationRecordBundle[] = projectJobs.map(
              (rawJob) => {
                const rawArtwork =
                  (rawJob.artworkIds[0]
                    ? artworkById.get(rawJob.artworkIds[0])
                    : undefined) ??
                  artworkByJobId.get(rawJob.id) ??
                  null;

                const promptDoc =
                  promptMap.get(rawJob.promptDocumentId) ??
                  (rawArtwork
                    ? promptMap.get(rawArtwork.promptDocumentId)
                    : undefined) ??
                  null;

                const parentPromptDoc = promptDoc?.parentPromptId
                  ? (promptMap.get(promptDoc.parentPromptId) ?? null)
                  : rawJob.parentPromptId
                    ? (promptMap.get(rawJob.parentPromptId) ?? null)
                    : null;

                const resolvedKind = resolveGenerationKind(rawJob, promptDoc);
                const normalizedJob: GenerationJob = {
                  ...rawJob,
                  generationKind: resolvedKind,
                  parentGenerationId: rawJob.parentGenerationId ?? null,
                  parentPromptId: rawJob.parentPromptId ?? null,
                  variationId: rawJob.variationId ?? null,
                  variationPromptId: rawJob.variationPromptId ?? null,
                  variationInstructions: rawJob.variationInstructions ?? null,
                  variationLabel: rawJob.variationLabel ?? null,
                };

                if (!rawArtwork) {
                  return {
                    job: normalizedJob,
                    artwork: null,
                    imageBlob: null,
                    blobMissingOrCorrupted: false,
                    blobErrorMessage: null,
                    fileSizeBytes: null,
                    promptDocument: promptDoc,
                    parentPromptDocument: parentPromptDoc,
                  };
                }

                const blobRecord = blobByArtworkId.get(rawArtwork.id) ?? null;
                const validBlob =
                  blobRecord &&
                  blobRecord.ownerAssetId === rawArtwork.id &&
                  blobRecord.projectId === project!.id &&
                  isReadableBlob(blobRecord.blob)
                    ? blobRecord.blob
                    : null;

                const resolvedSize =
                  rawArtwork.fileSizeBytes ??
                  validBlob?.size ??
                  blobRecord?.fileSizeBytes ??
                  null;

                const normalizedArtwork: GeneratedArtwork = {
                  ...rawArtwork,
                  fileSizeBytes: resolvedSize ?? undefined,
                  generationKind: resolvedKind,
                  parentGenerationId:
                    rawArtwork.parentGenerationId ?? normalizedJob.parentGenerationId ?? null,
                  variationId: rawArtwork.variationId ?? normalizedJob.variationId ?? null,
                  variationLabel:
                    rawArtwork.variationLabel ?? normalizedJob.variationLabel ?? null,
                };

                return {
                  job: normalizedJob,
                  artwork: normalizedArtwork,
                  imageBlob: validBlob,
                  blobMissingOrCorrupted: validBlob === null,
                  blobErrorMessage:
                    validBlob === null
                      ? 'Artwork image binary data is missing or unreadable in local IndexedDB storage.'
                      : null,
                  fileSizeBytes: resolvedSize,
                  promptDocument: promptDoc,
                  parentPromptDocument: parentPromptDoc,
                };
              },
            );

            const activeEntry =
              (project!.activeGenerationJobId
                ? entries.find(
                    (e) =>
                      e.job.id === project!.activeGenerationJobId &&
                      e.artwork !== null &&
                      e.imageBlob !== null,
                  )
                : undefined) ??
              entries.find((e) => e.artwork !== null && e.imageBlob !== null) ??
              null;

            const activeJob =
              (project!.activeGenerationJobId
                ? entries.find((e) => e.job.id === project!.activeGenerationJobId)?.job
                : undefined) ??
              activeEntry?.job ??
              entries[0]?.job ??
              null;

            settle(
              okResult({
                project: project!,
                entries,
                activeJob,
                activeArtwork: activeEntry?.artwork ?? null,
                activeImageBlob: activeEntry?.imageBlob ?? null,
              }),
            );
          };

          const artworksToLoad = projectJobs
            .map((job) =>
              (job.artworkIds[0] ? artworkById.get(job.artworkIds[0]) : undefined) ??
              artworkByJobId.get(job.id) ??
              null,
            )
            .filter((item): item is GeneratedArtwork => item !== null);

          if (artworksToLoad.length === 0) {
            buildEntriesFromBlobMap(new Map());
            return;
          }

          const blobByArtworkId = new Map<EntityId, PersistedAssetBlob | null>();
          let blobsLoaded = 0;

          for (const artwork of artworksToLoad) {
            if (!artwork.localBlobKey) {
              blobByArtworkId.set(artwork.id, null);
              blobsLoaded += 1;
              if (blobsLoaded === artworksToLoad.length) {
                buildEntriesFromBlobMap(blobByArtworkId);
              }
              continue;
            }

            const blobReq = stores.assetBlobs.get(artwork.localBlobKey);
            blobReq.onerror = () => {
              blobByArtworkId.set(artwork.id, null);
              blobsLoaded += 1;
              if (blobsLoaded === artworksToLoad.length) {
                buildEntriesFromBlobMap(blobByArtworkId);
              }
            };
            blobReq.onsuccess = () => {
              blobByArtworkId.set(
                artwork.id,
                (blobReq.result as PersistedAssetBlob | undefined) ?? null,
              );
              blobsLoaded += 1;
              if (blobsLoaded === artworksToLoad.length) {
                buildEntriesFromBlobMap(blobByArtworkId);
              }
            };
          }
        };

        projectReq.onerror = () => abortWithError(projectReq.error);
        projectReq.onsuccess = () => {
          project = projectReq.result as Project | undefined;
          proceed();
        };

        jobsReq.onerror = () => abortWithError(jobsReq.error);
        jobsReq.onsuccess = () => {
          allJobs = (jobsReq.result as GenerationJob[] | undefined) ?? [];
          proceed();
        };

        artworksReq.onerror = () => abortWithError(artworksReq.error);
        artworksReq.onsuccess = () => {
          allArtworks = (artworksReq.result as GeneratedArtwork[] | undefined) ?? [];
          proceed();
        };

        promptsReq.onerror = () => abortWithError(promptsReq.error);
        promptsReq.onsuccess = () => {
          allPrompts = (promptsReq.result as PromptDocument[] | undefined) ?? [];
          proceed();
        };
      },
    );
  }

  async listProjectSummaries(
    activeProjectId?: EntityId | null,
  ): Promise<ServiceResult<readonly ProjectSummary[]>> {
    const resolvedActiveId =
      activeProjectId && isValidEntityId(activeProjectId)
        ? activeProjectId
        : readStoredActiveProjectId();

    return this.gateway.executeTransaction(
      [
        'projects',
        'sourceAssets',
        'assetBlobs',
        'objectAnalyses',
        'objectDescriptions',
        'promptDocuments',
        'generationHistory',
        'generatedArtworks',
      ],
      'readonly',
      (stores, { settle, abortWithError }) => {
        const projectsReq = stores.projects.getAll();
        const assetsReq = stores.sourceAssets.getAll();
        const blobsReq = stores.assetBlobs.getAll();
        const analysesReq = stores.objectAnalyses.getAll();
        const descriptionsReq = stores.objectDescriptions.getAll();
        const promptsReq = stores.promptDocuments.getAll();
        const jobsReq = stores.generationHistory.getAll();
        const artworksReq = stores.generatedArtworks.getAll();

        let allProjects: Project[] | null = null;
        let allAssets: SourceAsset[] | null = null;
        let allBlobs: PersistedAssetBlob[] | null = null;
        let allAnalyses: ObjectAnalysis[] | null = null;
        let allDescriptions: ObjectDescription[] | null = null;
        let allPrompts: PromptDocument[] | null = null;
        let allJobs: GenerationJob[] | null = null;
        let allArtworks: GeneratedArtwork[] | null = null;

        const proceed = () => {
          if (
            !allProjects ||
            !allAssets ||
            !allBlobs ||
            !allAnalyses ||
            !allDescriptions ||
            !allPrompts ||
            !allJobs ||
            !allArtworks
          ) {
            return;
          }

          const assetById = new Map<EntityId, SourceAsset>(
            allAssets.map((asset) => [asset.id, asset]),
          );
          const blobById = new Map<string, PersistedAssetBlob>(
            allBlobs.map((blob) => [blob.id, blob]),
          );

          const sortedProjects = [...allProjects].sort((a, b) =>
            b.updatedAt.localeCompare(a.updatedAt),
          );

          const summaries: ProjectSummary[] = sortedProjects.map((project) => {
            const projectAnalyses = allAnalyses!.filter(
              (a) => a.projectId === project.id,
            );
            const projectDescriptions = allDescriptions!.filter(
              (d) => d.projectId === project.id,
            );
            const projectPrompts = allPrompts!
              .filter((p) => p.projectId === project.id)
              .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
            const projectJobs = allJobs!.filter(
              (j) => j.projectId === project.id,
            );
            const projectArtworks = allArtworks!
              .filter((art) => art.projectId === project.id)
              .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

            const sourceAsset =
              (project.sourceAssetId
                ? assetById.get(project.sourceAssetId)
                : undefined) ??
              allAssets!.find((a) => a.projectId === project.id) ??
              null;

            const sourceBlobRecord = sourceAsset?.localBlobKey
              ? blobById.get(sourceAsset.localBlobKey)
              : undefined;
            const hasReadableSourceBlob = Boolean(
              sourceBlobRecord && isReadableBlob(sourceBlobRecord.blob),
            );

            const sourceAvailability = !sourceAsset
              ? 'none'
              : hasReadableSourceBlob
                ? 'available'
                : 'missing_blob';

            const latestArtwork = projectArtworks[0] ?? null;
            const latestArtworkBlobRecord = latestArtwork?.localBlobKey
              ? blobById.get(latestArtwork.localBlobKey)
              : undefined;
            const latestArtworkBlob =
              latestArtworkBlobRecord &&
              isReadableBlob(latestArtworkBlobRecord.blob)
                ? latestArtworkBlobRecord.blob
                : null;

            const sourcePreviewBlob =
              !latestArtworkBlob &&
              hasReadableSourceBlob &&
              sourceBlobRecord
                ? sourceBlobRecord.blob
                : null;

            const latestPrompt =
              (project.activePromptId
                ? projectPrompts.find((p) => p.id === project.activePromptId)
                : undefined) ??
              projectPrompts[0] ??
              null;

            const { workflowStage, workflowStageLabel } =
              computeProjectWorkflowStage({
                project,
                sourceAsset,
                analysisCount: projectAnalyses.length,
                descriptionCount: projectDescriptions.length,
                latestPrompt,
                promptCount: projectPrompts.length,
                artworkCount: projectArtworks.length,
              });

            return {
              project,
              sourceAsset,
              sourceAvailability,
              artworkCount: projectArtworks.length,
              generationJobCount: projectJobs.length,
              analysisCount: projectAnalyses.length,
              descriptionCount: projectDescriptions.length,
              promptCount: projectPrompts.length,
              latestArtwork,
              latestArtworkBlob,
              sourcePreviewBlob,
              workflowStage,
              workflowStageLabel,
              isActiveProject: resolvedActiveId === project.id,
            };
          });

          settle(okResult(summaries));
        };

        projectsReq.onerror = () => abortWithError(projectsReq.error);
        projectsReq.onsuccess = () => {
          allProjects = (projectsReq.result as Project[] | undefined) ?? [];
          proceed();
        };

        assetsReq.onerror = () => abortWithError(assetsReq.error);
        assetsReq.onsuccess = () => {
          allAssets = (assetsReq.result as SourceAsset[] | undefined) ?? [];
          proceed();
        };

        blobsReq.onerror = () => abortWithError(blobsReq.error);
        blobsReq.onsuccess = () => {
          allBlobs = (blobsReq.result as PersistedAssetBlob[] | undefined) ?? [];
          proceed();
        };

        analysesReq.onerror = () => abortWithError(analysesReq.error);
        analysesReq.onsuccess = () => {
          allAnalyses = (analysesReq.result as ObjectAnalysis[] | undefined) ?? [];
          proceed();
        };

        descriptionsReq.onerror = () => abortWithError(descriptionsReq.error);
        descriptionsReq.onsuccess = () => {
          allDescriptions =
            (descriptionsReq.result as ObjectDescription[] | undefined) ?? [];
          proceed();
        };

        promptsReq.onerror = () => abortWithError(promptsReq.error);
        promptsReq.onsuccess = () => {
          allPrompts = (promptsReq.result as PromptDocument[] | undefined) ?? [];
          proceed();
        };

        jobsReq.onerror = () => abortWithError(jobsReq.error);
        jobsReq.onsuccess = () => {
          allJobs = (jobsReq.result as GenerationJob[] | undefined) ?? [];
          proceed();
        };

        artworksReq.onerror = () => abortWithError(artworksReq.error);
        artworksReq.onsuccess = () => {
          allArtworks = (artworksReq.result as GeneratedArtwork[] | undefined) ?? [];
          proceed();
        };
      },
    );
  }

  async createProject(input: CreateProjectInput): Promise<ServiceResult<Project>> {
    const titleValidation = validateProjectTitle(input.title);
    if (!titleValidation.ok) {
      return titleValidation;
    }

    const now = nowIsoTimestamp();
    const projectId = createEntityId('prj');
    const description = normalizeProjectDescription(input.description);
    const project = createDraftProject(
      projectId,
      null,
      titleValidation.data,
      now,
      description,
    );

    const saved = await this.saveProject(project);
    if (!saved.ok) {
      return saved;
    }

    if (input.setAsActive !== false) {
      writeStoredActiveProjectId(saved.data.id);
    }

    return saved;
  }

  async openProject(projectId: EntityId): Promise<ServiceResult<Project>> {
    if (!isValidEntityId(projectId)) {
      return errResult(
        'VALIDATION_ERROR',
        'A valid project ID is required to open a study.',
      );
    }

    const res = await this.getProjectById(projectId);
    if (!res.ok) {
      return res;
    }
    if (!res.data) {
      return errResult(
        'NOT_FOUND',
        'The selected project could not be found in local storage.',
      );
    }

    writeStoredActiveProjectId(res.data.id);
    return okResult(res.data);
  }

  async renameProject(
    projectId: EntityId,
    newTitle: string,
  ): Promise<ServiceResult<Project>> {
    if (!isValidEntityId(projectId)) {
      return errResult(
        'VALIDATION_ERROR',
        'A valid project ID is required to rename a project.',
      );
    }

    const titleValidation = validateProjectTitle(newTitle);
    if (!titleValidation.ok) {
      return titleValidation;
    }

    const existingRes = await this.getProjectById(projectId);
    if (!existingRes.ok) {
      return existingRes;
    }
    if (!existingRes.data) {
      return errResult(
        'NOT_FOUND',
        'The project to rename could not be found in local storage.',
      );
    }

    const updated: Project = {
      ...existingRes.data,
      title: titleValidation.data,
      updatedAt: nowIsoTimestamp(),
    };

    return this.saveProject(updated);
  }

  async archiveProject(projectId: EntityId): Promise<ServiceResult<Project>> {
    if (!isValidEntityId(projectId)) {
      return errResult(
        'VALIDATION_ERROR',
        'A valid project ID is required to archive a project.',
      );
    }

    const existingRes = await this.getProjectById(projectId);
    if (!existingRes.ok) {
      return existingRes;
    }
    if (!existingRes.data) {
      return errResult(
        'NOT_FOUND',
        'The project to archive could not be found in local storage.',
      );
    }

    const existing = existingRes.data;
    if (existing.status === 'archived') {
      return okResult(existing);
    }

    const archived: Project = {
      ...existing,
      previousStatus: existing.status,
      status: 'archived',
      updatedAt: nowIsoTimestamp(),
    };

    const saved = await this.saveProject(archived);
    if (saved.ok && readStoredActiveProjectId() === projectId) {
      writeStoredActiveProjectId(null);
    }
    return saved;
  }

  async restoreProject(projectId: EntityId): Promise<ServiceResult<Project>> {
    if (!isValidEntityId(projectId)) {
      return errResult(
        'VALIDATION_ERROR',
        'A valid project ID is required to restore a project.',
      );
    }

    return this.gateway.executeTransaction(
      [
        'projects',
        'objectAnalyses',
        'objectDescriptions',
        'promptDocuments',
        'generatedArtworks',
      ],
      'readwrite',
      (stores, { settle, abortWithError }) => {
        const projectReq = stores.projects.get(projectId);
        const analysesReq = stores.objectAnalyses.getAll();
        const descriptionsReq = stores.objectDescriptions.getAll();
        const promptsReq = stores.promptDocuments.getAll();
        const artworksReq = stores.generatedArtworks.getAll();

        let existingProject: Project | null | undefined;
        let allAnalyses: ObjectAnalysis[] | null = null;
        let allDescriptions: ObjectDescription[] | null = null;
        let allPrompts: PromptDocument[] | null = null;
        let allArtworks: GeneratedArtwork[] | null = null;

        const proceed = () => {
          if (
            existingProject === undefined ||
            !allAnalyses ||
            !allDescriptions ||
            !allPrompts ||
            !allArtworks
          ) {
            return;
          }

          if (!existingProject) {
            settle(
              errResult(
                'NOT_FOUND',
                'The archived project could not be found in local storage.',
              ),
            );
            return;
          }

          if (existingProject.status !== 'archived') {
            settle(okResult(existingProject));
            return;
          }

          const projectPrompts = allPrompts.filter(
            (p) => p.projectId === projectId,
          );
          const nextStatus = inferRestorableProjectStatus({
            project: existingProject,
            artworkCount: allArtworks.filter((a) => a.projectId === projectId)
              .length,
            hasApprovedPrompt: projectPrompts.some(
              (p) => p.approvalStatus === 'approved',
            ),
            hasPrompt: projectPrompts.length > 0,
            hasAnalysisOrDescription:
              allAnalyses.some((a) => a.projectId === projectId) ||
              allDescriptions.some((d) => d.projectId === projectId),
          });

          const restored: Project = {
            ...existingProject,
            status: nextStatus,
            previousStatus: null,
            updatedAt: nowIsoTimestamp(),
          };

          const validation = validateBasePersistedRecord('projects', restored);
          if (!validation.ok) {
            settle(validation);
            return;
          }

          const putReq = stores.projects.put(restored);
          putReq.onerror = () => abortWithError(putReq.error);
          putReq.onsuccess = () => settle(okResult(restored));
        };

        projectReq.onerror = () => abortWithError(projectReq.error);
        projectReq.onsuccess = () => {
          existingProject = (projectReq.result as Project | undefined) ?? null;
          proceed();
        };

        analysesReq.onerror = () => abortWithError(analysesReq.error);
        analysesReq.onsuccess = () => {
          allAnalyses = (analysesReq.result as ObjectAnalysis[] | undefined) ?? [];
          proceed();
        };

        descriptionsReq.onerror = () => abortWithError(descriptionsReq.error);
        descriptionsReq.onsuccess = () => {
          allDescriptions =
            (descriptionsReq.result as ObjectDescription[] | undefined) ?? [];
          proceed();
        };

        promptsReq.onerror = () => abortWithError(promptsReq.error);
        promptsReq.onsuccess = () => {
          allPrompts = (promptsReq.result as PromptDocument[] | undefined) ?? [];
          proceed();
        };

        artworksReq.onerror = () => abortWithError(artworksReq.error);
        artworksReq.onsuccess = () => {
          allArtworks = (artworksReq.result as GeneratedArtwork[] | undefined) ?? [];
          proceed();
        };
      },
    );
  }
}

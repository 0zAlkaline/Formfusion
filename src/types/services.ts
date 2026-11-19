import type { EntityId, ServiceResult } from './common.ts';
import type {
  ArtStyle,
  ArtStyleCategory,
  AspectRatio,
  CreativeDirectionMode,
  GeneratedArtwork,
  GenerationJob,
  GenerationModelParameters,
  ImageResolution,
  ObjectAnalysis,
  ObjectDescription,
  PersonalPreset,
  PersonalPresetSnapshot,
  Preset,
  Project,
  PromptBackgroundTreatment,
  PromptCompositionPreferences,
  PromptDetailLevel,
  PromptDocument,
  PromptOutputOrientation,
  SourceAsset,
  StructuredArtStyleConfig,
  StyleCatalogItem,
} from './domain.ts';
import type {
  PromptSynthesisProviderOutput,
  PromptSynthesisSubjectInput,
  ProviderConfigRef,
  RawVisionAnalysisResult,
} from './providers.ts';

export interface IdentifyObjectsRequest {
  readonly projectId: EntityId;
  readonly sourceAsset: SourceAsset;
  readonly imageBytes: Uint8Array;
  readonly providerConfigRef: ProviderConfigRef;
  readonly analysisHints?: string;
}

export interface AnalyzeRawSourceImageRequest {
  readonly projectId: EntityId;
  readonly sourceAsset: SourceAsset;
  readonly binaryBlob: Blob;
  readonly abortSignal?: AbortSignal;
}

export interface ObjectIdentificationService {
  analyzeRawSourceImage(
    request: AnalyzeRawSourceImageRequest,
  ): Promise<ServiceResult<RawVisionAnalysisResult>>;
  analyzeSourceAsset(
    request: IdentifyObjectsRequest,
  ): Promise<ServiceResult<ObjectAnalysis>>;
}

export type ObjectDescriptionEditableFields = Pick<
  ObjectDescription,
  | 'objectName'
  | 'objectCategory'
  | 'primaryDescription'
  | 'shapeAndSilhouette'
  | 'materials'
  | 'dominantColors'
  | 'surfaceDetails'
  | 'distinctiveFeatures'
  | 'composition'
  | 'viewingAngle'
  | 'preservationPriorities'
  | 'uncertainAttributes'
  | 'userNotes'
>;

export interface ObjectDescriptionFieldErrors {
  readonly objectName?: string;
  readonly objectCategory?: string;
  readonly primaryDescription?: string;
}

export interface NormalizeObjectDescriptionRequest {
  readonly projectId: EntityId;
  readonly analysis: ObjectAnalysis;
  readonly existingDescription?: ObjectDescription | null;
  readonly draft?: Partial<
    ObjectDescriptionEditableFields &
      Pick<
        ObjectDescription,
        'primarySubject' | 'environmentContext' | 'objects' | 'moodAndAtmosphere'
      >
  >;
}

export interface ObjectDescriptionService {
  createFromAnalysis(
    analysis: ObjectAnalysis,
  ): ServiceResult<ObjectDescription>;
  normalizeAndValidate(
    request: NormalizeObjectDescriptionRequest,
  ): ServiceResult<ObjectDescription>;
  resetFromAnalysis(
    analysis: ObjectAnalysis,
    existingDescription?: ObjectDescription | null,
  ): ServiceResult<ObjectDescription>;
}

export type StyleSortOption = 'curated_order' | 'name_asc' | 'name_desc' | 'favorites_first';

export interface StyleQueryOptions {
  readonly search?: string;
  readonly category?: ArtStyleCategory | 'all';
  readonly favoritesOnly?: boolean;
  readonly sortBy?: StyleSortOption;
}

export interface ArtStyleService {
  ensureCatalogSeeded(): Promise<ServiceResult<readonly ArtStyle[]>>;
  listStyles(options?: StyleQueryOptions): Promise<ServiceResult<readonly ArtStyle[]>>;
  listCatalogWithFavorites(
    options?: StyleQueryOptions,
  ): Promise<ServiceResult<readonly StyleCatalogItem[]>>;
  getStyleById(styleId: EntityId): Promise<ServiceResult<ArtStyle | null>>;
  listFavoriteStyleIds(): Promise<ServiceResult<readonly EntityId[]>>;
  toggleFavoriteStyle(styleId: EntityId): Promise<ServiceResult<boolean>>;
  validateStyle(style: unknown): ServiceResult<ArtStyle>;
}

export interface SavePersonalPresetInput {
  readonly id?: EntityId;
  readonly name: string;
  readonly description: string;
  readonly creativeDirectionMode: CreativeDirectionMode;
  readonly selectedStyleId?: EntityId | null;
  readonly creativeDirectionSnapshot: PersonalPresetSnapshot;
  readonly aspectRatio: AspectRatio;
  readonly outputOrientation: PromptOutputOrientation;
  readonly backgroundTreatment: PromptBackgroundTreatment;
  readonly detailLevel: PromptDetailLevel;
  readonly compositionDirection: string;
  readonly userCreativeInstructions: string;
  readonly negativePrompt: string;
  readonly tags?: readonly string[];
}

export interface PresetEngineService {
  listPresets(): Promise<ServiceResult<readonly PersonalPreset[]>>;
  getPresetById(presetId: EntityId): Promise<ServiceResult<PersonalPreset | null>>;
  createPreset(input: SavePersonalPresetInput): Promise<ServiceResult<PersonalPreset>>;
  updatePreset(
    presetId: EntityId,
    input: SavePersonalPresetInput,
  ): Promise<ServiceResult<PersonalPreset>>;
  duplicatePreset(presetId: EntityId): Promise<ServiceResult<PersonalPreset>>;
  deletePreset(presetId: EntityId): Promise<ServiceResult<void>>;
  applyPresetToProject(
    projectId: EntityId,
    presetId: EntityId,
  ): Promise<ServiceResult<{ readonly project: Project; readonly preset: PersonalPreset }>>;
  validatePreset(preset: unknown): ServiceResult<PersonalPreset>;
}

export interface ManualCreativeDirectionInput {
  readonly styleName: string;
  readonly styleCategory?: string;
  readonly styleDescription: string;
  readonly visualCharacteristics?: string;
  readonly renderingRules?: string;
  readonly lineworkRules?: string;
  readonly colorRules?: string;
  readonly textureRules?: string;
  readonly shadingRules?: string;
  readonly compositionRules?: string;
  readonly detailLevel?: PromptDetailLevel;
  readonly promptTemplate?: string;
  readonly negativePromptTemplate?: string;
}

export interface ComposePromptRequest {
  readonly projectId: EntityId;
  readonly description: ObjectDescription | null;
  readonly artStyle?: ArtStyle | null;
  readonly manualCreativeDirection?: ManualCreativeDirectionInput | null;
  readonly userInstructions: string;
  readonly compositionPreferences?: Partial<PromptCompositionPreferences>;
  readonly previousRevision?: number;
  readonly abortSignal?: AbortSignal;
}

export interface PromptInputFieldErrors {
  readonly description?: string;
  readonly creativeDirection?: string;
  readonly styleName?: string;
  readonly styleDescription?: string;
  readonly compositionPreferences?: string;
}

export interface PromptInputValidationReport {
  readonly valid: boolean;
  readonly fieldErrors: PromptInputFieldErrors;
  readonly missingRequirements: readonly string[];
  readonly potentialConflicts: readonly string[];
}

export interface NormalizedPromptInputs {
  readonly projectId: EntityId;
  readonly descriptionId: EntityId;
  readonly sourceDescriptionRevision: number;
  readonly subject: PromptSynthesisSubjectInput;
  readonly creativeDirection: StructuredArtStyleConfig;
  readonly creativeInstructions: string;
  readonly compositionPreferences: PromptCompositionPreferences;
  readonly negativeDirectivesFromInputs: readonly string[];
  readonly potentialConflicts: readonly string[];
  readonly previousRevision: number;
}

export interface ApprovePromptRequest {
  readonly promptDocument: PromptDocument;
  readonly finalPrompt: string;
  readonly negativePrompt: string;
}

export interface PromptComposerService {
  validatePromptInputs(
    request: ComposePromptRequest,
  ): ServiceResult<PromptInputValidationReport>;
  normalizePromptInputs(
    request: ComposePromptRequest,
  ): ServiceResult<NormalizedPromptInputs>;
  synthesizeMasterPrompt(
    request: ComposePromptRequest,
  ): Promise<ServiceResult<PromptDocument>>;
  validateGeneratedPrompt(
    synthesis: PromptSynthesisProviderOutput,
    normalized: NormalizedPromptInputs,
  ): ServiceResult<PromptSynthesisProviderOutput>;
  savePromptDocument(
    document: PromptDocument,
    previousDocument?: PromptDocument | null,
  ): ServiceResult<PromptDocument>;
  approveFinalPrompt(
    request: ApprovePromptRequest,
  ): ServiceResult<PromptDocument>;
  regeneratePrompt(
    request: ComposePromptRequest,
  ): Promise<ServiceResult<PromptDocument>>;
  composePrompt(
    request: ComposePromptRequest,
  ): Promise<ServiceResult<PromptDocument>>;
  approvePrompt(
    request: ApprovePromptRequest,
  ): ServiceResult<PromptDocument>;
}

/**
 * Keys explicitly prohibited on Text-to-Image generation requests.
 * Source images are strictly reserved for Gemini Vision object identification.
 */
export type ForbiddenImageInputKey =
  | 'sourceImage'
  | 'source_image'
  | 'imageFile'
  | 'image_file'
  | 'base64Image'
  | 'base64_image'
  | 'sourceImageUrl'
  | 'source_image_url'
  | 'imageAttachment'
  | 'image_attachment'
  | 'uploadedImageReference'
  | 'uploaded_image_reference'
  | 'sourceAsset'
  | 'sourceAssetId'
  | 'source_asset_id'
  | 'referenceImage'
  | 'reference_image'
  | 'initImage'
  | 'init_image'
  | 'maskImage'
  | 'mask_image'
  | 'imageData'
  | 'imageUrl'
  | 'imageBase64'
  | 'image'
  | 'file'
  | 'files'
  | 'attachment'
  | 'attachments';

export interface TextToImageGenerationRequest {
  readonly finalApprovedPrompt: string;
  readonly negativePrompt?: string;
  readonly aspectRatio: AspectRatio;
  readonly resolution: ImageResolution;
  readonly modelParameters: GenerationModelParameters;
  readonly providerConfigRef: ProviderConfigRef;
}

export type StrictTextToImageRequest<T extends TextToImageGenerationRequest> = T & {
  [K in ForbiddenImageInputKey]?: never;
} & {
  [K in Exclude<keyof T, keyof TextToImageGenerationRequest>]: never;
};

export interface ImageGenerationResult {
  readonly job: GenerationJob;
  readonly artworks: readonly GeneratedArtwork[];
}

export interface ImageGenerationService {
  generateArtwork<TRequest extends TextToImageGenerationRequest>(
    request: StrictTextToImageRequest<TRequest>,
  ): Promise<ServiceResult<ImageGenerationResult>>;
}

export interface ProjectBundle {
  readonly project: Project;
  readonly sourceAsset: SourceAsset | null;
  readonly analyses: readonly ObjectAnalysis[];
  readonly descriptions: readonly ObjectDescription[];
  readonly prompts: readonly PromptDocument[];
  readonly generationJobs: readonly GenerationJob[];
  readonly artworks: readonly GeneratedArtwork[];
}

export interface ProjectStorageService {
  listProjects(): Promise<ServiceResult<readonly Project[]>>;
  getProjectById(projectId: EntityId): Promise<ServiceResult<Project | null>>;
  getProjectBundle(projectId: EntityId): Promise<ServiceResult<ProjectBundle | null>>;
  saveProject(project: Project): Promise<ServiceResult<Project>>;
  deleteProject(projectId: EntityId): Promise<ServiceResult<void>>;
  listPresets(): Promise<ServiceResult<readonly Preset[]>>;
  savePreset(preset: Preset): Promise<ServiceResult<Preset>>;
  deletePreset(presetId: EntityId): Promise<ServiceResult<void>>;
}

export type ExportImageFormat = 'png' | 'jpeg' | 'webp';

export interface ExportArtworkRequest {
  readonly artwork: GeneratedArtwork;
  readonly format: ExportImageFormat;
  readonly fileNameBase: string;
  readonly includeMetadataSidecar: boolean;
  readonly generationKind?: 'original' | 'regeneration' | 'variation';
  readonly targetWidth?: number;
  readonly targetHeight?: number;
  readonly lockAspectRatio?: boolean;
  readonly jpegQualityPercent?: number;
  readonly jpegBackgroundColor?: string;
  readonly triggerDownload?: boolean;
}

export interface ExportArtifact {
  readonly fileName: string;
  readonly mimeType: string;
  readonly byteSize: number;
  readonly width: number;
  readonly height: number;
  readonly hasSourceTransparency: boolean;
  readonly blob?: Blob;
  readonly warnings: readonly string[];
}

export interface ArtworkSourceExportInspection {
  readonly artwork: GeneratedArtwork;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly originalByteSize: number;
  readonly hasAlphaTransparency: boolean;
  readonly blob: Blob;
}

export interface ExportService {
  exportArtwork(
    request: ExportArtworkRequest,
  ): Promise<ServiceResult<ExportArtifact>>;
  inspectArtworkSource(
    artwork: GeneratedArtwork,
  ): Promise<ServiceResult<ArtworkSourceExportInspection>>;
  estimateExportArtifact(
    request: Omit<ExportArtworkRequest, 'triggerDownload'>,
  ): Promise<ServiceResult<ExportArtifact>>;
}


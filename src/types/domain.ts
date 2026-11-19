import type { EntityId, EntityTimestamps, IsoTimestamp } from './common.ts';
import type { ProviderConfigRef } from './providers.ts';

export type ProjectStatus =
  | 'draft'
  | 'analyzed'
  | 'prompt_ready'
  | 'generated'
  | 'archived';

export type CreativeDirectionMode = 'curated' | 'manual';

export interface ProjectCreativeConfiguration {
  readonly mode: CreativeDirectionMode;
  readonly selectedStyleId: EntityId | null;
  readonly appliedPresetId: EntityId | null;
  readonly appliedPresetName: string | null;
  readonly creativeDirectionSnapshot?: PersonalPresetSnapshot | null;
  readonly compositionPreferences?: PromptCompositionPreferences | null;
  readonly userCreativeInstructions?: string;
  readonly negativePromptOverride?: string;
  readonly updatedAt: IsoTimestamp;
}

export interface Project extends EntityTimestamps {
  readonly id: EntityId;
  readonly title: string;
  readonly description: string;
  readonly status: ProjectStatus;
  readonly previousStatus?: Exclude<ProjectStatus, 'archived'> | null;
  readonly sourceAssetId: EntityId | null;
  readonly activeAnalysisId: EntityId | null;
  readonly activeDescriptionId: EntityId | null;
  readonly selectedStyleId: EntityId | null;
  readonly activeCreativeConfiguration?: ProjectCreativeConfiguration | null;
  readonly activePromptId: EntityId | null;
  readonly activeGenerationJobId: EntityId | null;
  readonly tags: readonly string[];
}

export type SupportedSourceMimeType = 'image/png' | 'image/jpeg' | 'image/webp';

export type SupportedSourceExtension = 'jpg' | 'jpeg' | 'png' | 'webp';

export type SourceAssetValidationStatus = 'validated' | 'rejected';

export type SourceAssetStorageStatus = 'in_memory' | 'persisted' | 'persist_failed';

export interface SourceAssetAspectRatio {
  readonly widthRatio: number;
  readonly heightRatio: number;
  readonly label: string;
  readonly numeric: number;
}

export interface SourceAsset extends EntityTimestamps {
  readonly id: EntityId;
  readonly projectId: EntityId;
  readonly originalFileName: string;
  readonly mimeType: SupportedSourceMimeType;
  readonly fileExtension: SupportedSourceExtension;
  readonly fileSizeBytes: number;
  readonly width: number;
  readonly height: number;
  readonly aspectRatio: SourceAssetAspectRatio;
  readonly checksumSha256?: string;
  readonly localBlobKey: string | null;
  readonly validationStatus: SourceAssetValidationStatus;
  readonly storageStatus: SourceAssetStorageStatus;
}

export interface DetectedObjectItem {
  readonly id: EntityId;
  readonly label: string;
  readonly category: string;
  readonly confidence: number;
  readonly spatialPosition: string;
  readonly dominantColors: readonly string[];
  readonly materials: readonly string[];
  readonly keyAttributes: readonly string[];
}

export interface ObjectAnalysis extends EntityTimestamps {
  readonly id: EntityId;
  readonly projectId: EntityId;
  readonly sourceAssetId: EntityId;
  readonly providerId: string;
  readonly modelId: string;
  readonly modelVersion?: string;
  readonly responseId?: string;
  readonly finishReason?: string;
  readonly rawText?: string;
  readonly sceneSummary: string;
  readonly detectedObjects: readonly DetectedObjectItem[];
  readonly lightingNotes: string;
  readonly compositionNotes: string;
  readonly objectName: string;
  readonly objectCategory: string;
  readonly primaryDescription: string;
  readonly shapeAndSilhouette: string;
  readonly materials: readonly string[];
  readonly dominantColors: readonly string[];
  readonly surfaceDetails: string;
  readonly distinctiveFeatures: readonly string[];
  readonly composition: string;
  readonly viewingAngle: string;
  readonly preservationPriorities: readonly string[];
  readonly uncertainAttributes: readonly string[];
  readonly analyzedAt: IsoTimestamp;
}

export interface EditableObjectEntry {
  readonly id: EntityId;
  readonly sourceDetectedObjectId: EntityId | null;
  readonly subjectName: string;
  readonly visualDetails: string;
  readonly materialAndTexture: string;
  readonly colorPalette: readonly string[];
  readonly poseOrArrangement: string;
  readonly includeInPrompt: boolean;
}

export interface ObjectDescription extends EntityTimestamps {
  readonly id: EntityId;
  readonly projectId: EntityId;
  readonly analysisId: EntityId;
  readonly sourceAssetId: EntityId;
  readonly version: number;
  readonly objectName: string;
  readonly objectCategory: string;
  readonly primaryDescription: string;
  readonly shapeAndSilhouette: string;
  readonly materials: readonly string[];
  readonly dominantColors: readonly string[];
  readonly surfaceDetails: string;
  readonly distinctiveFeatures: readonly string[];
  readonly composition: string;
  readonly viewingAngle: string;
  readonly preservationPriorities: readonly string[];
  readonly uncertainAttributes: readonly string[];
  readonly primarySubject: string;
  readonly environmentContext: string;
  readonly objects: readonly EditableObjectEntry[];
  readonly moodAndAtmosphere: string;
  readonly userNotes: string;
  readonly isNormalized: boolean;
}

export type AspectRatio = '1:1' | '4:3' | '3:4' | '16:9' | '9:16' | '3:2' | '2:3';

export type ResolutionTier = 'standard' | 'hd' | 'uhd';

export interface ImageResolution {
  readonly width: number;
  readonly height: number;
  readonly label: ResolutionTier;
}

export type PromptDetailLevel = 'minimal' | 'balanced' | 'high' | 'intricate';

export type PromptOutputOrientation = 'square' | 'portrait' | 'landscape';

export type PromptBackgroundTreatment =
  | 'preserve_clean'
  | 'neutral_studio'
  | 'editorial_backdrop'
  | 'minimal_gradient'
  | 'environmental_match';

export type CuratedArtStyleCategory =
  | 'illustration'
  | 'graphic_design'
  | 'line_art'
  | 'traditional_art'
  | 'digital_art'
  | '3d_art';

export type ArtStyleCategory =
  | CuratedArtStyleCategory
  | 'painterly'
  | 'photographic'
  | 'sculptural'
  | 'architectural'
  | 'digital'
  | 'printmaking'
  | 'mixed_media';

export type StylePreviewMotif =
  | 'editorial_arch'
  | 'anime_horizon'
  | 'geometric_study'
  | 'psychedelic_wave'
  | 'monoline_vessel'
  | 'matisse_foliage'
  | 'bauhaus_grid'
  | 'engraving_crosshatch'
  | 'watercolor_wash'
  | 'clay_sculpture'
  | 'chrome_prism'
  | 'gothic_rosette';

export interface ArtStylePreviewAsset {
  readonly kind: 'editorial_svg';
  readonly motif: StylePreviewMotif;
  readonly palette: readonly [string, string, string, string];
  readonly accentNote: string;
}

export interface ArtStyle extends EntityTimestamps {
  readonly id: EntityId;
  readonly slug: string;
  readonly name: string;
  readonly category: ArtStyleCategory;
  readonly summary: string;
  readonly shortDescription?: string;
  readonly description?: string;
  readonly styleDirectives: readonly string[];
  readonly mediumKeywords: readonly string[];
  readonly lightingKeywords: readonly string[];
  readonly defaultNegativeDirectives: readonly string[];
  readonly recommendedAspectRatios: readonly AspectRatio[];
  readonly visualCharacteristics?: string;
  readonly renderingTechnique?: string;
  readonly renderingRules?: string;
  readonly lineworkRules?: string;
  readonly colorRules?: string;
  readonly textureRules?: string;
  readonly shadingRules?: string;
  readonly compositionRules?: string;
  readonly detailLevel?: PromptDetailLevel;
  readonly promptTemplate?: string;
  readonly negativePromptTemplate?: string;
  readonly tags?: readonly string[];
  readonly previewAsset?: ArtStylePreviewAsset;
  readonly isActive?: boolean;
  readonly isCurated: boolean;
  readonly version: number;
}

export interface StyleFavoriteRecord extends EntityTimestamps {
  readonly id: EntityId;
  readonly styleId: EntityId;
  readonly isFavorite: boolean;
}

export interface StyleCatalogItem {
  readonly style: ArtStyle;
  readonly isFavorite: boolean;
}

export interface StructuredArtStyleConfig {
  readonly source?: CreativeDirectionMode;
  readonly styleId: EntityId | null;
  readonly styleName: string;
  readonly styleCategory: string;
  readonly styleDescription: string;
  readonly visualCharacteristics: string;
  readonly renderingRules: string;
  readonly renderingTechnique?: string;
  readonly lineworkRules: string;
  readonly colorRules: string;
  readonly textureRules: string;
  readonly shadingRules: string;
  readonly compositionRules: string;
  readonly detailLevel: PromptDetailLevel;
  readonly promptTemplate?: string;
  readonly negativePromptTemplate?: string;
  readonly isManualCreativeDirection: boolean;
}

export interface PromptCompositionPreferences {
  readonly aspectRatio: AspectRatio;
  readonly compositionDirection: string;
  readonly backgroundTreatment: PromptBackgroundTreatment;
  readonly detailLevel: PromptDetailLevel;
  readonly outputOrientation: PromptOutputOrientation;
}

export type PromptApprovalStatus =
  | 'draft'
  | 'generated'
  | 'edited'
  | 'approved'
  | 'needs_review'
  | 'rejected';

export type PromptKind = 'master' | 'variation';

export interface PromptDocument extends EntityTimestamps {
  readonly id: EntityId;
  readonly promptId?: EntityId;
  readonly projectId: EntityId;
  readonly descriptionId: EntityId;
  readonly sourceDescriptionRevision?: number;
  readonly styleId: EntityId | null;
  readonly selectedStyleId?: EntityId | null;
  readonly creativeDirection?: StructuredArtStyleConfig;
  readonly userInstructions: string;
  readonly creativeInstructions?: string;
  readonly compositionPreferences?: PromptCompositionPreferences;
  readonly unresolvedConflicts?: readonly string[];
  readonly generatedPrompt: string;
  readonly finalPrompt: string;
  readonly negativePrompt: string;
  readonly approvalStatus: PromptApprovalStatus;
  readonly generatedAt?: IsoTimestamp | null;
  readonly approvedAt: IsoTimestamp | null;
  readonly revision: number;
  readonly revisionNumber?: number;
  readonly providerId?: string;
  readonly modelId?: string;
  readonly modelVersion?: string;
  readonly responseId?: string;
  readonly promptKind?: PromptKind;
  readonly parentPromptId?: EntityId | null;
  readonly parentGenerationId?: EntityId | null;
  readonly variationId?: EntityId | null;
  readonly variationInstructions?: string;
}

export const GENERATION_JOB_STATUSES = [
  'pending',
  'processing',
  'completed',
  'failed',
] as const;

export type GenerationJobStatus = (typeof GENERATION_JOB_STATUSES)[number];

export type GenerationKind = 'original' | 'regeneration' | 'variation';

export interface GenerationModelParameters {
  readonly guidanceScale?: number;
  readonly inferenceSteps?: number;
  readonly seed?: number;
  readonly safetyFilterLevel?: 'strict' | 'balanced';
}

export interface GenerationJob extends EntityTimestamps {
  readonly id: EntityId;
  readonly projectId: EntityId;
  readonly promptDocumentId: EntityId;
  readonly providerConfigRef: ProviderConfigRef;
  readonly aspectRatio: AspectRatio;
  readonly resolution: ImageResolution;
  readonly modelParameters: GenerationModelParameters;
  readonly status: GenerationJobStatus;
  readonly artworkIds: readonly EntityId[];
  readonly errorMessage: string | null;
  readonly errorCode: string | null;
  readonly queuedAt: IsoTimestamp;
  readonly startedAt: IsoTimestamp | null;
  readonly completedAt: IsoTimestamp | null;
  readonly generationKind?: GenerationKind;
  readonly parentGenerationId?: EntityId | null;
  readonly parentPromptId?: EntityId | null;
  readonly variationId?: EntityId | null;
  readonly variationPromptId?: EntityId | null;
  readonly variationInstructions?: string | null;
  readonly variationLabel?: string | null;
  readonly includeNegativePrompt?: boolean;
  readonly negativePromptUsed?: string;
}

export interface GeneratedArtwork extends EntityTimestamps {
  readonly id: EntityId;
  readonly projectId: EntityId;
  readonly generationJobId: EntityId;
  readonly promptDocumentId: EntityId;
  readonly mimeType: SupportedSourceMimeType;
  readonly width: number;
  readonly height: number;
  readonly localBlobKey: string;
  readonly fileSizeBytes?: number;
  readonly seedUsed?: number;
  readonly providerModelId: string;
  readonly generationKind?: GenerationKind;
  readonly parentGenerationId?: EntityId | null;
  readonly variationId?: EntityId | null;
  readonly variationLabel?: string | null;
}

export interface Preset extends EntityTimestamps {
  readonly id: EntityId;
  readonly name: string;
  readonly description: string;
  readonly styleId: EntityId;
  readonly defaultAspectRatio: AspectRatio;
  readonly defaultResolution: ImageResolution;
  readonly defaultNegativePrompt: string;
  readonly userInstructionTemplate: string;
  readonly modelParameters: GenerationModelParameters;
}

export interface PersonalPresetSnapshot {
  readonly source: CreativeDirectionMode;
  readonly styleId: EntityId | null;
  readonly styleName: string;
  readonly styleCategory: string;
  readonly styleDescription: string;
  readonly visualCharacteristics: string;
  readonly renderingTechnique: string;
  readonly lineworkRules: string;
  readonly colorRules: string;
  readonly textureRules: string;
  readonly shadingRules: string;
  readonly compositionRules: string;
  readonly detailLevel: PromptDetailLevel;
  readonly promptTemplate?: string;
  readonly negativePromptTemplate?: string;
}

export interface PersonalPreset extends EntityTimestamps {
  readonly id: EntityId;
  readonly name: string;
  readonly description: string;
  readonly styleId: EntityId | null;
  readonly selectedStyleId: EntityId | null;
  readonly creativeDirectionMode: CreativeDirectionMode;
  readonly creativeDirectionSnapshot: PersonalPresetSnapshot;
  readonly aspectRatio: AspectRatio;
  readonly outputOrientation: PromptOutputOrientation;
  readonly backgroundTreatment: PromptBackgroundTreatment;
  readonly detailLevel: PromptDetailLevel;
  readonly compositionDirection: string;
  readonly userCreativeInstructions: string;
  readonly negativePrompt: string;
  readonly tags: readonly string[];
  readonly version: number;
}

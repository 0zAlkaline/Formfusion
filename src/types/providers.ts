import type { EntityId, ServiceErrorCode, ServiceResult } from './common.ts';
import type {
  PromptCompositionPreferences,
  StructuredArtStyleConfig,
} from './domain.ts';

export type ProviderKind = 'vision_analysis' | 'text_to_image';

/**
 * Non-sensitive provider reference passed between client and server boundaries.
 * Credentials and secrets are resolved exclusively server-side and must never
 * appear in this object.
 */
export interface ProviderConfigRef {
  readonly providerId: string;
  readonly modelId: string;
  readonly endpointProfile?: string;
}

export interface ProviderAuthContext {
  readonly providerId: string;
  readonly credentialEnvVar: string;
  readonly isConfigured: boolean;
}

export interface ProviderCapabilityDeclaration {
  readonly providerId: string;
  readonly kind: ProviderKind;
  readonly displayName: string;
  readonly supportedModels: readonly string[];
  readonly supportsNegativePrompt: boolean;
  readonly supportedAspectRatios: readonly string[];
  readonly maxPromptLength: number;
  readonly maxOutputResolution: {
    readonly width: number;
    readonly height: number;
  };
  readonly supportsSeed: boolean;
}

export interface ProviderNormalizedError {
  readonly providerId: string;
  readonly code: ServiceErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly upstreamStatus?: number;
}

export interface VisionAnalysisProviderInput {
  readonly sourceAssetId: EntityId;
  readonly mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  readonly imageBytes: Uint8Array;
  readonly modelId: string;
  readonly analysisHints?: string;
}

export interface VisionAnalysisProviderOutput {
  readonly providerId: string;
  readonly modelId: string;
  readonly sceneSummary: string;
  readonly lightingNotes: string;
  readonly compositionNotes: string;
  readonly detectedObjects: readonly {
    readonly label: string;
    readonly category: string;
    readonly confidence: number;
    readonly spatialPosition: string;
    readonly dominantColors: readonly string[];
    readonly materials: readonly string[];
    readonly keyAttributes: readonly string[];
  }[];
}

export interface VisionAnalysisProviderAdapter {
  readonly providerId: string;
  getCapabilities(): ProviderCapabilityDeclaration;
  resolveAuthContext(): ProviderAuthContext;
  mapRequest(input: VisionAnalysisProviderInput): unknown;
  execute(input: VisionAnalysisProviderInput): Promise<ServiceResult<VisionAnalysisProviderOutput>>;
  normalizeError(error: unknown): ProviderNormalizedError;
}

export interface TextToImageProviderInput {
  readonly finalApprovedPrompt: string;
  readonly negativePrompt?: string;
  readonly aspectRatio: string;
  readonly width: number;
  readonly height: number;
  readonly modelId: string;
  readonly guidanceScale?: number;
  readonly inferenceSteps?: number;
  readonly seed?: number;
  readonly safetyFilterLevel?: 'strict' | 'balanced';
}

export interface TextToImageProviderOutput {
  readonly providerId: string;
  readonly modelId: string;
  readonly images: readonly {
    readonly mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
    readonly bytes: Uint8Array;
    readonly width: number;
    readonly height: number;
    readonly seedUsed?: number;
  }[];
}

export interface ImageGenerationProviderAdapter {
  readonly providerId: string;
  getCapabilities(): ProviderCapabilityDeclaration;
  resolveAuthContext(): ProviderAuthContext;
  mapRequest(input: TextToImageProviderInput): unknown;
  execute(input: TextToImageProviderInput): Promise<ServiceResult<TextToImageProviderOutput>>;
  normalizeResponse(rawResponse: unknown): ServiceResult<TextToImageProviderOutput>;
  normalizeError(error: unknown): ProviderNormalizedError;
}

export type GeminiInitializationStatus =
  | 'NOT_CONFIGURED'
  | 'CONFIGURED'
  | 'INITIALIZED'
  | 'CONNECTIVITY_VERIFIED'
  | 'ERROR';

export type GeminiErrorCategory =
  | 'MISSING_CREDENTIAL'
  | 'INVALID_CONFIGURATION'
  | 'INVALID_MODEL_CONFIGURATION'
  | 'SDK_INITIALIZATION_FAILURE'
  | 'AUTHENTICATION_FAILURE'
  | 'PERMISSION_FAILURE'
  | 'RATE_LIMIT'
  | 'PROVIDER_UNAVAILABLE'
  | 'NETWORK_TIMEOUT'
  | 'UNKNOWN_PROVIDER_ERROR';

export interface GeminiProviderPublicStatus {
  readonly providerId: 'gemini';
  readonly providerName: 'Google Gemini';
  readonly kind: 'vision_analysis';
  readonly modelId: string | null;
  readonly credentialEnvVar: 'GEMINI_API_KEY';
  readonly modelEnvVar: 'GEMINI_MODEL_ID';
  readonly enabled: boolean;
  readonly credentialConfigured: boolean;
  readonly modelConfigured: boolean;
  readonly initializationStatus: GeminiInitializationStatus;
  readonly connectivityChecked: boolean;
  readonly lastCheckedAt: string | null;
  readonly capabilitiesPendingVerification: boolean;
  readonly statusMessage: string;
  readonly setupInstruction?: string;
  readonly errorCategory?: GeminiErrorCategory;
}

export interface VisionAnalysisTokenUsage {
  readonly promptTokenCount?: number;
  readonly candidatesTokenCount?: number;
  readonly thoughtsTokenCount?: number;
  readonly totalTokenCount?: number;
}

export interface VisionRawAnalysisInput {
  readonly projectId: EntityId;
  readonly sourceAssetId: EntityId;
  readonly mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  readonly imageBytes: Uint8Array;
  readonly abortSignal?: AbortSignal;
  readonly timeoutMs?: number;
}

export interface RawVisionAnalysisResult {
  readonly requestStatus: 'succeeded';
  readonly providerId: 'gemini';
  readonly modelId: string;
  readonly modelVersion?: string;
  readonly responseId?: string;
  readonly analyzedAt: string;
  readonly projectId: EntityId;
  readonly sourceAssetId: EntityId;
  readonly rawText: string;
  readonly finishReason?: string;
  readonly usageMetadata?: VisionAnalysisTokenUsage;
}

export interface PromptSynthesisSubjectInput {
  readonly descriptionId: EntityId;
  readonly sourceDescriptionRevision: number;
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
  readonly userNotes: string;
}

export interface PromptSynthesisProviderInput {
  readonly projectId: EntityId;
  readonly subject: PromptSynthesisSubjectInput;
  readonly creativeDirection: StructuredArtStyleConfig;
  readonly creativeInstructions: string;
  readonly compositionPreferences: PromptCompositionPreferences;
  readonly detectedInputConflicts?: readonly string[];
  readonly abortSignal?: AbortSignal;
  readonly timeoutMs?: number;
}

export interface PromptSynthesisProviderOutput {
  readonly requestStatus: 'succeeded';
  readonly providerId: 'gemini';
  readonly modelId: string;
  readonly modelVersion?: string;
  readonly responseId?: string;
  readonly generatedAt: string;
  readonly generatedPrompt: string;
  readonly negativePrompt: string;
  readonly unresolvedConflicts: readonly string[];
  readonly finishReason?: string;
}

export type ImageGenerationProviderStatusValue =
  | 'not_configured'
  | 'configured'
  | 'verifying'
  | 'connected'
  | 'error'
  | 'rate_limited'
  | 'unavailable';

export type ImageGenerationProviderErrorCategory =
  | 'MISSING_CREDENTIAL'
  | 'INVALID_CONFIGURATION'
  | 'INVALID_MODEL_CONFIGURATION'
  | 'AUTHENTICATION_FAILURE'
  | 'PERMISSION_FAILURE'
  | 'RATE_LIMITED'
  | 'UNAVAILABLE'
  | 'PROVIDER_UNAVAILABLE'
  | 'NETWORK_TIMEOUT'
  | 'CANCELLED'
  | 'INVALID_RESPONSE'
  | 'UNKNOWN_PROVIDER_ERROR';

export interface ImageGenerationSupportedOutputSize {
  readonly width: number;
  readonly height: number;
  readonly aspectRatio: string;
  readonly label: string;
}

export interface ImageGenerationProviderCapabilities {
  readonly providerId: string;
  readonly providerName: string;
  readonly modelId: string;
  readonly task: 'text-to-image';
  readonly isFreeTierModel: boolean;
  readonly supportsNegativePrompt: boolean;
  readonly supportsImageToImage: false;
  readonly supportedOutputSizes: readonly ImageGenerationSupportedOutputSize[];
  readonly maxNumberOfImages: number;
  readonly maxPromptLength: number;
  readonly supportsSeed: boolean;
  readonly supportsGuidanceScale: boolean;
  readonly supportsInferenceSteps: boolean;
  readonly supportsAnonymousFreeTier: boolean;
  readonly anonymousRateLimitRpm: number | null;
  readonly authenticatedRateLimitRpm: number | null;
  readonly requiresExplicitConfirmationForSmokeTest: boolean;
  readonly hasDedicatedHealthEndpoint: boolean;
  readonly warnings: readonly string[];
  readonly unsupportedParameters: readonly string[];
}

export interface NormalizedImageGenerationRequest {
  readonly projectId: EntityId;
  readonly promptId: EntityId;
  readonly providerId?: string;
  readonly approvalStatus: 'approved';
  readonly approvedPrompt: string;
  readonly negativePrompt?: string;
  readonly modelId: string;
  readonly aspectRatio: string;
  readonly outputWidth: number;
  readonly outputHeight: number;
  readonly numberOfImages: number;
  readonly providerParameters: {
    readonly guidanceScale?: number;
    readonly inferenceSteps?: number;
    readonly seed?: number;
    readonly safetyFilterLevel?: 'strict' | 'balanced';
  };
  readonly isSmokeTest?: boolean;
}

export interface RegisteredImageGenerationProviderSummary {
  readonly status: ImageGenerationProviderPublicStatus;
  readonly capabilities: ImageGenerationProviderCapabilities;
  readonly isActive: boolean;
}

export interface NormalizedImageGenerationNormalizationReport {
  readonly normalizedRequest: NormalizedImageGenerationRequest;
  readonly omittedParameters: readonly string[];
  readonly warnings: readonly string[];
}

export interface NormalizedImageGenerationUsageMetadata {
  readonly isFreeTier: boolean;
  readonly accessMode: 'authenticated' | 'anonymous_free_tier';
  readonly testRequestCount: number;
  readonly anonymousRateLimitRpm: number | null;
  readonly retryAfterSeconds?: number;
  readonly byteSize: number;
  readonly omittedParameters: readonly string[];
}

export interface NormalizedImageGenerationResponse {
  readonly generationId: EntityId;
  readonly providerId: string;
  readonly modelId: string;
  readonly status: 'succeeded' | 'failed';
  readonly outputFormat?: 'png' | 'jpeg' | 'webp';
  readonly mimeType?: 'image/png' | 'image/jpeg' | 'image/webp';
  readonly outputDimensions?: {
    readonly width: number;
    readonly height: number;
  };
  readonly imageBytes?: Uint8Array;
  readonly temporaryImageDataUrl?: string;
  readonly createdAt: string;
  readonly durationMs: number;
  readonly usageMetadata?: NormalizedImageGenerationUsageMetadata;
  readonly error?: {
    readonly code: ServiceErrorCode;
    readonly category: ImageGenerationProviderErrorCategory;
    readonly message: string;
    readonly retryable: boolean;
    readonly upstreamStatus?: number;
  };
}

export interface ImageGenerationProviderPublicStatus {
  readonly providerId: string;
  readonly providerName: string;
  readonly modelId: string;
  readonly task: 'text-to-image';
  readonly enabled: boolean;
  readonly isFreeTierModel: boolean;
  readonly accessMode: 'authenticated' | 'anonymous_free_tier' | 'disabled';
  readonly tokenConfigured: boolean;
  readonly anonymousFreeTierEnabled: boolean;
  readonly credentialEnvVar: 'OVH_AI_ENDPOINTS_ACCESS_TOKEN';
  readonly configurationStatus: 'configured' | 'not_configured' | 'invalid';
  readonly connectionStatus: ImageGenerationProviderStatusValue;
  readonly lastHealthCheckAt: string | null;
  readonly lastSmokeTestAt: string | null;
  readonly testRequestCount: number;
  readonly statusMessage: string;
  readonly setupInstruction?: string;
  readonly errorCategory?: ImageGenerationProviderErrorCategory;
  readonly retryAfterSeconds?: number;
  readonly warnings: readonly string[];
}

export interface ImageGenerationSmokeTestResult {
  readonly generationId: EntityId;
  readonly providerId: string;
  readonly modelId: string;
  readonly status: 'succeeded';
  readonly promptUsed: string;
  readonly outputFormat: 'png' | 'jpeg' | 'webp';
  readonly mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  readonly width: number;
  readonly height: number;
  readonly byteSize: number;
  readonly durationMs: number;
  readonly createdAt: string;
  readonly accessMode: 'authenticated' | 'anonymous_free_tier';
  readonly isFreeTierModel: boolean;
  readonly testRequestCount: number;
  readonly omittedParameters: readonly string[];
  readonly previewImageDataUrl: string;
}

export interface ImageGenerationExecutionOptions {
  readonly abortSignal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly allowAnonymousFreeTier?: boolean;
}

export interface ImageGenerationHealthCheckResult {
  readonly status: ImageGenerationProviderPublicStatus;
  readonly capabilities: ImageGenerationProviderCapabilities;
  readonly reachable: boolean;
}

export interface ImageGenerationProvider {
  readonly providerId: string;
  getCapabilities(): ImageGenerationProviderCapabilities;
  getPublicStatus(): ImageGenerationProviderPublicStatus;
  checkHealth(
    options?: ImageGenerationExecutionOptions,
  ): Promise<ImageGenerationHealthCheckResult>;
  generate(
    request: NormalizedImageGenerationRequest,
    options?: ImageGenerationExecutionOptions,
  ): Promise<NormalizedImageGenerationResponse>;
  runSmokeTest(options: {
    readonly confirmed: boolean;
    readonly prompt?: string;
    readonly allowAnonymousFreeTier?: boolean;
    readonly abortSignal?: AbortSignal;
    readonly timeoutMs?: number;
  }): Promise<ServiceResult<ImageGenerationSmokeTestResult>>;
}



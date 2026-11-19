import { errResult, okResult } from '../../types/common.ts';
import type { EntityId, ServiceResult } from '../../types/common.ts';
import type {
  AspectRatio,
  GeneratedArtwork,
  GenerationJob,
  GenerationKind,
  ImageResolution,
  PromptDocument,
} from '../../types/domain.ts';
import type { RegisteredImageGenerationProviderSummary } from '../../types/providers.ts';
import { createEntityId, isValidEntityId, nowIsoTimestamp } from '../../utils/ids.ts';
import { isNonEmptyString } from '../../utils/validation.ts';
import {
  isProviderReadyWithSelection,
  resolveSupportedOutputSpec,
} from './imageGenerationClient.ts';

export type GenerationHistoryFilter =
  | 'all'
  | 'original'
  | 'regeneration'
  | 'variation'
  | 'failed';

export type GenerationHistorySortOrder = 'newest' | 'oldest';

export interface GenerationHistoryFilterOption {
  readonly id: GenerationHistoryFilter;
  readonly label: string;
  readonly count: number;
}

export interface PersistedGenerationRecordBundle {
  readonly job: GenerationJob;
  readonly artwork: GeneratedArtwork | null;
  readonly imageBlob: Blob | null;
  readonly blobMissingOrCorrupted: boolean;
  readonly blobErrorMessage: string | null;
  readonly fileSizeBytes: number | null;
  readonly promptDocument: PromptDocument | null;
  readonly parentPromptDocument: PromptDocument | null;
}

export const VARIATION_INSTRUCTION_EXAMPLES: readonly string[] = [
  'Use a warmer color palette',
  'Introduce more dramatic lighting',
  'Simplify the surrounding details',
  'Use a more minimal composition',
  'Increase visual contrast',
  'Explore a more playful interpretation',
] as const;

const BASE64_DATA_URI_REGEX = /data:image\/[a-zA-Z0-9.+-]+;base64,/i;
const COMPARE_STORAGE_KEY_PREFIX = 'formfusion:compareSelection:' as const;

export function resolveGenerationKind(
  job: Pick<GenerationJob, 'generationKind' | 'parentGenerationId' | 'variationId' | 'variationPromptId'>,
  promptDoc?: Pick<PromptDocument, 'promptKind' | 'variationId'> | null,
): GenerationKind {
  if (
    job.generationKind === 'original' ||
    job.generationKind === 'regeneration' ||
    job.generationKind === 'variation'
  ) {
    return job.generationKind;
  }
  if (
    job.variationId ||
    job.variationPromptId ||
    promptDoc?.promptKind === 'variation' ||
    promptDoc?.variationId
  ) {
    return 'variation';
  }
  if (job.parentGenerationId) {
    return 'regeneration';
  }
  return 'original';
}

export function getGenerationKindLabel(kind: GenerationKind): string {
  switch (kind) {
    case 'regeneration':
      return 'Regenerated';
    case 'variation':
      return 'Variation';
    default:
      return 'Original';
  }
}

export function getAvailableHistoryFilters(
  entries: readonly PersistedGenerationRecordBundle[],
): readonly GenerationHistoryFilterOption[] {
  let originalCount = 0;
  let regenerationCount = 0;
  let variationCount = 0;
  let failedCount = 0;

  for (const entry of entries) {
    const kind = resolveGenerationKind(entry.job, entry.promptDocument);
    if (entry.job.status === 'failed') {
      failedCount += 1;
    }
    if (kind === 'original') {
      originalCount += 1;
    } else if (kind === 'regeneration') {
      regenerationCount += 1;
    } else if (kind === 'variation') {
      variationCount += 1;
    }
  }

  return [
    { id: 'all', label: 'All generations', count: entries.length },
    { id: 'original', label: 'Original generations', count: originalCount },
    { id: 'regeneration', label: 'Regenerated artworks', count: regenerationCount },
    { id: 'variation', label: 'Variations', count: variationCount },
    { id: 'failed', label: 'Failed generations', count: failedCount },
  ];
}

export function filterAndSortGenerationEntries(
  entries: readonly PersistedGenerationRecordBundle[],
  options: {
    readonly filter: GenerationHistoryFilter;
    readonly sortOrder: GenerationHistorySortOrder;
  },
): readonly PersistedGenerationRecordBundle[] {
  const filtered = entries.filter((entry) => {
    if (options.filter === 'all') {
      return true;
    }
    if (options.filter === 'failed') {
      return entry.job.status === 'failed';
    }
    return resolveGenerationKind(entry.job, entry.promptDocument) === options.filter;
  });

  return [...filtered].sort((a, b) => {
    const timeA = a.artwork?.createdAt ?? a.job.queuedAt;
    const timeB = b.artwork?.createdAt ?? b.job.queuedAt;
    const cmp =
      options.sortOrder === 'newest'
        ? timeB.localeCompare(timeA)
        : timeA.localeCompare(timeB);
    if (cmp !== 0) {
      return cmp;
    }
    return options.sortOrder === 'newest'
      ? b.job.id.localeCompare(a.job.id)
      : a.job.id.localeCompare(b.job.id);
  });
}

export interface RegenerationEligibilityResult {
  readonly eligible: boolean;
  readonly promptDocument: PromptDocument;
  readonly providerSummary: RegisteredImageGenerationProviderSummary;
  readonly includeNegativePrompt: boolean;
  readonly aspectRatio: AspectRatio;
  readonly resolution: ImageResolution;
}

export function validateRegenerationEligibility(params: {
  readonly projectId: EntityId;
  readonly sourceEntry: PersistedGenerationRecordBundle | null | undefined;
  readonly registeredProviders: readonly RegisteredImageGenerationProviderSummary[];
  readonly allowAnonymousFreeTier: boolean;
}): ServiceResult<RegenerationEligibilityResult> {
  if (!params.sourceEntry) {
    return errResult(
      'NOT_FOUND',
      'Selected generation record could not be found in project history.',
    );
  }

  const { job, promptDocument } = params.sourceEntry;

  if (job.projectId !== params.projectId) {
    return errResult(
      'VALIDATION_ERROR',
      'Selected generation record belongs to a different study project.',
    );
  }

  if (!promptDocument) {
    return errResult(
      'NOT_FOUND',
      'The original prompt snapshot for this generation is missing from local storage and cannot be regenerated.',
    );
  }

  if (promptDocument.projectId !== params.projectId) {
    return errResult(
      'VALIDATION_ERROR',
      'Persisted prompt snapshot does not belong to the active study project.',
    );
  }

  if (
    promptDocument.approvalStatus !== 'approved' ||
    !isNonEmptyString(promptDocument.finalPrompt)
  ) {
    return errResult(
      'VALIDATION_ERROR',
      'Original prompt snapshot is not in an approved state and cannot be regenerated.',
    );
  }

  const recordedProviderId = job.providerConfigRef.providerId;
  const recordedModelId = job.providerConfigRef.modelId;

  const matchedProvider = params.registeredProviders.find(
    (item) =>
      item.capabilities.providerId === recordedProviderId &&
      item.capabilities.modelId === recordedModelId,
  );

  if (!matchedProvider) {
    return errResult(
      'PROVIDER_UNAVAILABLE',
      `Original provider "${recordedProviderId}" with model "${recordedModelId}" is currently unavailable. Automatic provider switching and paid upgrades are disabled.`,
      {
        recordedProviderId,
        recordedModelId,
      },
    );
  }

  if (
    matchedProvider.capabilities.maxPromptLength > 0 &&
    promptDocument.finalPrompt.trim().length >
      matchedProvider.capabilities.maxPromptLength
  ) {
    return errResult(
      'VALIDATION_ERROR',
      `Original approved prompt exceeds ${matchedProvider.capabilities.providerName}'s ${matchedProvider.capabilities.maxPromptLength}-character limit.`,
    );
  }

  if (
    matchedProvider.status.connectionStatus === 'unavailable' ||
    matchedProvider.status.errorCategory === 'UNAVAILABLE' ||
    matchedProvider.status.errorCategory === 'INVALID_CONFIGURATION' ||
    matchedProvider.status.errorCategory === 'INVALID_MODEL_CONFIGURATION'
  ) {
    return errResult(
      'PROVIDER_UNAVAILABLE',
      matchedProvider.status.statusMessage,
    );
  }

  if (!isProviderReadyWithSelection(matchedProvider, params.allowAnonymousFreeTier)) {
    return errResult(
      'PROVIDER_UNAVAILABLE',
      matchedProvider.status.statusMessage ||
        'Enable anonymous free-tier access or configure a server token in Settings before regenerating.',
      { reason: 'PROVIDER_NOT_CONFIGURED' },
    );
  }

  const supportedSpec = resolveSupportedOutputSpec(matchedProvider.capabilities);
  const hasRecordedNegative =
    typeof job.includeNegativePrompt === 'boolean'
      ? job.includeNegativePrompt
      : promptDocument.negativePrompt.trim().length > 0;

  return okResult({
    eligible: true,
    promptDocument,
    providerSummary: matchedProvider,
    includeNegativePrompt:
      matchedProvider.capabilities.supportsNegativePrompt && hasRecordedNegative,
    aspectRatio: supportedSpec.aspectRatio,
    resolution: {
      width: supportedSpec.width,
      height: supportedSpec.height,
      label: 'standard',
    },
  });
}

export interface ComposeVariationPromptInput {
  readonly parentPromptDocument: PromptDocument;
  readonly variationInstructions: string;
  readonly negativePromptAdjustment?: string;
  readonly supportsNegativePrompt: boolean;
  readonly maxPromptLength: number;
}

export interface ComposedVariationPromptDraft {
  readonly composedPrompt: string;
  readonly negativePrompt: string;
  readonly variationInstructions: string;
}

export function composeVariationPromptText(
  input: ComposeVariationPromptInput,
): ServiceResult<ComposedVariationPromptDraft> {
  if (
    input.parentPromptDocument.approvalStatus !== 'approved' ||
    !isNonEmptyString(input.parentPromptDocument.finalPrompt)
  ) {
    return errResult(
      'VALIDATION_ERROR',
      'Parent generation must reference an approved Final Master Prompt before creating a variation.',
    );
  }

  const trimmedInstructions = input.variationInstructions.trim();
  if (!trimmedInstructions) {
    return errResult(
      'VALIDATION_ERROR',
      'Enter variation instructions describing how to evolve this artwork direction.',
    );
  }

  if (BASE64_DATA_URI_REGEX.test(trimmedInstructions)) {
    return errResult(
      'SECURITY_BOUNDARY_VIOLATION',
      'Variation instructions must contain text directives only (base64 image URIs are prohibited).',
    );
  }

  const basePrompt = input.parentPromptDocument.finalPrompt.trim();
  const creativeDirection = input.parentPromptDocument.creativeDirection;
  const constraintFragments: string[] = [];

  if (creativeDirection?.styleName) {
    constraintFragments.push(`Maintain ${creativeDirection.styleName} aesthetic`);
  }
  if (input.parentPromptDocument.compositionPreferences?.compositionDirection) {
    constraintFragments.push(
      input.parentPromptDocument.compositionPreferences.compositionDirection,
    );
  }

  const constraintSuffix =
    constraintFragments.length > 0
      ? ` Creative direction alignment: ${constraintFragments.join('; ')}.`
      : '';

  const normalizedBase = /[.!?]$/.test(basePrompt) ? basePrompt : `${basePrompt}.`;
  const normalizedInstructions = /[.!?]$/.test(trimmedInstructions)
    ? trimmedInstructions
    : `${trimmedInstructions}.`;

  const composedPrompt =
    `${normalizedBase} Variation refinement: ${normalizedInstructions}${constraintSuffix}`.trim();

  if (input.maxPromptLength > 0 && composedPrompt.length > input.maxPromptLength) {
    return errResult(
      'VALIDATION_ERROR',
      `Composed variation prompt (${composedPrompt.length} characters) exceeds the provider's ${input.maxPromptLength}-character limit. Shorten the prompt or variation instructions.`,
      {
        maxPromptLength: input.maxPromptLength,
        actualLength: composedPrompt.length,
      },
    );
  }

  const trimmedNegative = input.supportsNegativePrompt
    ? (input.negativePromptAdjustment ?? input.parentPromptDocument.negativePrompt).trim()
    : '';

  if (BASE64_DATA_URI_REGEX.test(trimmedNegative)) {
    return errResult(
      'SECURITY_BOUNDARY_VIOLATION',
      'Negative prompt adjustments must not contain base64 image payloads.',
    );
  }

  return okResult({
    composedPrompt,
    negativePrompt: trimmedNegative,
    variationInstructions: trimmedInstructions,
  });
}

export function createApprovedVariationPromptDocument(params: {
  readonly projectId: EntityId;
  readonly parentPromptDocument: PromptDocument;
  readonly parentGenerationId: EntityId;
  readonly variationInstructions: string;
  readonly composedBaselinePrompt: string;
  readonly finalVariationPrompt: string;
  readonly negativePrompt: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly nextRevisionNumber: number;
  readonly maxPromptLength: number;
}): ServiceResult<{
  readonly variationId: EntityId;
  readonly variationPromptDocument: PromptDocument;
}> {
  if (!isValidEntityId(params.projectId) || !isValidEntityId(params.parentGenerationId)) {
    return errResult(
      'VALIDATION_ERROR',
      'Valid projectId and parentGenerationId are required to create a variation prompt snapshot.',
    );
  }

  if (params.parentPromptDocument.projectId !== params.projectId) {
    return errResult(
      'VALIDATION_ERROR',
      'Parent prompt document does not match the active study project.',
    );
  }

  const instructions = params.variationInstructions.trim();
  const baseline = params.composedBaselinePrompt.trim();
  const finalText = params.finalVariationPrompt.trim();
  const negativeText = params.negativePrompt.trim();

  if (!instructions) {
    return errResult(
      'VALIDATION_ERROR',
      'Variation instructions cannot be empty when approving a variation.',
    );
  }

  if (!baseline || !finalText) {
    return errResult(
      'VALIDATION_ERROR',
      'Composed variation prompt cannot be empty before approving.',
    );
  }

  if (
    BASE64_DATA_URI_REGEX.test(instructions) ||
    BASE64_DATA_URI_REGEX.test(baseline) ||
    BASE64_DATA_URI_REGEX.test(finalText) ||
    BASE64_DATA_URI_REGEX.test(negativeText)
  ) {
    return errResult(
      'SECURITY_BOUNDARY_VIOLATION',
      'Variation prompt documents must contain text prompts only (base64 images prohibited).',
    );
  }

  if (params.maxPromptLength > 0 && finalText.length > params.maxPromptLength) {
    return errResult(
      'VALIDATION_ERROR',
      `Approved variation prompt (${finalText.length} characters) exceeds the provider's ${params.maxPromptLength}-character limit.`,
    );
  }

  const now = nowIsoTimestamp();
  const variationId = createEntityId('var');
  const variationPromptId = createEntityId('prm');
  const revisionNumber = Math.max(1, params.nextRevisionNumber);

  const variationPromptDocument: PromptDocument = {
    id: variationPromptId,
    promptId: variationPromptId,
    projectId: params.projectId,
    descriptionId: params.parentPromptDocument.descriptionId,
    sourceDescriptionRevision: params.parentPromptDocument.sourceDescriptionRevision,
    styleId: params.parentPromptDocument.styleId,
    selectedStyleId:
      params.parentPromptDocument.selectedStyleId ??
      params.parentPromptDocument.styleId,
    creativeDirection: params.parentPromptDocument.creativeDirection,
    userInstructions: instructions,
    creativeInstructions: instructions,
    compositionPreferences: params.parentPromptDocument.compositionPreferences,
    unresolvedConflicts: [],
    generatedPrompt: baseline,
    finalPrompt: finalText,
    negativePrompt: negativeText,
    approvalStatus: 'approved',
    generatedAt: now,
    approvedAt: now,
    revision: revisionNumber,
    revisionNumber,
    providerId: params.providerId,
    modelId: params.modelId,
    promptKind: 'variation',
    parentPromptId: params.parentPromptDocument.id,
    parentGenerationId: params.parentGenerationId,
    variationId,
    variationInstructions: instructions,
    createdAt: now,
    updatedAt: now,
  };

  return okResult({
    variationId,
    variationPromptDocument,
  });
}

export function readStoredComparisonSelection(
  projectId: EntityId,
): readonly EntityId[] {
  try {
    if (
      typeof globalThis === 'undefined' ||
      !('localStorage' in globalThis) ||
      !globalThis.localStorage ||
      !isValidEntityId(projectId)
    ) {
      return [];
    }
    const raw = globalThis.localStorage.getItem(
      `${COMPARE_STORAGE_KEY_PREFIX}${projectId}`,
    );
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    const validIds: EntityId[] = [];
    for (const item of parsed) {
      if (isValidEntityId(item) && !validIds.includes(item)) {
        validIds.push(item);
      }
    }
    return validIds;
  } catch {
    return [];
  }
}

export function writeStoredComparisonSelection(
  projectId: EntityId,
  selectedJobIds: readonly EntityId[],
): void {
  try {
    if (
      typeof globalThis === 'undefined' ||
      !('localStorage' in globalThis) ||
      !globalThis.localStorage ||
      !isValidEntityId(projectId)
    ) {
      return;
    }
    const key = `${COMPARE_STORAGE_KEY_PREFIX}${projectId}`;
    const cleanIds = selectedJobIds.filter((id) => isValidEntityId(id));
    if (cleanIds.length === 0) {
      globalThis.localStorage.removeItem(key);
    } else {
      globalThis.localStorage.setItem(key, JSON.stringify(cleanIds));
    }
  } catch {
    // Ignore storage access errors in restricted environments.
  }
}

export function reconcileComparisonSelection(
  selectedJobIds: readonly EntityId[],
  entries: readonly PersistedGenerationRecordBundle[],
): readonly EntityId[] {
  const validCompletedIds = new Set(
    entries
      .filter((entry) => entry.artwork !== null && entry.job.status === 'completed')
      .map((entry) => entry.job.id),
  );
  return selectedJobIds.filter((id) => validCompletedIds.has(id));
}

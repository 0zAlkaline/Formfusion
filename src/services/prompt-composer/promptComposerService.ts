import { errResult, okResult } from '../../types/common.ts';
import type { EntityId, ServiceResult } from '../../types/common.ts';
import type {
  ArtStyle,
  AspectRatio,
  ObjectDescription,
  PromptBackgroundTreatment,
  PromptCompositionPreferences,
  PromptDetailLevel,
  PromptDocument,
  PromptOutputOrientation,
  StructuredArtStyleConfig,
} from '../../types/domain.ts';
import type {
  PromptSynthesisProviderInput,
  PromptSynthesisProviderOutput,
  PromptSynthesisSubjectInput,
} from '../../types/providers.ts';
import type {
  ApprovePromptRequest,
  ComposePromptRequest,
  ManualCreativeDirectionInput,
  NormalizedPromptInputs,
  PromptComposerService,
  PromptInputFieldErrors,
  PromptInputValidationReport,
} from '../../types/services.ts';
import {
  ALLOWED_ASPECT_RATIOS,
  findForbiddenImageInput,
} from '../image-generation/contract.ts';
import {
  createEntityId,
  isValidEntityId,
  nowIsoTimestamp,
} from '../../utils/ids.ts';
import {
  findCredentialLeakKey,
  isNonEmptyString,
  isPlainRecord,
} from '../../utils/validation.ts';

export const PROMPT_SYNTHESIS_ENDPOINT = '/api/prompts/synthesize' as const;

const DEFAULT_PROMPT_SYNTHESIS_TIMEOUT_MS = 50_000;

const ALLOWED_DETAIL_LEVELS: ReadonlySet<PromptDetailLevel> = new Set([
  'minimal',
  'balanced',
  'high',
  'intricate',
]);

const ALLOWED_BACKGROUND_TREATMENTS: ReadonlySet<PromptBackgroundTreatment> =
  new Set([
    'preserve_clean',
    'neutral_studio',
    'editorial_backdrop',
    'minimal_gradient',
    'environmental_match',
  ]);

const PROVIDER_SYNTAX_PATTERNS: readonly {
  readonly regex: RegExp;
  readonly label: string;
}[] = [
  { regex: /(?:^|\s)--ar\b/i, label: '--ar' },
  { regex: /(?:^|\s)--v\b/i, label: '--v' },
  { regex: /(?:^|\s)--style\b/i, label: '--style' },
  { regex: /(?:^|\s)--no\b/i, label: '--no' },
  { regex: /(?:^|\s)--q\b/i, label: '--q' },
  { regex: /(?:^|\s)--niji\b/i, label: '--niji' },
  { regex: /<lora:[^>]+>/i, label: '<lora:...>' },
];

const BASE64_IMAGE_DATA_URI_REGEX = /data:image\/[a-zA-Z0-9.+-]+;base64,/i;

export interface PromptSynthesizeApiResponse {
  readonly ok: boolean;
  readonly data?: PromptSynthesisProviderOutput;
  readonly error?: {
    readonly code: string;
    readonly category?: string;
    readonly message: string;
    readonly retryable?: boolean;
  };
}

export interface StudioPromptComposerOptions {
  readonly endpoint?: string;
  readonly fetchFn?: typeof fetch;
  readonly timeoutMs?: number;
}

export function deriveOutputOrientation(
  aspectRatio: AspectRatio,
): PromptOutputOrientation {
  if (aspectRatio === '1:1') {
    return 'square';
  }
  if (aspectRatio === '3:4' || aspectRatio === '9:16' || aspectRatio === '2:3') {
    return 'portrait';
  }
  return 'landscape';
}

export function createDefaultManualCreativeDirection(): ManualCreativeDirectionInput {
  return {
    styleName: '',
    styleCategory: 'illustration',
    styleDescription: '',
    visualCharacteristics: '',
    renderingRules: '',
    lineworkRules: '',
    colorRules: '',
    textureRules: '',
    shadingRules: '',
    compositionRules: '',
    detailLevel: 'balanced',
    promptTemplate: '',
    negativePromptTemplate: '',
  };
}

export function createDefaultCompositionPreferences(
  aspectRatio: AspectRatio = '1:1',
): PromptCompositionPreferences {
  return {
    aspectRatio,
    compositionDirection: 'Preserve source framing',
    backgroundTreatment: 'preserve_clean',
    detailLevel: 'balanced',
    outputOrientation: deriveOutputOrientation(aspectRatio),
  };
}

function trimString(value: string | undefined | null): string {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanStringArray(items: readonly string[] | undefined): string[] {
  if (!Array.isArray(items)) {
    return [];
  }
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const item of items) {
    if (typeof item !== 'string') {
      continue;
    }
    const trimmed = item.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      cleaned.push(trimmed);
    }
  }
  return cleaned;
}

export function normalizeArtStyleConfiguration(
  artStyle?: ArtStyle | null,
  manual?: ManualCreativeDirectionInput | null,
): ServiceResult<StructuredArtStyleConfig> {
  if (artStyle) {
    const styleName = trimString(artStyle.name);
    const styleDescription =
      trimString(artStyle.summary) ||
      trimString(artStyle.shortDescription) ||
      trimString(artStyle.description);
    const visualCharacteristics =
      trimString(artStyle.visualCharacteristics) ||
      cleanStringArray(artStyle.styleDirectives).join('; ');
    const renderingRules =
      trimString(artStyle.renderingTechnique) ||
      trimString(artStyle.renderingRules) ||
      cleanStringArray(artStyle.mediumKeywords).join(', ');
    const lineworkRules = trimString(artStyle.lineworkRules);
    const colorRules = trimString(artStyle.colorRules);
    const textureRules = trimString(artStyle.textureRules);
    const shadingRules =
      trimString(artStyle.shadingRules) ||
      cleanStringArray(artStyle.lightingKeywords).join(', ');
    const compositionRules = trimString(artStyle.compositionRules);
    const detailLevel: PromptDetailLevel =
      artStyle.detailLevel && ALLOWED_DETAIL_LEVELS.has(artStyle.detailLevel)
        ? artStyle.detailLevel
        : 'balanced';
    const promptTemplate = trimString(artStyle.promptTemplate);
    const negativePromptTemplate =
      trimString(artStyle.negativePromptTemplate) ||
      cleanStringArray(artStyle.defaultNegativeDirectives).join(', ');

    if (!styleName) {
      return errResult(
        'VALIDATION_ERROR',
        'Selected Art Style requires a valid style name.',
      );
    }

    const hasDetail = Boolean(
      styleDescription ||
        visualCharacteristics ||
        renderingRules ||
        lineworkRules ||
        colorRules ||
        textureRules ||
        shadingRules ||
        compositionRules,
    );
    if (!hasDetail) {
      return errResult(
        'VALIDATION_ERROR',
        'Selected Art Style requires a description or at least one visual/rendering rule.',
      );
    }

    return okResult({
      source: 'curated',
      styleId: artStyle.id,
      styleName,
      styleCategory: trimString(artStyle.category) || 'illustration',
      styleDescription,
      visualCharacteristics,
      renderingRules,
      renderingTechnique: renderingRules,
      lineworkRules,
      colorRules,
      textureRules,
      shadingRules,
      compositionRules,
      detailLevel,
      ...(promptTemplate ? { promptTemplate } : {}),
      ...(negativePromptTemplate ? { negativePromptTemplate } : {}),
      isManualCreativeDirection: false,
    });
  }

  if (manual) {
    const styleName = trimString(manual.styleName);
    const styleCategory = trimString(manual.styleCategory) || 'illustration';
    const styleDescription = trimString(manual.styleDescription);
    const visualCharacteristics = trimString(manual.visualCharacteristics);
    const renderingRules = trimString(manual.renderingRules);
    const lineworkRules = trimString(manual.lineworkRules);
    const colorRules = trimString(manual.colorRules);
    const textureRules = trimString(manual.textureRules);
    const shadingRules = trimString(manual.shadingRules);
    const compositionRules = trimString(manual.compositionRules);
    const detailLevel: PromptDetailLevel =
      manual.detailLevel && ALLOWED_DETAIL_LEVELS.has(manual.detailLevel)
        ? manual.detailLevel
        : 'balanced';
    const promptTemplate = trimString(manual.promptTemplate);
    const negativePromptTemplate = trimString(manual.negativePromptTemplate);

    if (!styleName) {
      return errResult(
        'VALIDATION_ERROR',
        'Style Name is required in Creative Direction.',
      );
    }

    const hasDetail = Boolean(
      styleDescription ||
        visualCharacteristics ||
        renderingRules ||
        lineworkRules ||
        colorRules ||
        textureRules ||
        shadingRules ||
        compositionRules,
    );
    if (!hasDetail) {
      return errResult(
        'VALIDATION_ERROR',
        'Provide a Style Description or at least one visual or rendering rule in Creative Direction.',
      );
    }

    return okResult({
      source: 'manual',
      styleId: null,
      styleName,
      styleCategory,
      styleDescription,
      visualCharacteristics,
      renderingRules,
      renderingTechnique: renderingRules,
      lineworkRules,
      colorRules,
      textureRules,
      shadingRules,
      compositionRules,
      detailLevel,
      ...(promptTemplate ? { promptTemplate } : {}),
      ...(negativePromptTemplate ? { negativePromptTemplate } : {}),
      isManualCreativeDirection: true,
    });
  }

  return errResult(
    'VALIDATION_ERROR',
    'Select an Art Style or complete Manual Creative Direction before composing a prompt.',
  );
}

export function extractSupportedNegativeDirectives(
  creativeDirection: StructuredArtStyleConfig,
  creativeInstructions: string,
): string[] {
  const directives: string[] = [];
  const seen = new Set<string>();

  const pushDirective = (raw: string) => {
    const cleaned = raw.trim().replace(/^[•\-*\s]+|[.\s]+$/g, '');
    if (!cleaned) {
      return;
    }
    const key = cleaned.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      directives.push(cleaned);
    }
  };

  if (creativeDirection.negativePromptTemplate) {
    for (const part of creativeDirection.negativePromptTemplate.split(/[,;\n]/)) {
      pushDirective(part);
    }
  }

  const exclusionPattern =
    /\b(?:no|without|avoid|exclude|excluding|omit|do not include|don't include|never include)\s+([^.;!\n]+)/gi;
  let match = exclusionPattern.exec(creativeInstructions);
  while (match !== null) {
    const clause = match[1]?.trim() ?? '';
    for (const piece of clause.split(/\s*(?:,|\/|\band\b|\bor\b)\s*/i)) {
      pushDirective(piece);
    }
    match = exclusionPattern.exec(creativeInstructions);
  }

  return directives;
}

export function detectPotentialInputConflicts(params: {
  readonly description: ObjectDescription;
  readonly creativeDirection: StructuredArtStyleConfig;
  readonly compositionPreferences: PromptCompositionPreferences;
  readonly creativeInstructions: string;
}): string[] {
  const conflicts: string[] = [];
  const styleText = [
    params.creativeDirection.styleName,
    params.creativeDirection.styleCategory,
    params.creativeDirection.styleDescription,
    params.creativeDirection.visualCharacteristics,
    params.creativeDirection.renderingRules,
    params.creativeDirection.lineworkRules,
    params.creativeDirection.colorRules,
    params.creativeDirection.textureRules,
    params.creativeDirection.shadingRules,
  ]
    .join(' ')
    .toLowerCase();

  const userText = params.creativeInstructions.toLowerCase();
  const combinedDirectionAndUser = `${styleText} ${userText}`;

  const requestsPhotoreal =
    /\b(photoreal|photorealistic|hyperrealistic|photograph|camera lens|dslr|raw photo)\b/i.test(
      combinedDirectionAndUser,
    );
  const requestsFlat2dOrPainterly =
    /\b(flat 2d|2d vector|cel[- ]?shaded|cartoon|linocut|woodcut|ink wash|watercolor|line art|sketch|gouache)\b/i.test(
      combinedDirectionAndUser,
    );

  if (requestsPhotoreal && requestsFlat2dOrPainterly) {
    conflicts.push(
      'Photorealistic rendering cues conflict with 2D illustration, vector, or painterly style rules.',
    );
  }

  const requestsMonochrome =
    /\b(monochrome|black and white|greyscale|grayscale|sepia|single[- ]color)\b/i.test(
      combinedDirectionAndUser,
    );
  const requestsVibrantMultiColor =
    /\b(vibrant neon|multicolor|rainbow|vivid full[- ]color|saturated spectrum|prismatic colors)\b/i.test(
      combinedDirectionAndUser,
    );

  if (requestsMonochrome && requestsVibrantMultiColor) {
    conflicts.push(
      'Monochrome palette cues conflict with vibrant or multi-color directives.',
    );
  }

  const cleanBackdrop =
    params.compositionPreferences.backgroundTreatment === 'preserve_clean' ||
    params.compositionPreferences.backgroundTreatment === 'neutral_studio' ||
    /\b(isolated|clean background|plain backdrop|studio white|minimal backdrop)\b/i.test(
      combinedDirectionAndUser,
    );
  const busyEnvironment =
    /\b(busy street|crowded|cluttered|dense forest|complex interior|full cityscape|bustling scene)\b/i.test(
      userText,
    );

  if (cleanBackdrop && busyEnvironment) {
    conflicts.push(
      'Clean/isolated background preference conflicts with user instructions describing a busy or cluttered environment.',
    );
  }

  const wantsPortraitOrientation =
    params.compositionPreferences.outputOrientation === 'portrait';
  const wantsLandscapeOrientation =
    params.compositionPreferences.outputOrientation === 'landscape';
  if (
    wantsPortraitOrientation &&
    /\b(wide landscape|widescreen|panoramic|horizontal banner|16:9)\b/i.test(
      userText,
    )
  ) {
    conflicts.push(
      `Selected portrait aspect ratio (${params.compositionPreferences.aspectRatio}) conflicts with wide landscape framing in user instructions.`,
    );
  }
  if (
    wantsLandscapeOrientation &&
    /\b(vertical poster|tall portrait framing|9:16)\b/i.test(userText)
  ) {
    conflicts.push(
      `Selected landscape aspect ratio (${params.compositionPreferences.aspectRatio}) conflicts with vertical portrait framing in user instructions.`,
    );
  }

  if (params.creativeDirection.negativePromptTemplate && userText.length > 0) {
    const excludedTerms = params.creativeDirection.negativePromptTemplate
      .split(/[,;\n]/)
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item.length >= 4);

    for (const term of excludedTerms) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const positiveMention = new RegExp(`\\b${escaped}\\b`, 'i').exec(userText);
      if (positiveMention) {
        const preceding = userText.slice(
          Math.max(0, positiveMention.index - 24),
          positiveMention.index,
        );
        if (!/\b(?:no|without|avoid|exclude|not)\s*$/i.test(preceding)) {
          conflicts.push(
            `User instruction mentions "${term}", which is excluded by Creative Direction negative directives.`,
          );
        }
      }
    }
  }

  return conflicts;
}

function inspectComposeRequestSecurityBoundaries(
  request: ComposePromptRequest,
): ServiceResult<void> {
  if (!isPlainRecord(request)) {
    return errResult(
      'VALIDATION_ERROR',
      'Prompt synthesis request must be a structured object.',
    );
  }

  const credKey = findCredentialLeakKey(request, 'composePromptRequest');
  if (credKey !== null) {
    return errResult(
      'SECURITY_BOUNDARY_VIOLATION',
      `Credential-like field "${credKey}" is prohibited in prompt composer requests.`,
      { field: credKey },
    );
  }

  // Inspect top-level request keys excluding description.sourceAssetId (internal FK only)
  // while checking for any binary/Blob/base64 image payloads or forbidden image keys.
  const sanitizedForBoundaryCheck: Record<string, unknown> = { ...request };
  if (isPlainRecord(request.description)) {
    const { sourceAssetId: _omittedAssetFk, ...restDescription } =
      request.description;
    sanitizedForBoundaryCheck.description = restDescription;
  }

  const forbiddenHit = findForbiddenImageInput(
    sanitizedForBoundaryCheck,
    'composePromptRequest',
  );
  if (forbiddenHit !== null) {
    return errResult(
      'SECURITY_BOUNDARY_VIOLATION',
      `${forbiddenHit.reason} Prompt Composer operates strictly on text descriptions and style rules.`,
      { path: forbiddenHit.path },
    );
  }

  return okResult(undefined);
}

function buildSubjectInputFromDescription(
  description: ObjectDescription,
): PromptSynthesisSubjectInput {
  return {
    descriptionId: description.id,
    sourceDescriptionRevision: description.version,
    objectName: trimString(description.objectName),
    objectCategory: trimString(description.objectCategory),
    primaryDescription: trimString(description.primaryDescription),
    shapeAndSilhouette: trimString(description.shapeAndSilhouette),
    materials: cleanStringArray(description.materials),
    dominantColors: cleanStringArray(description.dominantColors),
    surfaceDetails: trimString(description.surfaceDetails),
    distinctiveFeatures: cleanStringArray(description.distinctiveFeatures),
    composition: trimString(description.composition),
    viewingAngle: trimString(description.viewingAngle),
    preservationPriorities: cleanStringArray(description.preservationPriorities),
    uncertainAttributes: cleanStringArray(description.uncertainAttributes),
    userNotes: trimString(description.userNotes),
  };
}

function isDirectiveSupported(
  candidateClause: string,
  supportedDirectives: readonly string[],
): boolean {
  const normalizedClause = candidateClause.trim().toLowerCase();
  if (!normalizedClause) {
    return false;
  }
  for (const supported of supportedDirectives) {
    const normalizedSupported = supported.trim().toLowerCase();
    if (!normalizedSupported) {
      continue;
    }
    if (
      normalizedClause.includes(normalizedSupported) ||
      normalizedSupported.includes(normalizedClause)
    ) {
      return true;
    }
    const supportedWords = normalizedSupported
      .split(/\s+/)
      .filter((w) => w.length >= 4);
    if (
      supportedWords.length > 0 &&
      supportedWords.some((w) => normalizedClause.includes(w))
    ) {
      return true;
    }
  }
  return false;
}

export function markPromptEdited(
  document: PromptDocument,
  updates: {
    readonly finalPrompt?: string;
    readonly negativePrompt?: string;
  },
): ServiceResult<PromptDocument> {
  if (document.approvalStatus === 'approved') {
    return errResult(
      'CONFLICT',
      'Approved Master Prompt is locked against accidental edits. Unlock and create a new revision to modify it.',
    );
  }

  const nextFinalPrompt =
    updates.finalPrompt !== undefined ? updates.finalPrompt : document.finalPrompt;
  const nextNegativePrompt =
    updates.negativePrompt !== undefined
      ? updates.negativePrompt
      : document.negativePrompt;

  if (BASE64_IMAGE_DATA_URI_REGEX.test(nextFinalPrompt)) {
    return errResult(
      'SECURITY_BOUNDARY_VIOLATION',
      'Final Master Prompt cannot contain embedded base64 image data.',
    );
  }

  const edited =
    nextFinalPrompt.trim() !== document.generatedPrompt.trim() ||
    nextNegativePrompt.trim() !== document.negativePrompt.trim();

  return okResult({
    ...document,
    finalPrompt: nextFinalPrompt,
    negativePrompt: nextNegativePrompt,
    approvalStatus: edited ? 'edited' : document.approvalStatus,
    approvedAt: null,
    updatedAt: nowIsoTimestamp(),
  });
}

export function unlockApprovedPromptForNewRevision(
  approvedDocument: PromptDocument,
  highestExistingRevision: number,
): ServiceResult<PromptDocument> {
  const baseRevision = Math.max(
    approvedDocument.revisionNumber ?? approvedDocument.revision,
    highestExistingRevision,
  );
  const nextRevision = baseRevision + 1;
  const nextId = createEntityId('prm');
  const now = nowIsoTimestamp();

  return okResult({
    ...approvedDocument,
    id: nextId,
    promptId: nextId,
    approvalStatus: 'edited',
    approvedAt: null,
    revision: nextRevision,
    revisionNumber: nextRevision,
    createdAt: now,
    updatedAt: now,
  });
}

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return true;
  }
  return error instanceof Error && error.name === 'AbortError';
}

export class StudioPromptComposerService implements PromptComposerService {
  private readonly endpoint: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: StudioPromptComposerOptions = {}) {
    this.endpoint = options.endpoint ?? PROMPT_SYNTHESIS_ENDPOINT;
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_PROMPT_SYNTHESIS_TIMEOUT_MS;
  }

  validatePromptInputs(
    request: ComposePromptRequest,
  ): ServiceResult<PromptInputValidationReport> {
    const boundaryCheck = inspectComposeRequestSecurityBoundaries(request);
    if (!boundaryCheck.ok) {
      return boundaryCheck;
    }

    const fieldErrors: {
      description?: string;
      creativeDirection?: string;
      styleName?: string;
      styleDescription?: string;
      compositionPreferences?: string;
    } = {};
    const missingRequirements: string[] = [];

    if (!isValidEntityId(request.projectId)) {
      missingRequirements.push('An active study projectId is required.');
    }

    const desc = request.description;
    if (!desc) {
      fieldErrors.description =
        'Complete and save the Editable Object Description before composing a prompt.';
      missingRequirements.push(fieldErrors.description);
    } else {
      if (!isValidEntityId(desc.id) || desc.projectId !== request.projectId) {
        fieldErrors.description =
          'Object Description must be saved for the active study before composing a prompt.';
        missingRequirements.push(fieldErrors.description);
      } else if (
        !isNonEmptyString(desc.objectName) ||
        !isNonEmptyString(desc.objectCategory) ||
        !isNonEmptyString(desc.primaryDescription)
      ) {
        fieldErrors.description =
          'Saved Object Description must include non-empty Object Name, Object Category, and Primary Description.';
        missingRequirements.push(fieldErrors.description);
      }
    }

    const directionResult = normalizeArtStyleConfiguration(
      request.artStyle,
      request.manualCreativeDirection,
    );
    if (!directionResult.ok) {
      if (!request.artStyle && request.manualCreativeDirection) {
        if (!trimString(request.manualCreativeDirection.styleName)) {
          fieldErrors.styleName = 'Style Name is required in Creative Direction.';
          missingRequirements.push(fieldErrors.styleName);
        } else {
          fieldErrors.styleDescription = directionResult.error.message;
          missingRequirements.push(directionResult.error.message);
        }
      } else {
        fieldErrors.creativeDirection = directionResult.error.message;
        missingRequirements.push(directionResult.error.message);
      }
    }

    const aspectRatio = request.compositionPreferences?.aspectRatio ?? '1:1';
    if (!(ALLOWED_ASPECT_RATIOS as readonly string[]).includes(aspectRatio)) {
      fieldErrors.compositionPreferences = `Aspect Ratio must be one of: ${ALLOWED_ASPECT_RATIOS.join(', ')}.`;
      missingRequirements.push(fieldErrors.compositionPreferences);
    }

    const compositionDirection =
      trimString(request.compositionPreferences?.compositionDirection) ||
      'Preserve source framing';
    const backgroundTreatment: PromptBackgroundTreatment =
      request.compositionPreferences?.backgroundTreatment &&
      ALLOWED_BACKGROUND_TREATMENTS.has(
        request.compositionPreferences.backgroundTreatment,
      )
        ? request.compositionPreferences.backgroundTreatment
        : 'preserve_clean';
    const detailLevel: PromptDetailLevel =
      request.compositionPreferences?.detailLevel &&
      ALLOWED_DETAIL_LEVELS.has(request.compositionPreferences.detailLevel)
        ? request.compositionPreferences.detailLevel
        : directionResult.ok
          ? directionResult.data.detailLevel
          : 'balanced';
    const outputOrientation: PromptOutputOrientation =
      request.compositionPreferences?.outputOrientation ??
      deriveOutputOrientation(aspectRatio);

    const normalizedPrefs: PromptCompositionPreferences = {
      aspectRatio,
      compositionDirection,
      backgroundTreatment,
      detailLevel,
      outputOrientation,
    };

    const potentialConflicts =
      desc && directionResult.ok
        ? detectPotentialInputConflicts({
            description: desc,
            creativeDirection: directionResult.data,
            compositionPreferences: normalizedPrefs,
            creativeInstructions: trimString(request.userInstructions),
          })
        : [];

    return okResult({
      valid: missingRequirements.length === 0,
      fieldErrors,
      missingRequirements,
      potentialConflicts,
    });
  }

  normalizePromptInputs(
    request: ComposePromptRequest,
  ): ServiceResult<NormalizedPromptInputs> {
    const validation = this.validatePromptInputs(request);
    if (!validation.ok) {
      return validation;
    }

    if (!validation.data.valid || !request.description) {
      return errResult(
        'VALIDATION_ERROR',
        validation.data.missingRequirements[0] ??
          'Prompt inputs are incomplete or invalid.',
      );
    }

    const directionResult = normalizeArtStyleConfiguration(
      request.artStyle,
      request.manualCreativeDirection,
    );
    if (!directionResult.ok) {
      return directionResult;
    }

    const aspectRatio = request.compositionPreferences?.aspectRatio ?? '1:1';
    const compositionPreferences: PromptCompositionPreferences = {
      aspectRatio,
      compositionDirection:
        trimString(request.compositionPreferences?.compositionDirection) ||
        'Preserve source framing',
      backgroundTreatment:
        request.compositionPreferences?.backgroundTreatment &&
        ALLOWED_BACKGROUND_TREATMENTS.has(
          request.compositionPreferences.backgroundTreatment,
        )
          ? request.compositionPreferences.backgroundTreatment
          : 'preserve_clean',
      detailLevel:
        request.compositionPreferences?.detailLevel &&
        ALLOWED_DETAIL_LEVELS.has(request.compositionPreferences.detailLevel)
          ? request.compositionPreferences.detailLevel
          : directionResult.data.detailLevel,
      outputOrientation:
        request.compositionPreferences?.outputOrientation ??
        deriveOutputOrientation(aspectRatio),
    };

    const creativeInstructions = trimString(request.userInstructions);
    const subject = buildSubjectInputFromDescription(request.description);
    const negativeDirectivesFromInputs = extractSupportedNegativeDirectives(
      directionResult.data,
      creativeInstructions,
    );

    const previousRevision =
      typeof request.previousRevision === 'number' &&
      Number.isInteger(request.previousRevision) &&
      request.previousRevision >= 0
        ? request.previousRevision
        : 0;

    const normalized: NormalizedPromptInputs = {
      projectId: request.projectId,
      descriptionId: request.description.id,
      sourceDescriptionRevision: request.description.version,
      subject,
      creativeDirection: directionResult.data,
      creativeInstructions,
      compositionPreferences,
      negativeDirectivesFromInputs,
      potentialConflicts: validation.data.potentialConflicts,
      previousRevision,
    };

    // Double check serialized text-only boundary guarantees before leaving client service
    const boundaryCheck = findForbiddenImageInput(normalized, 'normalizedPromptInputs');
    if (boundaryCheck !== null) {
      return errResult(
        'SECURITY_BOUNDARY_VIOLATION',
        boundaryCheck.reason,
        { path: boundaryCheck.path },
      );
    }

    return okResult(normalized);
  }

  validateGeneratedPrompt(
    synthesis: PromptSynthesisProviderOutput,
    normalized: NormalizedPromptInputs,
  ): ServiceResult<PromptSynthesisProviderOutput> {
    if (!isPlainRecord(synthesis)) {
      return errResult(
        'PROVIDER_ERROR',
        'Prompt synthesis provider returned an invalid payload.',
      );
    }

    const credentialLeak = findCredentialLeakKey(synthesis, 'synthesisOutput');
    if (credentialLeak !== null) {
      return errResult(
        'SECURITY_BOUNDARY_VIOLATION',
        `Unexpected credential-like field "${credentialLeak}" in prompt synthesis output.`,
        { field: credentialLeak },
      );
    }

    const generatedPrompt = trimString(synthesis.generatedPrompt);
    if (!generatedPrompt) {
      return errResult(
        'PROVIDER_ERROR',
        'Gemini returned an empty Master Prompt. Review your inputs and try composing again.',
      );
    }

    if (BASE64_IMAGE_DATA_URI_REGEX.test(generatedPrompt)) {
      return errResult(
        'SECURITY_BOUNDARY_VIOLATION',
        'Generated Master Prompt must not contain base64 image data.',
      );
    }

    for (const pattern of PROVIDER_SYNTAX_PATTERNS) {
      if (pattern.regex.test(generatedPrompt)) {
        return errResult(
          'VALIDATION_ERROR',
          `Generated prompt contained provider-specific syntax (${pattern.label}). Regenerate for a clean natural-language prompt.`,
        );
      }
    }

    const rawNegative = trimString(synthesis.negativePrompt);
    let groundedNegative = '';
    if (rawNegative.length > 0 && normalized.negativeDirectivesFromInputs.length > 0) {
      const supportedClauses = rawNegative
        .split(/[,;\n]/)
        .map((clause) => clause.trim())
        .filter((clause) => clause.length > 0)
        .filter((clause) =>
          isDirectiveSupported(clause, normalized.negativeDirectivesFromInputs),
        );
      groundedNegative =
        supportedClauses.length > 0
          ? supportedClauses.join(', ')
          : normalized.negativeDirectivesFromInputs.join(', ');
    }

    const unresolvedConflicts = cleanStringArray(synthesis.unresolvedConflicts);

    return okResult({
      ...synthesis,
      generatedPrompt,
      negativePrompt: groundedNegative,
      unresolvedConflicts,
    });
  }

  async synthesizeMasterPrompt(
    request: ComposePromptRequest,
  ): Promise<ServiceResult<PromptDocument>> {
    const normalizedResult = this.normalizePromptInputs(request);
    if (!normalizedResult.ok) {
      return normalizedResult;
    }

    const normalized = normalizedResult.data;

    if (request.abortSignal?.aborted) {
      return errResult('UNSUPPORTED_OPERATION', 'Prompt synthesis was cancelled.', {
        cancelled: true,
      });
    }

    const wirePayload: PromptSynthesisProviderInput = {
      projectId: normalized.projectId,
      subject: normalized.subject,
      creativeDirection: normalized.creativeDirection,
      creativeInstructions: normalized.creativeInstructions,
      compositionPreferences: normalized.compositionPreferences,
      detectedInputConflicts: normalized.potentialConflicts,
    };

    const controller = new AbortController();
    const onExternalAbort = () => controller.abort();
    if (request.abortSignal) {
      request.abortSignal.addEventListener('abort', onExternalAbort, { once: true });
    }

    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchFn(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(wirePayload),
        signal: controller.signal,
      });

      let body: PromptSynthesizeApiResponse;
      try {
        body = (await response.json()) as PromptSynthesizeApiResponse;
      } catch {
        return errResult(
          'PROVIDER_ERROR',
          `Prompt synthesis service returned an unreadable response (HTTP ${response.status}).`,
        );
      }

      if (!response.ok || !body.ok || !body.data) {
        const message =
          body.error?.message ??
          `Prompt synthesis failed with status ${response.status}.`;
        const code =
          response.status === 403
            ? 'SECURITY_BOUNDARY_VIOLATION'
            : response.status === 400
              ? 'VALIDATION_ERROR'
              : response.status === 503 ||
                  response.status === 504 ||
                  response.status === 429
                ? 'PROVIDER_UNAVAILABLE'
                : 'PROVIDER_ERROR';

        return errResult(code, message, {
          retryable: body.error?.retryable ?? response.status >= 500,
          ...(body.error?.category ? { category: body.error.category } : {}),
        });
      }

      const validatedOutput = this.validateGeneratedPrompt(body.data, normalized);
      if (!validatedOutput.ok) {
        return validatedOutput;
      }

      const now = nowIsoTimestamp();
      const promptEntityId: EntityId = createEntityId('prm');
      const nextRevision = normalized.previousRevision + 1;

      const mergedConflicts = cleanStringArray([
        ...validatedOutput.data.unresolvedConflicts,
      ]);

      const promptDocument: PromptDocument = {
        id: promptEntityId,
        promptId: promptEntityId,
        projectId: normalized.projectId,
        descriptionId: normalized.descriptionId,
        sourceDescriptionRevision: normalized.sourceDescriptionRevision,
        styleId: normalized.creativeDirection.styleId,
        selectedStyleId: normalized.creativeDirection.styleId,
        creativeDirection: normalized.creativeDirection,
        userInstructions: normalized.creativeInstructions,
        creativeInstructions: normalized.creativeInstructions,
        compositionPreferences: normalized.compositionPreferences,
        unresolvedConflicts: mergedConflicts,
        generatedPrompt: validatedOutput.data.generatedPrompt,
        finalPrompt: validatedOutput.data.generatedPrompt,
        negativePrompt: validatedOutput.data.negativePrompt,
        approvalStatus: 'generated',
        generatedAt: validatedOutput.data.generatedAt || now,
        approvedAt: null,
        revision: nextRevision,
        revisionNumber: nextRevision,
        providerId: validatedOutput.data.providerId,
        modelId: validatedOutput.data.modelId,
        ...(validatedOutput.data.modelVersion
          ? { modelVersion: validatedOutput.data.modelVersion }
          : {}),
        ...(validatedOutput.data.responseId
          ? { responseId: validatedOutput.data.responseId }
          : {}),
        createdAt: now,
        updatedAt: now,
      };

      return okResult(promptDocument);
    } catch (error: unknown) {
      if (request.abortSignal?.aborted) {
        return errResult(
          'UNSUPPORTED_OPERATION',
          'Prompt synthesis was cancelled.',
          { cancelled: true },
        );
      }

      if (isAbortError(error)) {
        return errResult(
          'PROVIDER_UNAVAILABLE',
          'Prompt synthesis request timed out waiting for the Gemini server response.',
          { retryable: true },
        );
      }

      return errResult(
        'PROVIDER_UNAVAILABLE',
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : 'Unable to reach FormFusion Prompt Composer service.',
        { retryable: true },
      );
    } finally {
      clearTimeout(timer);
      if (request.abortSignal) {
        request.abortSignal.removeEventListener('abort', onExternalAbort);
      }
    }
  }

  savePromptDocument(
    document: PromptDocument,
    previousDocument?: PromptDocument | null,
  ): ServiceResult<PromptDocument> {
    if (!isValidEntityId(document.id) || !isValidEntityId(document.projectId)) {
      return errResult(
        'VALIDATION_ERROR',
        'PromptDocument requires valid id and projectId.',
      );
    }
    if (!isValidEntityId(document.descriptionId)) {
      return errResult(
        'VALIDATION_ERROR',
        'PromptDocument must reference a valid saved ObjectDescription.',
      );
    }
    if (!isNonEmptyString(document.generatedPrompt)) {
      return errResult(
        'VALIDATION_ERROR',
        'PromptDocument generatedPrompt baseline cannot be empty.',
      );
    }
    if (!isNonEmptyString(document.finalPrompt)) {
      return errResult(
        'VALIDATION_ERROR',
        'Final Master Prompt cannot be empty when saving.',
      );
    }
    if (
      BASE64_IMAGE_DATA_URI_REGEX.test(document.generatedPrompt) ||
      BASE64_IMAGE_DATA_URI_REGEX.test(document.finalPrompt) ||
      BASE64_IMAGE_DATA_URI_REGEX.test(document.negativePrompt)
    ) {
      return errResult(
        'SECURITY_BOUNDARY_VIOLATION',
        'PromptDocument must never contain base64 image payloads.',
      );
    }

    if (previousDocument && previousDocument.id === document.id) {
      if (previousDocument.generatedPrompt !== document.generatedPrompt) {
        return errResult(
          'CONFLICT',
          'The original AI-generated baseline prompt (generatedPrompt) is immutable and cannot be altered.',
        );
      }
      if (previousDocument.approvalStatus === 'approved') {
        return errResult(
          'CONFLICT',
          'Approved prompt revisions cannot be overwritten directly. Unlock to create a new revision.',
        );
      }
    }

    const editedFromBaseline =
      document.finalPrompt.trim() !== document.generatedPrompt.trim() ||
      (previousDocument !== null &&
        previousDocument !== undefined &&
        previousDocument.id === document.id &&
        previousDocument.negativePrompt.trim() !== document.negativePrompt.trim());

    const nextStatus =
      document.approvalStatus === 'approved'
        ? 'approved'
        : editedFromBaseline
          ? 'edited'
          : document.approvalStatus === 'draft'
            ? 'generated'
            : document.approvalStatus;

    const revisionValue = Math.max(
      1,
      document.revisionNumber ?? document.revision ?? 1,
    );

    return okResult({
      ...document,
      promptId: document.promptId ?? document.id,
      finalPrompt: document.finalPrompt.trim(),
      negativePrompt: document.negativePrompt.trim(),
      approvalStatus: nextStatus,
      approvedAt: nextStatus === 'approved' ? document.approvedAt : null,
      revision: revisionValue,
      revisionNumber: revisionValue,
      updatedAt: nowIsoTimestamp(),
    });
  }

  approveFinalPrompt(
    request: ApprovePromptRequest,
  ): ServiceResult<PromptDocument> {
    const doc = request.promptDocument;
    if (!isValidEntityId(doc.id) || !isValidEntityId(doc.projectId)) {
      return errResult(
        'VALIDATION_ERROR',
        'A valid PromptDocument is required before approval.',
      );
    }
    if (!isNonEmptyString(doc.generatedPrompt)) {
      return errResult(
        'VALIDATION_ERROR',
        'Original AI-generated prompt baseline is missing.',
      );
    }

    const finalPrompt = trimString(request.finalPrompt);
    const negativePrompt = trimString(request.negativePrompt);

    if (!finalPrompt) {
      return errResult(
        'VALIDATION_ERROR',
        'Final Master Prompt cannot be empty before approving.',
      );
    }

    if (
      BASE64_IMAGE_DATA_URI_REGEX.test(finalPrompt) ||
      BASE64_IMAGE_DATA_URI_REGEX.test(negativePrompt)
    ) {
      return errResult(
        'SECURITY_BOUNDARY_VIOLATION',
        'Approved prompt text cannot contain base64 image data.',
      );
    }

    const now = nowIsoTimestamp();
    const revisionValue = Math.max(1, doc.revisionNumber ?? doc.revision ?? 1);

    return okResult({
      ...doc,
      promptId: doc.promptId ?? doc.id,
      finalPrompt,
      negativePrompt,
      approvalStatus: 'approved',
      approvedAt: now,
      revision: revisionValue,
      revisionNumber: revisionValue,
      updatedAt: now,
    });
  }

  async regeneratePrompt(
    request: ComposePromptRequest,
  ): Promise<ServiceResult<PromptDocument>> {
    const currentHighest =
      typeof request.previousRevision === 'number' &&
      Number.isInteger(request.previousRevision) &&
      request.previousRevision >= 1
        ? request.previousRevision
        : 1;

    return this.synthesizeMasterPrompt({
      ...request,
      previousRevision: currentHighest,
    });
  }

  async composePrompt(
    request: ComposePromptRequest,
  ): Promise<ServiceResult<PromptDocument>> {
    return this.synthesizeMasterPrompt(request);
  }

  approvePrompt(
    request: ApprovePromptRequest,
  ): ServiceResult<PromptDocument> {
    return this.approveFinalPrompt(request);
  }
}

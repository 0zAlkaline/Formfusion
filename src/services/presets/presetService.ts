import { errResult, okResult } from '../../types/common.ts';
import type { EntityId, ServiceResult } from '../../types/common.ts';
import type {
  ArtStyle,
  AspectRatio,
  CreativeDirectionMode,
  PersonalPreset,
  PersonalPresetSnapshot,
  Project,
  ProjectCreativeConfiguration,
  PromptBackgroundTreatment,
  PromptCompositionPreferences,
  PromptDetailLevel,
  PromptOutputOrientation,
} from '../../types/domain.ts';
import type {
  ManualCreativeDirectionInput,
  PresetEngineService,
  SavePersonalPresetInput,
} from '../../types/services.ts';
import type { IndexedDbStorageGateway } from '../../types/storage.ts';
import {
  createEntityId,
  isValidEntityId,
  isValidIsoTimestamp,
  nowIsoTimestamp,
} from '../../utils/ids.ts';
import {
  findCredentialLeakKey,
  isNonEmptyString,
  isPlainRecord,
} from '../../utils/validation.ts';
import { ALLOWED_ASPECT_RATIOS, findForbiddenImageInput } from '../image-generation/contract.ts';
import { deriveOutputOrientation } from '../prompt-composer/promptComposerService.ts';
import { readStoredActiveProjectId, writeStoredActiveProjectId } from '../project-storage/browserProjectStorage.ts';

const ALLOWED_DETAIL_LEVELS: ReadonlySet<PromptDetailLevel> = new Set([
  'minimal',
  'balanced',
  'high',
  'intricate',
]);

const ALLOWED_BACKGROUND_TREATMENTS: ReadonlySet<PromptBackgroundTreatment> = new Set([
  'preserve_clean',
  'neutral_studio',
  'editorial_backdrop',
  'minimal_gradient',
  'environmental_match',
]);

const ALLOWED_ORIENTATIONS: ReadonlySet<PromptOutputOrientation> = new Set([
  'square',
  'portrait',
  'landscape',
]);

function trim(value: string | undefined | null): string {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanTags(tags: readonly string[] | undefined): string[] {
  if (!Array.isArray(tags)) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of tags) {
    if (typeof tag !== 'string') {
      continue;
    }
    const cleaned = tag.trim();
    if (!cleaned) {
      continue;
    }
    const key = cleaned.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(cleaned);
    }
  }
  return result;
}

export function buildPresetSnapshotFromArtStyle(style: ArtStyle): PersonalPresetSnapshot {
  const renderingTechnique =
    trim(style.renderingTechnique) ||
    trim(style.renderingRules) ||
    style.mediumKeywords.join(', ');
  const styleDescription =
    trim(style.shortDescription) ||
    trim(style.description) ||
    trim(style.summary);
  const visualCharacteristics =
    trim(style.visualCharacteristics) ||
    style.styleDirectives.join('; ');
  const shadingRules =
    trim(style.shadingRules) ||
    style.lightingKeywords.join(', ');
  const negativePromptTemplate =
    trim(style.negativePromptTemplate) ||
    style.defaultNegativeDirectives.join(', ');

  return {
    source: 'curated',
    styleId: style.id,
    styleName: style.name,
    styleCategory: style.category,
    styleDescription,
    visualCharacteristics,
    renderingTechnique,
    lineworkRules: trim(style.lineworkRules),
    colorRules: trim(style.colorRules),
    textureRules: trim(style.textureRules),
    shadingRules,
    compositionRules: trim(style.compositionRules),
    detailLevel:
      style.detailLevel && ALLOWED_DETAIL_LEVELS.has(style.detailLevel)
        ? style.detailLevel
        : 'balanced',
    ...(trim(style.promptTemplate) ? { promptTemplate: trim(style.promptTemplate) } : {}),
    ...(negativePromptTemplate ? { negativePromptTemplate } : {}),
  };
}

export function buildPresetSnapshotFromManual(
  manual: ManualCreativeDirectionInput,
): PersonalPresetSnapshot {
  return {
    source: 'manual',
    styleId: null,
    styleName: trim(manual.styleName),
    styleCategory: trim(manual.styleCategory) || 'illustration',
    styleDescription: trim(manual.styleDescription),
    visualCharacteristics: trim(manual.visualCharacteristics),
    renderingTechnique: trim(manual.renderingRules),
    lineworkRules: trim(manual.lineworkRules),
    colorRules: trim(manual.colorRules),
    textureRules: trim(manual.textureRules),
    shadingRules: trim(manual.shadingRules),
    compositionRules: trim(manual.compositionRules),
    detailLevel:
      manual.detailLevel && ALLOWED_DETAIL_LEVELS.has(manual.detailLevel)
        ? manual.detailLevel
        : 'balanced',
    ...(trim(manual.promptTemplate)
      ? { promptTemplate: trim(manual.promptTemplate) }
      : {}),
    ...(trim(manual.negativePromptTemplate)
      ? { negativePromptTemplate: trim(manual.negativePromptTemplate) }
      : {}),
  };
}

export function manualInputFromSnapshot(
  snapshot: PersonalPresetSnapshot,
): ManualCreativeDirectionInput {
  return {
    styleName: snapshot.styleName,
    styleCategory: snapshot.styleCategory,
    styleDescription: snapshot.styleDescription,
    visualCharacteristics: snapshot.visualCharacteristics,
    renderingRules: snapshot.renderingTechnique,
    lineworkRules: snapshot.lineworkRules,
    colorRules: snapshot.colorRules,
    textureRules: snapshot.textureRules,
    shadingRules: snapshot.shadingRules,
    compositionRules: snapshot.compositionRules,
    detailLevel: snapshot.detailLevel,
    promptTemplate: snapshot.promptTemplate ?? '',
    negativePromptTemplate: snapshot.negativePromptTemplate ?? '',
  };
}

export function artStyleFromSnapshot(
  snapshot: PersonalPresetSnapshot,
): ArtStyle {
  const timestamp = nowIsoTimestamp();
  const styleId = snapshot.styleId ?? createEntityId('sty');
  return {
    id: styleId,
    slug: snapshot.styleName.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'snapshot-style',
    name: snapshot.styleName,
    category: (snapshot.styleCategory || 'illustration') as ArtStyle['category'],
    summary: snapshot.styleDescription || snapshot.visualCharacteristics || snapshot.styleName,
    shortDescription: snapshot.styleDescription,
    description: snapshot.styleDescription,
    styleDirectives: snapshot.visualCharacteristics
      ? [snapshot.visualCharacteristics]
      : [snapshot.styleName],
    mediumKeywords: snapshot.renderingTechnique ? [snapshot.renderingTechnique] : [],
    lightingKeywords: snapshot.shadingRules ? [snapshot.shadingRules] : [],
    defaultNegativeDirectives: snapshot.negativePromptTemplate
      ? snapshot.negativePromptTemplate
          .split(/[,;\n]/)
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
    recommendedAspectRatios: ['1:1', '4:3', '3:4'],
    visualCharacteristics: snapshot.visualCharacteristics,
    renderingTechnique: snapshot.renderingTechnique,
    renderingRules: snapshot.renderingTechnique,
    lineworkRules: snapshot.lineworkRules,
    colorRules: snapshot.colorRules,
    textureRules: snapshot.textureRules,
    shadingRules: snapshot.shadingRules,
    compositionRules: snapshot.compositionRules,
    detailLevel: snapshot.detailLevel,
    ...(snapshot.promptTemplate ? { promptTemplate: snapshot.promptTemplate } : {}),
    ...(snapshot.negativePromptTemplate
      ? { negativePromptTemplate: snapshot.negativePromptTemplate }
      : {}),
    isCurated: snapshot.source === 'curated',
    isActive: true,
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function isPersonalPresetRecord(value: unknown): value is PersonalPreset {
  return (
    isPlainRecord(value) &&
    isValidEntityId(value.id) &&
    isNonEmptyString(value.name) &&
    isPlainRecord(value.creativeDirectionSnapshot) &&
    isNonEmptyString(value.creativeDirectionSnapshot.styleName)
  );
}

export function validateSavePersonalPresetInput(
  input: SavePersonalPresetInput,
): ServiceResult<SavePersonalPresetInput> {
  if (!isPlainRecord(input)) {
    return errResult('VALIDATION_ERROR', 'Preset input must be a structured object.');
  }

  const credKey = findCredentialLeakKey(input, 'presetInput');
  if (credKey !== null) {
    return errResult(
      'SECURITY_BOUNDARY_VIOLATION',
      `Credential-like field "${credKey}" is prohibited in preset records.`,
      { field: credKey },
    );
  }

  const imageHit = findForbiddenImageInput(input, 'presetInput');
  if (imageHit !== null) {
    return errResult(
      'SECURITY_BOUNDARY_VIOLATION',
      `${imageHit.reason} Presets store only creative direction, output preferences, and text instructions.`,
      { path: imageHit.path },
    );
  }

  const name = trim(input.name);
  if (!name) {
    return errResult('VALIDATION_ERROR', 'Preset name is required.');
  }

  const mode: CreativeDirectionMode =
    input.creativeDirectionMode === 'curated' ? 'curated' : 'manual';

  const snap = input.creativeDirectionSnapshot;
  if (!isPlainRecord(snap) || !trim(snap.styleName)) {
    return errResult(
      'VALIDATION_ERROR',
      'Preset requires a Creative Direction style name.',
    );
  }

  const hasDetail = Boolean(
    trim(snap.styleDescription) ||
      trim(snap.visualCharacteristics) ||
      trim(snap.renderingTechnique) ||
      trim(snap.lineworkRules) ||
      trim(snap.colorRules) ||
      trim(snap.textureRules) ||
      trim(snap.shadingRules) ||
      trim(snap.compositionRules),
  );
  if (!hasDetail) {
    return errResult(
      'VALIDATION_ERROR',
      'Preset Creative Direction requires a description or at least one visual or rendering rule.',
    );
  }

  const aspectRatio: AspectRatio = (
    ALLOWED_ASPECT_RATIOS as readonly string[]
  ).includes(input.aspectRatio)
    ? input.aspectRatio
    : '1:1';

  const outputOrientation: PromptOutputOrientation = ALLOWED_ORIENTATIONS.has(
    input.outputOrientation,
  )
    ? input.outputOrientation
    : deriveOutputOrientation(aspectRatio);

  const backgroundTreatment: PromptBackgroundTreatment =
    ALLOWED_BACKGROUND_TREATMENTS.has(input.backgroundTreatment)
      ? input.backgroundTreatment
      : 'preserve_clean';

  const detailLevel: PromptDetailLevel = ALLOWED_DETAIL_LEVELS.has(
    input.detailLevel,
  )
    ? input.detailLevel
    : 'balanced';

  const selectedStyleId =
    mode === 'curated'
      ? input.selectedStyleId ?? snap.styleId ?? null
      : null;

  if (selectedStyleId !== null && !isValidEntityId(selectedStyleId)) {
    return errResult(
      'VALIDATION_ERROR',
      'Curated style reference on preset must be a valid style ID.',
    );
  }

  return okResult({
    ...input,
    name,
    description: trim(input.description),
    creativeDirectionMode: mode,
    selectedStyleId,
    creativeDirectionSnapshot: {
      source: mode,
      styleId: selectedStyleId,
      styleName: trim(snap.styleName),
      styleCategory: trim(snap.styleCategory) || 'illustration',
      styleDescription: trim(snap.styleDescription),
      visualCharacteristics: trim(snap.visualCharacteristics),
      renderingTechnique: trim(snap.renderingTechnique),
      lineworkRules: trim(snap.lineworkRules),
      colorRules: trim(snap.colorRules),
      textureRules: trim(snap.textureRules),
      shadingRules: trim(snap.shadingRules),
      compositionRules: trim(snap.compositionRules),
      detailLevel: ALLOWED_DETAIL_LEVELS.has(snap.detailLevel)
        ? snap.detailLevel
        : detailLevel,
      ...(trim(snap.promptTemplate)
        ? { promptTemplate: trim(snap.promptTemplate) }
        : {}),
      ...(trim(snap.negativePromptTemplate)
        ? { negativePromptTemplate: trim(snap.negativePromptTemplate) }
        : {}),
    },
    aspectRatio,
    outputOrientation,
    backgroundTreatment,
    detailLevel,
    compositionDirection:
      trim(input.compositionDirection) || 'Preserve source framing',
    userCreativeInstructions: trim(input.userCreativeInstructions),
    negativePrompt: trim(input.negativePrompt),
    tags: cleanTags(input.tags),
  });
}

export function validatePersonalPresetRecord(
  preset: unknown,
): ServiceResult<PersonalPreset> {
  if (!isPlainRecord(preset)) {
    return errResult('VALIDATION_ERROR', 'PersonalPreset must be a plain object.');
  }
  const credKey = findCredentialLeakKey(preset, 'preset');
  if (credKey !== null) {
    return errResult(
      'SECURITY_BOUNDARY_VIOLATION',
      `Credential-like field "${credKey}" is prohibited in preset records.`,
      { field: credKey },
    );
  }
  const imageHit = findForbiddenImageInput(preset, 'preset');
  if (imageHit !== null) {
    return errResult(
      'SECURITY_BOUNDARY_VIOLATION',
      `${imageHit.reason} Presets must never include source images.`,
      { path: imageHit.path },
    );
  }
  if (!isValidEntityId(preset.id)) {
    return errResult('VALIDATION_ERROR', 'PersonalPreset requires a valid id.');
  }
  if (!isValidIsoTimestamp(preset.createdAt) || !isValidIsoTimestamp(preset.updatedAt)) {
    return errResult(
      'VALIDATION_ERROR',
      'PersonalPreset requires valid ISO-8601 timestamps.',
    );
  }
  if (!isPersonalPresetRecord(preset)) {
    return errResult(
      'VALIDATION_ERROR',
      'PersonalPreset record is missing required creative direction snapshot fields.',
    );
  }
  return okResult(preset);
}

export function applyPersonalPresetToProjectState(
  project: Project,
  preset: PersonalPreset,
): Project {
  const now = nowIsoTimestamp();
  const compositionPreferences: PromptCompositionPreferences = {
    aspectRatio: preset.aspectRatio,
    compositionDirection: preset.compositionDirection,
    backgroundTreatment: preset.backgroundTreatment,
    detailLevel: preset.detailLevel,
    outputOrientation: preset.outputOrientation,
  };

  const activeCreativeConfiguration: ProjectCreativeConfiguration = {
    mode: preset.creativeDirectionMode,
    selectedStyleId:
      preset.creativeDirectionMode === 'curated'
        ? preset.selectedStyleId ?? preset.creativeDirectionSnapshot.styleId
        : null,
    appliedPresetId: preset.id,
    appliedPresetName: preset.name,
    creativeDirectionSnapshot: {
      ...preset.creativeDirectionSnapshot,
    },
    compositionPreferences,
    userCreativeInstructions: preset.userCreativeInstructions,
    negativePromptOverride: preset.negativePrompt,
    updatedAt: now,
  };

  return {
    ...project,
    // Strictly preserve sourceAssetId, activeAnalysisId, activeDescriptionId, activePromptId, and status!
    selectedStyleId: activeCreativeConfiguration.selectedStyleId,
    activeCreativeConfiguration,
    updatedAt: now,
  };
}

export class StudioPresetService implements PresetEngineService {
  private readonly gateway: IndexedDbStorageGateway;

  constructor(gateway: IndexedDbStorageGateway) {
    this.gateway = gateway;
  }

  async listPresets(): Promise<ServiceResult<readonly PersonalPreset[]>> {
    const res = await this.gateway.getStore('presets').listAll();
    if (!res.ok) {
      return res;
    }

    const personalPresets = res.data
      .filter((record): record is PersonalPreset => isPersonalPresetRecord(record))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    return okResult(personalPresets);
  }

  async getPresetById(
    presetId: EntityId,
  ): Promise<ServiceResult<PersonalPreset | null>> {
    if (!isValidEntityId(presetId)) {
      return okResult(null);
    }
    const res = await this.gateway.getStore('presets').getById(presetId);
    if (!res.ok) {
      return res;
    }
    if (!res.data || !isPersonalPresetRecord(res.data)) {
      return okResult(null);
    }
    return okResult(res.data);
  }

  async createPreset(
    input: SavePersonalPresetInput,
  ): Promise<ServiceResult<PersonalPreset>> {
    const validated = validateSavePersonalPresetInput(input);
    if (!validated.ok) {
      return validated;
    }

    const clean = validated.data;
    const now = nowIsoTimestamp();
    const id = createEntityId('pst');

    const record: PersonalPreset = {
      id,
      name: clean.name,
      description: clean.description,
      styleId: clean.selectedStyleId ?? null,
      selectedStyleId: clean.selectedStyleId ?? null,
      creativeDirectionMode: clean.creativeDirectionMode,
      creativeDirectionSnapshot: clean.creativeDirectionSnapshot,
      aspectRatio: clean.aspectRatio,
      outputOrientation: clean.outputOrientation,
      backgroundTreatment: clean.backgroundTreatment,
      detailLevel: clean.detailLevel,
      compositionDirection: clean.compositionDirection,
      userCreativeInstructions: clean.userCreativeInstructions,
      negativePrompt: clean.negativePrompt,
      tags: clean.tags ?? [],
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    const putRes = await this.gateway.getStore('presets').put(record);
    if (!putRes.ok) {
      return putRes;
    }

    return okResult(record);
  }

  async updatePreset(
    presetId: EntityId,
    input: SavePersonalPresetInput,
  ): Promise<ServiceResult<PersonalPreset>> {
    const existingRes = await this.getPresetById(presetId);
    if (!existingRes.ok) {
      return existingRes;
    }
    if (!existingRes.data) {
      return errResult('NOT_FOUND', `Preset "${presetId}" was not found.`);
    }

    const validated = validateSavePersonalPresetInput(input);
    if (!validated.ok) {
      return validated;
    }

    const clean = validated.data;
    const now = nowIsoTimestamp();
    const updated: PersonalPreset = {
      ...existingRes.data,
      name: clean.name,
      description: clean.description,
      styleId: clean.selectedStyleId ?? null,
      selectedStyleId: clean.selectedStyleId ?? null,
      creativeDirectionMode: clean.creativeDirectionMode,
      creativeDirectionSnapshot: clean.creativeDirectionSnapshot,
      aspectRatio: clean.aspectRatio,
      outputOrientation: clean.outputOrientation,
      backgroundTreatment: clean.backgroundTreatment,
      detailLevel: clean.detailLevel,
      compositionDirection: clean.compositionDirection,
      userCreativeInstructions: clean.userCreativeInstructions,
      negativePrompt: clean.negativePrompt,
      tags: clean.tags ?? [],
      version: existingRes.data.version + 1,
      updatedAt: now,
    };

    const putRes = await this.gateway.getStore('presets').put(updated);
    if (!putRes.ok) {
      return putRes;
    }
    return okResult(updated);
  }

  async duplicatePreset(
    presetId: EntityId,
  ): Promise<ServiceResult<PersonalPreset>> {
    const existingRes = await this.getPresetById(presetId);
    if (!existingRes.ok) {
      return existingRes;
    }
    if (!existingRes.data) {
      return errResult('NOT_FOUND', `Preset "${presetId}" was not found.`);
    }

    const allRes = await this.listPresets();
    if (!allRes.ok) {
      return allRes;
    }
    const existingNames = new Set(
      allRes.data.map((p) => p.name.trim().toLowerCase()),
    );

    const baseName = existingRes.data.name.replace(/\s*\(Copy(?:\s+\d+)?\)$/i, '').trim();
    let candidateName = `${baseName} (Copy)`;
    let counter = 2;
    while (existingNames.has(candidateName.toLowerCase())) {
      candidateName = `${baseName} (Copy ${counter})`;
      counter += 1;
    }

    const now = nowIsoTimestamp();
    const duplicated: PersonalPreset = {
      ...existingRes.data,
      id: createEntityId('pst'),
      name: candidateName,
      creativeDirectionSnapshot: {
        ...existingRes.data.creativeDirectionSnapshot,
      },
      tags: [...existingRes.data.tags],
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    const putRes = await this.gateway.getStore('presets').put(duplicated);
    if (!putRes.ok) {
      return putRes;
    }
    return okResult(duplicated);
  }

  async deletePreset(presetId: EntityId): Promise<ServiceResult<void>> {
    return this.gateway.getStore('presets').delete(presetId);
  }

  async applyPresetToProject(
    projectId: EntityId,
    presetId: EntityId,
  ): Promise<ServiceResult<{ readonly project: Project; readonly preset: PersonalPreset }>> {
    const presetRes = await this.getPresetById(presetId);
    if (!presetRes.ok) {
      return presetRes;
    }
    if (!presetRes.data) {
      return errResult('NOT_FOUND', `Preset "${presetId}" could not be found.`);
    }

    const preset = presetRes.data;
    const targetProjectId = isValidEntityId(projectId)
      ? projectId
      : readStoredActiveProjectId() ?? createEntityId('prj');

    const projectStore = this.gateway.getStore('projects');
    const projectRes = await projectStore.getById(targetProjectId);
    if (!projectRes.ok) {
      return projectRes;
    }

    const now = nowIsoTimestamp();
    const baseProject: Project = projectRes.data ?? {
      id: targetProjectId,
      title: 'Untitled Studio Study',
      description: 'Active source asset study workspace.',
      status: 'draft',
      sourceAssetId: null,
      activeAnalysisId: null,
      activeDescriptionId: null,
      selectedStyleId: null,
      activeCreativeConfiguration: null,
      activePromptId: null,
      activeGenerationJobId: null,
      tags: [],
      createdAt: now,
      updatedAt: now,
    };

    const updatedProject = applyPersonalPresetToProjectState(baseProject, preset);
    const savedProjectRes = await projectStore.put(updatedProject);
    if (!savedProjectRes.ok) {
      return savedProjectRes;
    }

    writeStoredActiveProjectId(savedProjectRes.data.id);

    return okResult({
      project: savedProjectRes.data,
      preset,
    });
  }

  validatePreset(preset: unknown): ServiceResult<PersonalPreset> {
    return validatePersonalPresetRecord(preset);
  }
}

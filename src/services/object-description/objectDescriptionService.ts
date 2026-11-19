import { errResult, okResult } from '../../types/common.ts';
import type { ServiceResult } from '../../types/common.ts';
import type {
  EditableObjectEntry,
  ObjectAnalysis,
  ObjectDescription,
} from '../../types/domain.ts';
import type {
  NormalizeObjectDescriptionRequest,
  ObjectDescriptionEditableFields,
  ObjectDescriptionFieldErrors,
  ObjectDescriptionService,
} from '../../types/services.ts';
import { createEntityId, isValidEntityId, nowIsoTimestamp } from '../../utils/ids.ts';

export interface PromptReadyObjectSummary {
  readonly descriptionId: string;
  readonly analysisId: string;
  readonly sourceAssetId: string;
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
  readonly userNotes: string;
}

export function normalizeStringList(items: readonly string[] | undefined): string[] {
  if (!items || items.length === 0) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of items) {
    const trimmed = raw.trim();
    if (!trimmed) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(trimmed);
    }
  }
  return result;
}

export function parseDelimitedListInput(rawText: string): string[] {
  if (!rawText.trim()) {
    return [];
  }
  const parts = rawText
    .split(/[\n,;]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return normalizeStringList(parts);
}

export function parseLineOrSemicolonListInput(rawText: string): string[] {
  if (!rawText.trim()) {
    return [];
  }
  const lines = rawText.split(/\r?\n/);
  const parts: string[] = [];
  for (const line of lines) {
    const trimmed = line.replace(/^\s*[-*•]\s*/, '').trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.includes(';')) {
      for (const seg of trimmed.split(';')) {
        if (seg.trim()) {
          parts.push(seg.trim());
        }
      }
    } else {
      parts.push(trimmed);
    }
  }
  return normalizeStringList(parts);
}

export function formatDelimitedList(items: readonly string[]): string {
  return items.join(', ');
}

export function formatMultiItemList(items: readonly string[]): string {
  return items.join('\n');
}

export function extractEditableFieldsFromAnalysis(
  analysis: ObjectAnalysis,
): ObjectDescriptionEditableFields {
  const firstDetected = analysis.detectedObjects[0];
  return {
    objectName: (analysis.objectName || firstDetected?.label || '').trim(),
    objectCategory: (analysis.objectCategory || firstDetected?.category || '').trim(),
    primaryDescription: (analysis.primaryDescription || analysis.sceneSummary || '').trim(),
    shapeAndSilhouette: (analysis.shapeAndSilhouette || '').trim(),
    materials: normalizeStringList(
      analysis.materials?.length ? analysis.materials : firstDetected?.materials,
    ),
    dominantColors: normalizeStringList(
      analysis.dominantColors?.length
        ? analysis.dominantColors
        : firstDetected?.dominantColors,
    ),
    surfaceDetails: (analysis.surfaceDetails || '').trim(),
    distinctiveFeatures: normalizeStringList(
      analysis.distinctiveFeatures?.length
        ? analysis.distinctiveFeatures
        : firstDetected?.keyAttributes,
    ),
    composition: (analysis.composition || analysis.compositionNotes || '').trim(),
    viewingAngle: (analysis.viewingAngle || firstDetected?.spatialPosition || '').trim(),
    preservationPriorities: normalizeStringList(analysis.preservationPriorities),
    uncertainAttributes: normalizeStringList(analysis.uncertainAttributes),
    userNotes: '',
  };
}

export function extractEditableFieldsFromDescription(
  description: ObjectDescription,
): ObjectDescriptionEditableFields {
  return {
    objectName: description.objectName.trim(),
    objectCategory: description.objectCategory.trim(),
    primaryDescription: description.primaryDescription.trim(),
    shapeAndSilhouette: description.shapeAndSilhouette.trim(),
    materials: normalizeStringList(description.materials),
    dominantColors: normalizeStringList(description.dominantColors),
    surfaceDetails: description.surfaceDetails.trim(),
    distinctiveFeatures: normalizeStringList(description.distinctiveFeatures),
    composition: description.composition.trim(),
    viewingAngle: description.viewingAngle.trim(),
    preservationPriorities: normalizeStringList(description.preservationPriorities),
    uncertainAttributes: normalizeStringList(description.uncertainAttributes),
    userNotes: description.userNotes.trim(),
  };
}

function stringArraysEqual(
  a: readonly string[],
  b: readonly string[],
): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((val, idx) => val === b[idx]);
}

export function areEditableFieldsEqual(
  a: ObjectDescriptionEditableFields,
  b: ObjectDescriptionEditableFields,
): boolean {
  return (
    a.objectName.trim() === b.objectName.trim() &&
    a.objectCategory.trim() === b.objectCategory.trim() &&
    a.primaryDescription.trim() === b.primaryDescription.trim() &&
    a.shapeAndSilhouette.trim() === b.shapeAndSilhouette.trim() &&
    stringArraysEqual(
      normalizeStringList(a.materials),
      normalizeStringList(b.materials),
    ) &&
    stringArraysEqual(
      normalizeStringList(a.dominantColors),
      normalizeStringList(b.dominantColors),
    ) &&
    a.surfaceDetails.trim() === b.surfaceDetails.trim() &&
    stringArraysEqual(
      normalizeStringList(a.distinctiveFeatures),
      normalizeStringList(b.distinctiveFeatures),
    ) &&
    a.composition.trim() === b.composition.trim() &&
    a.viewingAngle.trim() === b.viewingAngle.trim() &&
    stringArraysEqual(
      normalizeStringList(a.preservationPriorities),
      normalizeStringList(b.preservationPriorities),
    ) &&
    stringArraysEqual(
      normalizeStringList(a.uncertainAttributes),
      normalizeStringList(b.uncertainAttributes),
    ) &&
    a.userNotes.trim() === b.userNotes.trim()
  );
}

export function validateEditableDescriptionFields(
  fields: ObjectDescriptionEditableFields,
): {
  readonly valid: boolean;
  readonly fieldErrors: ObjectDescriptionFieldErrors;
  readonly normalized: ObjectDescriptionEditableFields;
} {
  const normalized: ObjectDescriptionEditableFields = {
    objectName: fields.objectName.trim(),
    objectCategory: fields.objectCategory.trim(),
    primaryDescription: fields.primaryDescription.trim(),
    shapeAndSilhouette: fields.shapeAndSilhouette.trim(),
    materials: normalizeStringList(fields.materials),
    dominantColors: normalizeStringList(fields.dominantColors),
    surfaceDetails: fields.surfaceDetails.trim(),
    distinctiveFeatures: normalizeStringList(fields.distinctiveFeatures),
    composition: fields.composition.trim(),
    viewingAngle: fields.viewingAngle.trim(),
    preservationPriorities: normalizeStringList(fields.preservationPriorities),
    uncertainAttributes: normalizeStringList(fields.uncertainAttributes),
    userNotes: fields.userNotes.trim(),
  };

  const errors: {
    objectName?: string;
    objectCategory?: string;
    primaryDescription?: string;
  } = {};

  if (normalized.objectName.length === 0) {
    errors.objectName = 'Object Name is required before saving.';
  }
  if (normalized.objectCategory.length === 0) {
    errors.objectCategory = 'Object Category is required before saving.';
  }
  if (normalized.primaryDescription.length === 0) {
    errors.primaryDescription = 'Primary Description is required before saving.';
  }

  return {
    valid:
      !errors.objectName &&
      !errors.objectCategory &&
      !errors.primaryDescription,
    fieldErrors: errors,
    normalized,
  };
}

function buildEditableObjectEntries(
  analysis: ObjectAnalysis,
  fields: ObjectDescriptionEditableFields,
  existingEntries?: readonly EditableObjectEntry[],
): readonly EditableObjectEntry[] {
  const firstExisting = existingEntries?.[0];
  const firstDetected = analysis.detectedObjects[0];
  const visualDetails = [
    fields.primaryDescription,
    fields.shapeAndSilhouette ? `Silhouette: ${fields.shapeAndSilhouette}` : '',
    fields.surfaceDetails ? `Surface details: ${fields.surfaceDetails}` : '',
    fields.distinctiveFeatures.length > 0
      ? `Distinctive features: ${fields.distinctiveFeatures.join('; ')}`
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  const primaryEntry: EditableObjectEntry = {
    id: firstExisting?.id ?? createEntityId('obj'),
    sourceDetectedObjectId: firstDetected?.id ?? null,
    subjectName: fields.objectName,
    visualDetails,
    materialAndTexture: fields.materials.join(', '),
    colorPalette: fields.dominantColors,
    poseOrArrangement: [fields.viewingAngle, fields.composition]
      .filter(Boolean)
      .join(' · '),
    includeInPrompt: firstExisting?.includeInPrompt ?? true,
  };

  return [primaryEntry];
}

export function buildPromptReadyObjectSummary(
  description: ObjectDescription,
): PromptReadyObjectSummary {
  return {
    descriptionId: description.id,
    analysisId: description.analysisId,
    sourceAssetId: description.sourceAssetId,
    version: description.version,
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
    userNotes: description.userNotes,
  };
}

export class StudioObjectDescriptionService
  implements ObjectDescriptionService
{
  createFromAnalysis(
    analysis: ObjectAnalysis,
  ): ServiceResult<ObjectDescription> {
    if (!isValidEntityId(analysis.id) || !isValidEntityId(analysis.projectId)) {
      return errResult(
        'VALIDATION_ERROR',
        'ObjectAnalysis requires valid project and analysis identifiers.',
      );
    }

    const baseFields = extractEditableFieldsFromAnalysis(analysis);
    const validation = validateEditableDescriptionFields({
      ...baseFields,
      objectName: baseFields.objectName || 'Observed Visual Subject',
      objectCategory: baseFields.objectCategory || 'Visual Subject',
      primaryDescription:
        baseFields.primaryDescription ||
        analysis.sceneSummary ||
        'Observed visual subject.',
    });

    if (!validation.valid) {
      return errResult(
        'VALIDATION_ERROR',
        'ObjectAnalysis did not contain sufficient subject detail to initialize an editable description.',
        {
          invalidFields: Object.keys(validation.fieldErrors).join(','),
          ...(validation.fieldErrors.objectName
            ? { objectNameError: validation.fieldErrors.objectName }
            : {}),
          ...(validation.fieldErrors.objectCategory
            ? { objectCategoryError: validation.fieldErrors.objectCategory }
            : {}),
          ...(validation.fieldErrors.primaryDescription
            ? { primaryDescriptionError: validation.fieldErrors.primaryDescription }
            : {}),
        },
      );
    }

    const now = nowIsoTimestamp();
    const normalized = validation.normalized;
    const objects = buildEditableObjectEntries(analysis, normalized);

    return okResult({
      id: createEntityId('dsc'),
      projectId: analysis.projectId,
      analysisId: analysis.id,
      sourceAssetId: analysis.sourceAssetId,
      version: 1,
      ...normalized,
      primarySubject: normalized.objectName,
      environmentContext: normalized.composition,
      objects,
      moodAndAtmosphere: analysis.lightingNotes,
      isNormalized: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  normalizeAndValidate(
    request: NormalizeObjectDescriptionRequest,
  ): ServiceResult<ObjectDescription> {
    if (!isValidEntityId(request.projectId)) {
      return errResult(
        'VALIDATION_ERROR',
        'A valid projectId is required to save an ObjectDescription.',
      );
    }

    if (request.analysis.projectId !== request.projectId) {
      return errResult(
        'VALIDATION_ERROR',
        'ObjectAnalysis does not belong to the active project.',
      );
    }

    const base = request.existingDescription
      ? extractEditableFieldsFromDescription(request.existingDescription)
      : extractEditableFieldsFromAnalysis(request.analysis);

    const draft = request.draft ?? {};
    const merged: ObjectDescriptionEditableFields = {
      objectName:
        draft.objectName !== undefined
          ? draft.objectName
          : draft.primarySubject !== undefined
            ? draft.primarySubject
            : base.objectName,
      objectCategory:
        draft.objectCategory !== undefined
          ? draft.objectCategory
          : base.objectCategory,
      primaryDescription:
        draft.primaryDescription !== undefined
          ? draft.primaryDescription
          : base.primaryDescription,
      shapeAndSilhouette:
        draft.shapeAndSilhouette !== undefined
          ? draft.shapeAndSilhouette
          : base.shapeAndSilhouette,
      materials:
        draft.materials !== undefined ? draft.materials : base.materials,
      dominantColors:
        draft.dominantColors !== undefined
          ? draft.dominantColors
          : base.dominantColors,
      surfaceDetails:
        draft.surfaceDetails !== undefined
          ? draft.surfaceDetails
          : base.surfaceDetails,
      distinctiveFeatures:
        draft.distinctiveFeatures !== undefined
          ? draft.distinctiveFeatures
          : base.distinctiveFeatures,
      composition:
        draft.composition !== undefined
          ? draft.composition
          : draft.environmentContext !== undefined
            ? draft.environmentContext
            : base.composition,
      viewingAngle:
        draft.viewingAngle !== undefined
          ? draft.viewingAngle
          : base.viewingAngle,
      preservationPriorities:
        draft.preservationPriorities !== undefined
          ? draft.preservationPriorities
          : base.preservationPriorities,
      uncertainAttributes:
        draft.uncertainAttributes !== undefined
          ? draft.uncertainAttributes
          : base.uncertainAttributes,
      userNotes:
        draft.userNotes !== undefined ? draft.userNotes : base.userNotes,
    };

    const validation = validateEditableDescriptionFields(merged);
    if (!validation.valid) {
      const firstError =
        validation.fieldErrors.objectName ??
        validation.fieldErrors.objectCategory ??
        validation.fieldErrors.primaryDescription ??
        'Required object description fields cannot be empty.';
      return errResult('VALIDATION_ERROR', firstError, {
        invalidFields: Object.keys(validation.fieldErrors).join(','),
        ...(validation.fieldErrors.objectName
          ? { objectNameError: validation.fieldErrors.objectName }
          : {}),
        ...(validation.fieldErrors.objectCategory
          ? { objectCategoryError: validation.fieldErrors.objectCategory }
          : {}),
        ...(validation.fieldErrors.primaryDescription
          ? { primaryDescriptionError: validation.fieldErrors.primaryDescription }
          : {}),
      });
    }

    const now = nowIsoTimestamp();
    const normalized = validation.normalized;
    const existing = request.existingDescription ?? null;
    const nextVersion = existing ? existing.version + 1 : 1;
    const objects =
      draft.objects ??
      buildEditableObjectEntries(
        request.analysis,
        normalized,
        existing?.objects,
      );

    return okResult({
      id: existing?.id ?? createEntityId('dsc'),
      projectId: request.projectId,
      analysisId: request.analysis.id,
      sourceAssetId: request.analysis.sourceAssetId,
      version: nextVersion,
      ...normalized,
      primarySubject: normalized.objectName,
      environmentContext:
        draft.environmentContext !== undefined
          ? draft.environmentContext.trim()
          : normalized.composition,
      objects,
      moodAndAtmosphere:
        draft.moodAndAtmosphere !== undefined
          ? draft.moodAndAtmosphere.trim()
          : existing?.moodAndAtmosphere ?? request.analysis.lightingNotes,
      isNormalized: true,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }

  resetFromAnalysis(
    analysis: ObjectAnalysis,
    existingDescription?: ObjectDescription | null,
  ): ServiceResult<ObjectDescription> {
    const initialized = this.createFromAnalysis(analysis);
    if (!initialized.ok) {
      return initialized;
    }

    if (!existingDescription) {
      return initialized;
    }

    const now = nowIsoTimestamp();
    return okResult({
      ...initialized.data,
      id: existingDescription.id,
      version: existingDescription.version + 1,
      createdAt: existingDescription.createdAt,
      updatedAt: now,
    });
  }
}

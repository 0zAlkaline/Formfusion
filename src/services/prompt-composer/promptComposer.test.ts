import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  ArtStyle,
  ObjectDescription,
  PromptDocument,
} from '../../types/domain.ts';
import type { PromptSynthesisProviderOutput } from '../../types/providers.ts';
import { createEntityId, nowIsoTimestamp } from '../../utils/ids.ts';
import {
  StudioPromptComposerService,
  createDefaultCompositionPreferences,
  createDefaultManualCreativeDirection,
  deriveOutputOrientation,
  markPromptEdited,
  normalizeArtStyleConfiguration,
  unlockApprovedPromptForNewRevision,
} from './contract.ts';

function makeSavedDescription(
  projectId = createEntityId('prj'),
  overrides: Partial<ObjectDescription> = {},
): ObjectDescription {
  const now = nowIsoTimestamp();
  const id = createEntityId('dsc');
  const analysisId = createEntityId('anl');
  const sourceAssetId = createEntityId('src');
  return {
    id,
    projectId,
    analysisId,
    sourceAssetId,
    version: 2,
    objectName: 'Hand-thrown Stoneware Pitcher',
    objectCategory: 'Ceramic Vessel',
    primaryDescription:
      'A matte cream ceramic pitcher with a pinched pouring spout and hand-pulled strap handle.',
    shapeAndSilhouette: 'Tapered ovoid belly narrowing to a gently flared collar.',
    materials: ['unglazed stoneware clay', 'matte speckled glaze'],
    dominantColors: ['warm ivory', 'speckled taupe', 'cobalt blue'],
    surfaceDetails: 'Subtle horizontal throwing rings and iron fleck speckles.',
    distinctiveFeatures: ['Hand-painted cobalt rim band', 'Pinched spout'],
    composition: 'Centered upright on a clean tabletop surface.',
    viewingAngle: 'Eye-level three-quarter view',
    preservationPriorities: [
      'Maintain tapered pitcher silhouette and strap handle curve',
      'Preserve cobalt rim band placement',
    ],
    uncertainAttributes: [
      'Back side maker stamp hidden from view',
      'Interior glaze color uncertain',
    ],
    primarySubject: 'Hand-thrown Stoneware Pitcher',
    environmentContext: 'Centered upright on a clean tabletop surface.',
    objects: [],
    moodAndAtmosphere: 'Quiet artisanal studio daylight.',
    userNotes: 'Edited rim glaze description.',
    isNormalized: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeSampleArtStyle(overrides: Partial<ArtStyle> = {}): ArtStyle {
  const now = nowIsoTimestamp();
  return {
    id: createEntityId('sty'),
    slug: 'botanical-watercolor-study',
    name: 'Botanical Watercolor Study',
    category: 'painterly',
    summary:
      'Translucent layered watercolor washes over fine ink contours on cold-press paper.',
    styleDirectives: ['Fine ink contour lines', 'Soft wet-on-wet pigment blooms'],
    mediumKeywords: ['watercolor on cold-press cotton paper', 'waterproof sepia ink'],
    lightingKeywords: ['soft diffused north window daylight'],
    defaultNegativeDirectives: ['photorealistic gloss', 'heavy impasto', 'neon glare'],
    recommendedAspectRatios: ['3:4', '1:1'],
    lineworkRules: 'Delicate sepia ink outlines with subtle line-weight taper.',
    colorRules: 'Translucent mineral pigments with preserved paper highlights.',
    textureRules: 'Visible cold-press paper tooth and natural granulation.',
    detailLevel: 'high',
    negativePromptTemplate: 'photorealistic gloss, heavy impasto, neon glare',
    isCurated: true,
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

test('1. Input validation rejects missing Editable Object Description or incomplete Creative Direction', () => {
  const service = new StudioPromptComposerService();
  const projectId = createEntityId('prj');

  const missingDescReport = service.validatePromptInputs({
    projectId,
    description: null,
    manualCreativeDirection: {
      ...createDefaultManualCreativeDirection(),
      styleName: 'Editorial Ink',
      styleDescription: 'Fine ink linework on warm cream paper.',
    },
    userInstructions: '',
  });
  assert.equal(missingDescReport.ok, true);
  if (missingDescReport.ok) {
    assert.equal(missingDescReport.data.valid, false);
    assert.ok(missingDescReport.data.fieldErrors.description);
  }

  const desc = makeSavedDescription(projectId);
  const missingStyleReport = service.validatePromptInputs({
    projectId,
    description: desc,
    manualCreativeDirection: createDefaultManualCreativeDirection(),
    userInstructions: '',
  });
  assert.equal(missingStyleReport.ok, true);
  if (missingStyleReport.ok) {
    assert.equal(missingStyleReport.data.valid, false);
    assert.ok(missingStyleReport.data.fieldErrors.styleName);
  }

  const mismatchedProjectDesc = makeSavedDescription(createEntityId('prj'));
  const mismatchReport = service.validatePromptInputs({
    projectId,
    description: mismatchedProjectDesc,
    artStyle: makeSampleArtStyle(),
    userInstructions: '',
  });
  assert.equal(mismatchReport.ok, true);
  if (mismatchReport.ok) {
    assert.equal(mismatchReport.data.valid, false);
    assert.ok(mismatchReport.data.fieldErrors.description);
  }
});

test('2. Authoritative description revision binding & ArtStyle vs Manual Creative Direction normalization', () => {
  const service = new StudioPromptComposerService();
  const projectId = createEntityId('prj');
  const desc = makeSavedDescription(projectId, {
    version: 4,
    objectName: 'Edited Copper Teapot',
  });
  const style = makeSampleArtStyle();

  const normalizedArtStyle = normalizeArtStyleConfiguration(style, null);
  assert.equal(normalizedArtStyle.ok, true);
  if (normalizedArtStyle.ok) {
    assert.equal(normalizedArtStyle.data.styleId, style.id);
    assert.equal(normalizedArtStyle.data.isManualCreativeDirection, false);
    assert.equal(
      normalizedArtStyle.data.negativePromptTemplate,
      'photorealistic gloss, heavy impasto, neon glare',
    );
  }

  const normalizedManual = normalizeArtStyleConfiguration(null, {
    styleName: 'Monograph Lithograph',
    styleCategory: 'printmaking',
    styleDescription: 'Fine stone lithograph tonal shading on archival rag paper.',
    detailLevel: 'intricate',
  });
  assert.equal(normalizedManual.ok, true);
  if (normalizedManual.ok) {
    assert.equal(normalizedManual.data.styleId, null);
    assert.equal(normalizedManual.data.isManualCreativeDirection, true);
    assert.equal(normalizedManual.data.styleCategory, 'printmaking');
  }

  assert.equal(deriveOutputOrientation('1:1'), 'square');
  assert.equal(deriveOutputOrientation('3:4'), 'portrait');
  assert.equal(deriveOutputOrientation('16:9'), 'landscape');

  const normalizedInputs = service.normalizePromptInputs({
    projectId,
    description: desc,
    artStyle: style,
    userInstructions: 'Keep warm editorial calm, avoid clutter.',
    compositionPreferences: createDefaultCompositionPreferences('3:4'),
  });
  assert.equal(normalizedInputs.ok, true);
  if (normalizedInputs.ok) {
    assert.equal(normalizedInputs.data.sourceDescriptionRevision, 4);
    assert.equal(normalizedInputs.data.descriptionId, desc.id);
    assert.equal(normalizedInputs.data.subject.objectName, 'Edited Copper Teapot');
    assert.equal(normalizedInputs.data.compositionPreferences.outputOrientation, 'portrait');
    assert.ok(normalizedInputs.data.negativeDirectivesFromInputs.includes('clutter'));
  }
});

test('3. Synthesizes Master Prompt over HTTP using text-only payload (no source image or credentials)', async () => {
  const projectId = createEntityId('prj');
  const desc = makeSavedDescription(projectId, { version: 3 });
  let capturedBody: Record<string, unknown> | null = null;

  const mockFetch: typeof fetch = async (_url, init) => {
    capturedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    const payload: PromptSynthesisProviderOutput = {
      requestStatus: 'succeeded',
      providerId: 'gemini',
      modelId: 'gemini-4-hydrogen',
      generatedAt: nowIsoTimestamp(),
      generatedPrompt:
        'An editorial botanical watercolor illustration of a hand-thrown stoneware pitcher with a pinched spout, strap handle, and cobalt blue rim band, rendered with sepia ink contours and translucent mineral washes on cold-press cotton paper in eye-level three-quarter framing against a clean studio backdrop.',
      negativePrompt: 'photorealistic gloss, heavy impasto, neon glare',
      unresolvedConflicts: [],
    };
    return new Response(JSON.stringify({ ok: true, data: payload }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const service = new StudioPromptComposerService({ fetchFn: mockFetch });
  const result = await service.synthesizeMasterPrompt({
    projectId,
    description: desc,
    artStyle: makeSampleArtStyle(),
    userInstructions: 'Soft museum lighting.',
    compositionPreferences: createDefaultCompositionPreferences('3:4'),
  });

  assert.equal(result.ok, true);
  assert.ok(capturedBody !== null);
  const serialized = JSON.stringify(capturedBody);
  assert.equal(serialized.includes('sourceAssetId'), false);
  assert.equal(serialized.includes('GEMINI_API_KEY'), false);
  assert.equal(serialized.includes('data:image/'), false);

  if (result.ok) {
    assert.equal(result.data.approvalStatus, 'generated');
    assert.equal(result.data.sourceDescriptionRevision, 3);
    assert.equal(result.data.finalPrompt, result.data.generatedPrompt);
    assert.equal(result.data.approvedAt, null);
    assert.equal(result.data.revisionNumber, 1);
  }
});

test('4. Rejects invalid Gemini synthesis responses and grounds Negative Prompt strictly in supported directives', () => {
  const service = new StudioPromptComposerService();
  const projectId = createEntityId('prj');
  const desc = makeSavedDescription(projectId);

  // Case A: No negative directives in style or user instructions -> negativePrompt cleared
  const normNoNegative = service.normalizePromptInputs({
    projectId,
    description: desc,
    manualCreativeDirection: {
      styleName: 'Warm Gouache',
      styleDescription: 'Matte opaque gouache study with crisp brush strokes.',
    },
    userInstructions: 'Warm morning daylight.',
  });
  assert.equal(normNoNegative.ok, true);
  if (normNoNegative.ok) {
    const validated = service.validateGeneratedPrompt(
      {
        requestStatus: 'succeeded',
        providerId: 'gemini',
        modelId: 'gemini-4-hydrogen',
        generatedAt: nowIsoTimestamp(),
        generatedPrompt:
          'A warm gouache painting of a hand-thrown stoneware pitcher with cobalt rim band on a clean backdrop.',
        negativePrompt: 'ugly, blurry, bad anatomy, watermark',
        unresolvedConflicts: [],
      },
      normNoNegative.data,
    );
    assert.equal(validated.ok, true);
    if (validated.ok) {
      assert.equal(validated.data.negativePrompt, '');
    }

    // Rejects provider-specific syntax like --ar 3:4
    const withProviderFlag = service.validateGeneratedPrompt(
      {
        requestStatus: 'succeeded',
        providerId: 'gemini',
        modelId: 'gemini-4-hydrogen',
        generatedAt: nowIsoTimestamp(),
        generatedPrompt: 'Stoneware pitcher study --ar 3:4 --v 6',
        negativePrompt: '',
        unresolvedConflicts: [],
      },
      normNoNegative.data,
    );
    assert.equal(withProviderFlag.ok, false);
    if (!withProviderFlag.ok) {
      assert.equal(withProviderFlag.error.code, 'VALIDATION_ERROR');
    }

    // Rejects base64 image URI in generatedPrompt
    const withBase64 = service.validateGeneratedPrompt(
      {
        requestStatus: 'succeeded',
        providerId: 'gemini',
        modelId: 'gemini-4-hydrogen',
        generatedAt: nowIsoTimestamp(),
        generatedPrompt: 'data:image/png;base64,iVBORw0KGgoAAAANS',
        negativePrompt: '',
        unresolvedConflicts: [],
      },
      normNoNegative.data,
    );
    assert.equal(withBase64.ok, false);
    if (!withBase64.ok) {
      assert.equal(withBase64.error.code, 'SECURITY_BOUNDARY_VIOLATION');
    }
  }
});

test('5. Conflict detection flags contradictory style, palette, orientation, and negative rules', () => {
  const service = new StudioPromptComposerService();
  const projectId = createEntityId('prj');
  const desc = makeSavedDescription(projectId);

  const report = service.validatePromptInputs({
    projectId,
    description: desc,
    manualCreativeDirection: {
      styleName: 'Flat 2D Monochrome Vector',
      styleDescription: 'Flat 2D black and white graphic illustration.',
      negativePromptTemplate: 'drop shadow',
    },
    userInstructions:
      'Make it a photorealistic vibrant neon wide landscape with heavy drop shadow in a crowded street.',
    compositionPreferences: createDefaultCompositionPreferences('3:4'),
  });

  assert.equal(report.ok, true);
  if (report.ok) {
    assert.ok(report.data.potentialConflicts.length >= 4);
  }
});

test('6. GeneratedPrompt immutability, independent FinalMasterPrompt editing, Approval locking, Unlocking, and Regeneration', async () => {
  const projectId = createEntityId('prj');
  const desc = makeSavedDescription(projectId);
  let callIndex = 0;

  const service = new StudioPromptComposerService({
    fetchFn: async () => {
      callIndex += 1;
      const payload: PromptSynthesisProviderOutput = {
        requestStatus: 'succeeded',
        providerId: 'gemini',
        modelId: 'gemini-4-hydrogen',
        generatedAt: nowIsoTimestamp(),
        generatedPrompt: `Master prompt synthesis baseline version ${callIndex} for hand-thrown stoneware pitcher.`,
        negativePrompt: 'harsh glare',
        unresolvedConflicts: [],
      };
      return new Response(JSON.stringify({ ok: true, data: payload }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  const v1Res = await service.synthesizeMasterPrompt({
    projectId,
    description: desc,
    manualCreativeDirection: {
      styleName: 'Studio Ink Wash',
      styleDescription: 'Ink wash illustration.',
      negativePromptTemplate: 'harsh glare',
    },
    userInstructions: '',
  });
  assert.equal(v1Res.ok, true);
  if (!v1Res.ok) return;

  const v1 = v1Res.data;
  const edited = markPromptEdited(v1, {
    finalPrompt: `${v1.generatedPrompt} Added bespoke tabletop shadow polish.`,
  });
  assert.equal(edited.ok, true);
  if (!edited.ok) return;
  assert.equal(edited.data.approvalStatus, 'edited');
  assert.equal(edited.data.generatedPrompt, v1.generatedPrompt);

  // Attempting to mutate generatedPrompt in savePromptDocument must fail
  const tampered: PromptDocument = {
    ...edited.data,
    generatedPrompt: 'Tampered baseline',
  };
  const tamperSave = service.savePromptDocument(tampered, v1);
  assert.equal(tamperSave.ok, false);
  if (!tamperSave.ok) {
    assert.equal(tamperSave.error.code, 'CONFLICT');
  }

  // Approve final prompt
  const approved = service.approveFinalPrompt({
    promptDocument: edited.data,
    finalPrompt: edited.data.finalPrompt,
    negativePrompt: edited.data.negativePrompt,
  });
  assert.equal(approved.ok, true);
  if (!approved.ok) return;
  assert.equal(approved.data.approvalStatus, 'approved');
  assert.ok(approved.data.approvedAt);
  assert.equal(approved.data.generatedPrompt, v1.generatedPrompt);

  // Approved prompt rejects direct edits
  const blockedEdit = markPromptEdited(approved.data, {
    finalPrompt: 'Should not overwrite approved prompt',
  });
  assert.equal(blockedEdit.ok, false);
  if (!blockedEdit.ok) {
    assert.equal(blockedEdit.error.code, 'CONFLICT');
  }

  // Unlocking creates a new revision leaving approved revision untouched
  const unlocked = unlockApprovedPromptForNewRevision(approved.data, 1);
  assert.equal(unlocked.ok, true);
  if (!unlocked.ok) return;
  assert.notEqual(unlocked.data.id, approved.data.id);
  assert.equal(unlocked.data.revisionNumber, 2);
  assert.equal(unlocked.data.approvalStatus, 'edited');
  assert.equal(unlocked.data.approvedAt, null);

  // Regenerate increments revision cleanly
  const regenerated = await service.regeneratePrompt({
    projectId,
    description: desc,
    manualCreativeDirection: {
      styleName: 'Studio Ink Wash',
      styleDescription: 'Ink wash illustration.',
      negativePromptTemplate: 'harsh glare',
    },
    userInstructions: 'Crisper rim highlight.',
    previousRevision: 2,
  });
  assert.equal(regenerated.ok, true);
  if (regenerated.ok) {
    assert.equal(regenerated.data.revisionNumber, 3);
    assert.notEqual(regenerated.data.id, approved.data.id);
    assert.equal(regenerated.data.approvalStatus, 'generated');
  }
});

test('7. Rejects forbidden source image inputs and credential leaks on client Prompt Composer requests', async () => {
  const service = new StudioPromptComposerService();
  const projectId = createEntityId('prj');
  const desc = makeSavedDescription(projectId);

  const withForbiddenImage = await service.synthesizeMasterPrompt({
    projectId,
    description: desc,
    artStyle: makeSampleArtStyle(),
    userInstructions: '',
    sourceImage: 'data:image/png;base64,AAAA',
  } as unknown as Parameters<typeof service.synthesizeMasterPrompt>[0]);

  assert.equal(withForbiddenImage.ok, false);
  if (!withForbiddenImage.ok) {
    assert.equal(withForbiddenImage.error.code, 'SECURITY_BOUNDARY_VIOLATION');
  }

  const withCredential = service.validatePromptInputs({
    projectId,
    description: desc,
    artStyle: makeSampleArtStyle(),
    userInstructions: '',
    geminiApiKey: 'AIzaShouldNeverBeHere',
  } as unknown as Parameters<typeof service.validatePromptInputs>[0]);

  assert.equal(withCredential.ok, false);
  if (!withCredential.ok) {
    assert.equal(withCredential.error.code, 'SECURITY_BOUNDARY_VIOLATION');
  }
});

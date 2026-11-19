import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { createServerApp } from '../../../server.ts';
import type { PromptSynthesisProviderInput } from '../../../src/types/providers.ts';
import { createEntityId } from '../../../src/utils/ids.ts';
import { createServerProviderRegistry } from '../providerRegistry.ts';
import {
  GeminiPromptComposerProvider,
  buildGeminiSynthesisUserPrompt,
} from './geminiPromptComposer.ts';

function makeValidProviderInput(
  overrides: Partial<PromptSynthesisProviderInput> = {},
): PromptSynthesisProviderInput {
  return {
    projectId: createEntityId('prj'),
    subject: {
      descriptionId: createEntityId('dsc'),
      sourceDescriptionRevision: 2,
      objectName: 'Hand-thrown Stoneware Pitcher',
      objectCategory: 'Ceramic Vessel',
      primaryDescription:
        'A matte cream ceramic pitcher with a pinched spout and strap handle.',
      shapeAndSilhouette: 'Tapered ovoid vessel tapering to a flared collar.',
      materials: ['stoneware clay', 'matte glaze'],
      dominantColors: ['warm cream', 'cobalt blue'],
      surfaceDetails: 'Subtle throwing rings and iron speckles.',
      distinctiveFeatures: ['Cobalt rim band', 'Pinched spout'],
      composition: 'Centered on clean tabletop.',
      viewingAngle: 'Eye-level three-quarter view',
      preservationPriorities: ['Preserve tapered silhouette and cobalt rim band'],
      uncertainAttributes: ['Back mark hidden from view'],
      userNotes: 'Verified edited description.',
    },
    creativeDirection: {
      styleId: null,
      styleName: 'Editorial Ink & Watercolor',
      styleCategory: 'painterly',
      styleDescription:
        'Hand-inked sepia contours with translucent mineral watercolor washes.',
      visualCharacteristics: 'Clean studio editorial precision',
      renderingRules: 'Translucent layered pigment washes',
      lineworkRules: 'Fine nib ink contours',
      colorRules: 'Muted mineral earth and cobalt tones',
      textureRules: 'Cold-press cotton paper grain',
      shadingRules: 'Soft diffused daylight shading',
      compositionRules: 'Generous negative space',
      detailLevel: 'high',
      negativePromptTemplate: 'photorealistic plastic sheen, harsh neon',
      isManualCreativeDirection: true,
    },
    creativeInstructions: 'Soft museum lighting and calm atmosphere.',
    compositionPreferences: {
      aspectRatio: '3:4',
      compositionDirection: 'Preserve source three-quarter view',
      backgroundTreatment: 'preserve_clean',
      detailLevel: 'high',
      outputOrientation: 'portrait',
    },
    detectedInputConflicts: [],
    ...overrides,
  };
}

test('GeminiPromptComposerProvider preserves subject, uncertainty rules, and returns structured JSON synthesis', async () => {
  const secretValue = 'AIzaTestFakePromptComposerKey1234567890';
  let capturedUserPrompt = '';
  let capturedSystemInstruction = '';

  const provider = new GeminiPromptComposerProvider({
    getEnv: () => ({
      GEMINI_API_KEY: secretValue,
      GEMINI_MODEL_ID: 'gemini-4-hydrogen',
    }),
    createSdkClient: () => ({
      models: {
        async generateContent(params) {
          capturedUserPrompt = params.contents;
          capturedSystemInstruction = params.config?.systemInstruction ?? '';
          return {
            text: JSON.stringify({
              generatedPrompt:
                'An editorial ink and watercolor illustration of a hand-thrown stoneware pitcher in matte cream clay with a pinched spout, hand-pulled strap handle, and cobalt blue rim band, rendered with fine sepia contour linework and translucent layered washes on cold-press cotton paper in eye-level three-quarter framing.',
              negativePrompt: 'photorealistic plastic sheen, harsh neon',
              unresolvedConflicts: [],
            }),
            modelVersion: 'gemini-4-hydrogen-001',
            responseId: 'resp_prm_001',
            candidates: [{ finishReason: 'STOP' }],
          };
        },
      },
    }),
  });

  const input = makeValidProviderInput();
  const result = await provider.synthesizeMasterPrompt(input);

  assert.equal(result.mappedError, undefined);
  assert.ok(result.result);
  assert.equal(result.result.providerId, 'gemini');
  assert.equal(result.result.modelId, 'gemini-4-hydrogen');
  assert.ok(capturedUserPrompt.includes('Hand-thrown Stoneware Pitcher'));
  assert.ok(capturedUserPrompt.includes('Back mark hidden from view'));
  assert.ok(capturedSystemInstruction.includes('DO NOT FABRICATE') || capturedUserPrompt.includes('DO NOT FABRICATE'));
  assert.ok(capturedSystemInstruction.includes('SUBJECT PRESERVATION'));
  assert.equal(JSON.stringify(result).includes(secretValue), false);
});

test('GeminiPromptComposerProvider rejects missing server credentials without leaking secrets', async () => {
  const provider = new GeminiPromptComposerProvider({
    getEnv: () => ({
      GEMINI_MODEL_ID: 'gemini-4-hydrogen',
    }),
  });

  const result = await provider.synthesizeMasterPrompt(makeValidProviderInput());
  assert.equal(result.result, undefined);
  assert.ok(result.mappedError);
  assert.equal(result.mappedError.category, 'MISSING_CREDENTIAL');
});

test('buildGeminiSynthesisUserPrompt includes authoritative description, creative direction, preferences, and pre-detected conflicts', () => {
  const promptText = buildGeminiSynthesisUserPrompt(
    makeValidProviderInput({
      detectedInputConflicts: [
        'Monochrome palette cues conflict with vibrant multi-color directives.',
      ],
    }),
  );

  assert.ok(promptText.includes('Description Revision: v2'));
  assert.ok(promptText.includes('Style Name: Editorial Ink & Watercolor'));
  assert.ok(promptText.includes('Aspect Ratio: 3:4'));
  assert.ok(promptText.includes('Monochrome palette cues conflict'));
});

test('POST /api/prompts/synthesize enforces text-only & credential security boundaries end-to-end', async () => {
  const secretValue = 'AIzaServerOnlyPromptComposerSecret999999';
  const registry = createServerProviderRegistry({
    geminiPromptComposer: {
      getEnv: () => ({
        GEMINI_API_KEY: secretValue,
        GEMINI_MODEL_ID: 'gemini-4-hydrogen',
      }),
      createSdkClient: () => ({
        models: {
          async generateContent() {
            return {
              text: JSON.stringify({
                generatedPrompt:
                  'Editorial watercolor study of a matte cream stoneware pitcher with cobalt rim band.',
                negativePrompt: 'harsh neon',
                unresolvedConflicts: [],
              }),
              candidates: [{ finishReason: 'STOP' }],
            };
          },
        },
      }),
    },
  });

  const app = createServerApp({ registry });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const validBody = makeValidProviderInput();

    // 1. Valid text-only request succeeds with 200 and zero credential leak
    const okRes = await fetch(`${baseUrl}/api/prompts/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    assert.equal(okRes.status, 200);
    const okJsonText = await okRes.text();
    assert.equal(okJsonText.includes(secretValue), false);
    const okJson = JSON.parse(okJsonText) as {
      ok: boolean;
      data?: { generatedPrompt: string };
    };
    assert.equal(okJson.ok, true);
    assert.ok(okJson.data?.generatedPrompt.includes('stoneware pitcher'));

    // 2. Rejects sourceImage / base64 payloads with 403 SECURITY_BOUNDARY_VIOLATION
    const imageRes = await fetch(`${baseUrl}/api/prompts/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...validBody,
        sourceImage: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
      }),
    });
    assert.equal(imageRes.status, 403);
    const imageJson = (await imageRes.json()) as {
      ok: boolean;
      error?: { code: string };
    };
    assert.equal(imageJson.ok, false);
    assert.equal(imageJson.error?.code, 'SECURITY_BOUNDARY_VIOLATION');

    // 3. Rejects sourceAssetId in synthesis payload with 403 SECURITY_BOUNDARY_VIOLATION
    const assetFkRes = await fetch(`${baseUrl}/api/prompts/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...validBody,
        subject: {
          ...validBody.subject,
          sourceAssetId: 'src_12345678',
        },
      }),
    });
    assert.equal(assetFkRes.status, 403);

    // 4. Rejects client-supplied credentials with 403 SECURITY_BOUNDARY_VIOLATION
    const credRes = await fetch(`${baseUrl}/api/prompts/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...validBody,
        apiKey: 'client-supplied-secret',
      }),
    });
    assert.equal(credRes.status, 403);

    // 5. Rejects incomplete description with 400 VALIDATION_ERROR
    const invalidRes = await fetch(`${baseUrl}/api/prompts/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...validBody,
        subject: {
          ...validBody.subject,
          objectName: '   ',
        },
      }),
    });
    assert.equal(invalidRes.status, 400);

    // 6. Rejects GET with 405
    const getRes = await fetch(`${baseUrl}/api/prompts/synthesize`);
    assert.equal(getRes.status, 405);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test('GeminiPromptComposerProvider retries transient 503 errors with backoff and preserves User-Agent header', async () => {
  const secretValue = 'AIzaTestPromptRetryKey1234567890';
  let attempts = 0;
  let capturedHeaders: Record<string, string> | undefined;

  const provider = new GeminiPromptComposerProvider({
    getEnv: () => ({
      GEMINI_API_KEY: secretValue,
      GEMINI_MODEL_ID: 'gemini-4-hydrogen',
    }),
    retryBaseDelayMs: 5,
    maxRetries: 2,
    createSdkClient: () => ({
      models: {
        async generateContent(params) {
          attempts += 1;
          capturedHeaders = params.config?.httpOptions?.headers;
          if (attempts === 1) {
            throw { status: 503, message: 'Service temporarily unavailable' };
          }
          return {
            text: JSON.stringify({
              generatedPrompt:
                'Editorial watercolor study of a matte cream stoneware pitcher with cobalt rim band.',
              negativePrompt: 'harsh neon',
              unresolvedConflicts: [],
            }),
            candidates: [{ finishReason: 'STOP' }],
          };
        },
      },
    }),
  });

  const result = await provider.synthesizeMasterPrompt(makeValidProviderInput());
  assert.equal(attempts, 2);
  assert.equal(result.mappedError, undefined);
  assert.ok(result.result);
  assert.equal(capturedHeaders?.['User-Agent'], 'aistudio-build');
});


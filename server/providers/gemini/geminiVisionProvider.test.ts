import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { ThinkingLevel } from '@google/genai';
import sharp from 'sharp';
import { createServerApp } from '../../../server.ts';
import {
  GEMINI_VISION_TRANSIENT_FAST_INLINE_BYTES,
  prepareTransientVisionPayload,
} from '../../services/visionPayloadOptimizer.ts';
import { createServerProviderRegistry } from '../providerRegistry.ts';
import {
  DEFAULT_GEMINI_VISION_MODEL_ID,
  resolveGeminiPublicConfiguration,
} from './config.ts';
import {
  GeminiConfigurationError,
  GeminiSdkInitializationError,
  mapGeminiProviderError,
} from './errorMapper.ts';
import {
  createGeminiVisionProvider,
  GEMINI_VISION_INITIAL_INSTRUCTION,
  type GeminiGenerateContentParams,
  type GeminiGenerateContentResponseLike,
  type GeminiSdkClient,
} from './geminiVisionProvider.ts';

const TEST_SECRET_KEY = 'AIzaSyTestFakeSecretKey9876543210ABCDEF';

function createValidPngBytes(width = 320, height = 320): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(64));
  // PNG magic + IHDR chunk
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8);
  bytes[16] = (width >>> 24) & 0xff;
  bytes[17] = (width >>> 16) & 0xff;
  bytes[18] = (width >>> 8) & 0xff;
  bytes[19] = width & 0xff;
  bytes[20] = (height >>> 24) & 0xff;
  bytes[21] = (height >>> 16) & 0xff;
  bytes[22] = (height >>> 8) & 0xff;
  bytes[23] = height & 0xff;
  return bytes;
}

function createValidJpegBytes(): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(48));
  bytes.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46], 0);
  bytes[46] = 0xff;
  bytes[47] = 0xd9;
  return bytes;
}

function createValidWebpBytes(): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(48));
  // RIFF .... WEBP VP8 
  bytes.set([0x52, 0x49, 0x46, 0x46, 0x28, 0x00, 0x00, 0x00], 0);
  bytes.set([0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20], 8);
  return bytes;
}

function createMockSdkClient(
  handler: (params: { model: string; config?: { abortSignal?: AbortSignal } }) => Promise<unknown>,
  generateHandler?: (
    params: GeminiGenerateContentParams,
  ) => Promise<GeminiGenerateContentResponseLike>,
): GeminiSdkClient {
  return {
    models: {
      get: handler,
      generateContent:
        generateHandler ??
        (async () => ({
          text: 'Mock visual analysis: ceramic pitcher with matte glaze.',
          modelVersion: 'gemini-4-hydrogen-001',
          responseId: 'resp_mock_123',
        })),
    },
  };
}

test('resolveGeminiPublicConfiguration treats missing and placeholder credentials as unconfigured', () => {
  const missing = resolveGeminiPublicConfiguration({});
  assert.equal(missing.credentialConfigured, false);
  assert.equal(missing.modelConfigured, true);
  assert.equal(missing.modelId, DEFAULT_GEMINI_VISION_MODEL_ID);
  assert.equal(missing.errorCategory, 'MISSING_CREDENTIAL');

  const placeholder = resolveGeminiPublicConfiguration({
    GEMINI_API_KEY: 'MY_GEMINI_API_KEY',
  });
  assert.equal(placeholder.credentialConfigured, false);

  const blank = resolveGeminiPublicConfiguration({
    GEMINI_API_KEY: '   ',
  });
  assert.equal(blank.credentialConfigured, false);
});

test('resolveGeminiPublicConfiguration rejects empty, malformed, and deprecated GEMINI_MODEL_ID values', () => {
  const emptyModel = resolveGeminiPublicConfiguration({
    GEMINI_API_KEY: TEST_SECRET_KEY,
    GEMINI_MODEL_ID: '   ',
  });
  assert.equal(emptyModel.modelConfigured, false);
  assert.equal(emptyModel.errorCategory, 'INVALID_MODEL_CONFIGURATION');

  const malformed = resolveGeminiPublicConfiguration({
    GEMINI_API_KEY: TEST_SECRET_KEY,
    GEMINI_MODEL_ID: 'https://evil.example/model',
  });
  assert.equal(malformed.modelConfigured, false);
  assert.equal(malformed.errorCategory, 'INVALID_MODEL_CONFIGURATION');

  const deprecated = resolveGeminiPublicConfiguration({
    GEMINI_API_KEY: TEST_SECRET_KEY,
    GEMINI_MODEL_ID: 'gemini-1.5-flash',
  });
  assert.equal(deprecated.modelConfigured, false);
  assert.equal(deprecated.errorCategory, 'INVALID_MODEL_CONFIGURATION');

  const valid = resolveGeminiPublicConfiguration({
    GEMINI_API_KEY: TEST_SECRET_KEY,
    GEMINI_MODEL_ID: 'gemini-4-hydrogen',
  });
  assert.equal(valid.credentialConfigured, true);
  assert.equal(valid.modelConfigured, true);
  assert.equal(valid.modelId, 'gemini-4-hydrogen');
  assert.equal(JSON.stringify(valid).includes(TEST_SECRET_KEY), false);
});

test('GeminiVisionProvider status distinguishes NOT_CONFIGURED, CONFIGURED, INITIALIZED, and CONNECTIVITY_VERIFIED', async () => {
  const unconfigured = createGeminiVisionProvider({
    getEnv: () => ({}),
  });
  const unconfiguredStatus = unconfigured.getStatus();
  assert.equal(unconfiguredStatus.initializationStatus, 'NOT_CONFIGURED');
  assert.equal(unconfiguredStatus.errorCategory, 'MISSING_CREDENTIAL');
  assert.equal(unconfiguredStatus.connectivityChecked, false);
  assert.equal(unconfiguredStatus.capabilitiesPendingVerification, true);

  let getCallCount = 0;
  let lastRequestedModel = '';
  const initialized = createGeminiVisionProvider({
    getEnv: () => ({
      GEMINI_API_KEY: TEST_SECRET_KEY,
      GEMINI_MODEL_ID: 'gemini-4-hydrogen',
    }),
    createSdkClient: () =>
      createMockSdkClient(async (params) => {
        getCallCount += 1;
        lastRequestedModel = params.model;
        return { name: `models/${params.model}` };
      }),
  });

  const configOnlyStatus = initialized.getConfigurationStatus();
  assert.equal(configOnlyStatus.initializationStatus, 'CONFIGURED');

  const preVerifyStatus = initialized.getStatus();
  assert.equal(preVerifyStatus.initializationStatus, 'INITIALIZED');
  assert.equal(preVerifyStatus.connectivityChecked, false);
  assert.equal(preVerifyStatus.capabilitiesPendingVerification, true);
  assert.equal(getCallCount, 0);
  assert.equal(JSON.stringify(preVerifyStatus).includes(TEST_SECRET_KEY), false);

  const authCtx = initialized.resolveAuthContext();
  assert.equal(authCtx.isConfigured, true);
  assert.equal(JSON.stringify(authCtx).includes(TEST_SECRET_KEY), false);

  const verifyResult = await initialized.verifyConnectivity();
  assert.equal(verifyResult.mappedError, undefined);
  assert.equal(getCallCount, 1);
  assert.equal(lastRequestedModel, 'gemini-4-hydrogen');
  assert.equal(verifyResult.status.initializationStatus, 'CONNECTIVITY_VERIFIED');
  assert.equal(verifyResult.status.connectivityChecked, true);
  assert.equal(verifyResult.status.capabilitiesPendingVerification, false);
  assert.ok(verifyResult.status.lastCheckedAt);
  assert.equal(JSON.stringify(verifyResult).includes(TEST_SECRET_KEY), false);
});

test('GeminiVisionProvider keeps structured Phase 02.3.3 ObjectAnalysis normalization deferred', async () => {
  const provider = createGeminiVisionProvider({
    getEnv: () => ({ GEMINI_API_KEY: TEST_SECRET_KEY }),
  });

  assert.throws(
    () =>
      provider.mapRequest({
        sourceAssetId: 'src_123',
        mimeType: 'image/png',
        imageBytes: new Uint8Array([1, 2, 3]),
        modelId: 'gemini-4-hydrogen',
      }),
    /Phase 02\.3\.3/,
  );

  const execRes = await provider.execute({
    sourceAssetId: 'src_123',
    mimeType: 'image/png',
    imageBytes: new Uint8Array([1, 2, 3]),
    modelId: 'gemini-4-hydrogen',
  });
  assert.equal(execRes.ok, false);
  if (!execRes.ok) {
    assert.equal(execRes.error.code, 'NOT_IMPLEMENTED');
  }
});

test('GeminiVisionProvider.analyzeRawImage supplies image bytes, MIME type, server model, and initial instruction', async () => {
  const pngBytes = createValidPngBytes(400, 300);
  let capturedParams: GeminiGenerateContentParams | null = null;

  const provider = createGeminiVisionProvider({
    getEnv: () => ({
      GEMINI_API_KEY: TEST_SECRET_KEY,
      GEMINI_MODEL_ID: 'gemini-4-hydrogen',
    }),
    createSdkClient: () =>
      createMockSdkClient(
        async () => ({ name: 'models/gemini-4-hydrogen' }),
        async (params) => {
          capturedParams = params;
          return {
            text: 'A matte ceramic pitcher photographed at a slight three-quarter angle against a neutral wall.',
            modelVersion: 'gemini-4-hydrogen-001',
            responseId: 'resp_vision_001',
            candidates: [{ finishReason: 'STOP' }],
            usageMetadata: {
              promptTokenCount: 280,
              candidatesTokenCount: 42,
              totalTokenCount: 322,
            },
          };
        },
      ),
  });

  const outcome = await provider.analyzeRawImage({
    projectId: 'prj_12345678',
    sourceAssetId: 'src_12345678',
    mimeType: 'image/png',
    imageBytes: pngBytes,
  });

  assert.equal(outcome.mappedError, undefined);
  assert.ok(outcome.result);
  assert.ok(capturedParams);

  const sent = capturedParams as GeminiGenerateContentParams;
  assert.equal(sent.model, 'gemini-4-hydrogen');
  assert.equal(sent.contents.parts.length, 2);

  const imagePart = sent.contents.parts[0];
  const textPart = sent.contents.parts[1];
  assert.ok('inlineData' in imagePart);
  assert.equal(imagePart.inlineData.mimeType, 'image/png');
  assert.deepEqual(
    Buffer.from(imagePart.inlineData.data, 'base64'),
    Buffer.from(pngBytes),
  );
  assert.ok('text' in textPart);
  assert.equal(textPart.text, GEMINI_VISION_INITIAL_INSTRUCTION);
  assert.equal(sent.config?.thinkingConfig?.thinkingLevel, ThinkingLevel.LOW);
  assert.equal(sent.config?.httpOptions?.timeout, 60000);

  assert.equal(outcome.result.requestStatus, 'succeeded');
  assert.equal(outcome.result.providerId, 'gemini');
  assert.equal(outcome.result.modelId, 'gemini-4-hydrogen');
  assert.equal(outcome.result.modelVersion, 'gemini-4-hydrogen-001');
  assert.equal(outcome.result.responseId, 'resp_vision_001');
  assert.equal(outcome.result.finishReason, 'STOP');
  assert.equal(outcome.result.usageMetadata?.totalTokenCount, 322);
  assert.equal(JSON.stringify(outcome).includes(TEST_SECRET_KEY), false);
});

test('prepareTransientVisionPayload leaves <= 2 MiB images untouched and optimizes > 2 MiB 4096x4096 PNGs below 2 MiB without mutating input', async () => {
  const smallBytes = createValidPngBytes(512, 512);
  const smallResult = await prepareTransientVisionPayload({
    mimeType: 'image/png',
    imageBytes: smallBytes,
  });
  assert.equal(smallResult.optimized, false);
  assert.equal(smallResult.mimeType, 'image/png');
  assert.equal(smallResult.imageBytes, smallBytes);

  // Build a real > 2 MiB 4096x4096 noisy PNG in memory via sharp
  const width = 4096;
  const height = 4096;
  const rawRgba = Buffer.alloc(width * height * 4);
  let seed = 424242;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      if (y < 2400) {
        rawRgba[idx] = 243;
        rawRgba[idx + 1] = 240;
        rawRgba[idx + 2] = 232;
        rawRgba[idx + 3] = 255;
      } else {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        rawRgba[idx] = 140 + (seed & 100);
        rawRgba[idx + 1] = 135 + ((seed >>> 8) & 100);
        rawRgba[idx + 2] = 125 + ((seed >>> 16) & 100);
        rawRgba[idx + 3] = 255;
      }
    }
  }
  const bigPngBuffer = await sharp(rawRgba, {
    raw: { width, height, channels: 4 },
  })
    .png({ compressionLevel: 1 })
    .toBuffer();
  assert.ok(bigPngBuffer.byteLength > GEMINI_VISION_TRANSIENT_FAST_INLINE_BYTES);
  const originalSnapshot = Uint8Array.from(bigPngBuffer.subarray(0, 32));

  const bigInput = new Uint8Array(
    bigPngBuffer.buffer,
    bigPngBuffer.byteOffset,
    bigPngBuffer.byteLength,
  );
  const optimizedResult = await prepareTransientVisionPayload({
    mimeType: 'image/png',
    imageBytes: bigInput,
  });

  assert.equal(optimizedResult.optimized, true);
  assert.ok(
    optimizedResult.imageBytes.byteLength <=
      GEMINI_VISION_TRANSIENT_FAST_INLINE_BYTES,
  );
  assert.ok(
    optimizedResult.mimeType === 'image/webp' ||
      optimizedResult.mimeType === 'image/jpeg',
  );
  // Original input bytes remain untouched
  assert.deepEqual(
    Uint8Array.from(bigInput.subarray(0, 32)),
    originalSnapshot,
  );
});

test('GeminiVisionProvider.analyzeRawImage handles empty, blocked, and upstream error responses safely', async () => {
  const pngBytes = createValidPngBytes();

  const emptyProvider = createGeminiVisionProvider({
    getEnv: () => ({ GEMINI_API_KEY: TEST_SECRET_KEY }),
    createSdkClient: () =>
      createMockSdkClient(
        async () => ({}),
        async () => ({ text: '   ' }),
      ),
  });
  const emptyOutcome = await emptyProvider.analyzeRawImage({
    projectId: 'prj_12345678',
    sourceAssetId: 'src_12345678',
    mimeType: 'image/png',
    imageBytes: pngBytes,
  });
  assert.ok(emptyOutcome.mappedError);
  assert.equal(emptyOutcome.mappedError.httpStatus, 502);
  assert.equal(emptyOutcome.mappedError.retryable, true);

  const blockedProvider = createGeminiVisionProvider({
    getEnv: () => ({ GEMINI_API_KEY: TEST_SECRET_KEY }),
    createSdkClient: () =>
      createMockSdkClient(
        async () => ({}),
        async () => ({
          promptFeedback: {
            blockReason: 'SAFETY',
            blockReasonMessage: 'Blocked by provider safety policy.',
          },
        }),
      ),
  });
  const blockedOutcome = await blockedProvider.analyzeRawImage({
    projectId: 'prj_12345678',
    sourceAssetId: 'src_12345678',
    mimeType: 'image/png',
    imageBytes: pngBytes,
  });
  assert.ok(blockedOutcome.mappedError);
  assert.match(blockedOutcome.mappedError.message, /safety/i);

  const authFailProvider = createGeminiVisionProvider({
    getEnv: () => ({ GEMINI_API_KEY: TEST_SECRET_KEY }),
    createSdkClient: () =>
      createMockSdkClient(
        async () => ({}),
        async () => {
          throw { status: 401, message: `API_KEY_INVALID (${TEST_SECRET_KEY})` };
        },
      ),
  });
  const authOutcome = await authFailProvider.analyzeRawImage({
    projectId: 'prj_12345678',
    sourceAssetId: 'src_12345678',
    mimeType: 'image/png',
    imageBytes: pngBytes,
  });
  assert.ok(authOutcome.mappedError);
  assert.equal(authOutcome.mappedError.category, 'AUTHENTICATION_FAILURE');
  assert.equal(authOutcome.mappedError.message.includes(TEST_SECRET_KEY), false);
});

test('mapGeminiProviderError categorizes all failure modes and strips secret material', () => {
  const cases: ReadonlyArray<{
    readonly err: unknown;
    readonly expectedCategory: string;
  }> = [
    {
      err: new GeminiConfigurationError('MISSING_CREDENTIAL', 'Missing key'),
      expectedCategory: 'MISSING_CREDENTIAL',
    },
    {
      err: new GeminiConfigurationError('INVALID_CONFIGURATION', 'Bad config'),
      expectedCategory: 'INVALID_CONFIGURATION',
    },
    {
      err: new GeminiConfigurationError('INVALID_MODEL_CONFIGURATION', 'Bad model'),
      expectedCategory: 'INVALID_MODEL_CONFIGURATION',
    },
    {
      err: new GeminiSdkInitializationError(`SDK crash with ${TEST_SECRET_KEY}`),
      expectedCategory: 'SDK_INITIALIZATION_FAILURE',
    },
    {
      err: { status: 401, message: `API_KEY_INVALID for key=${TEST_SECRET_KEY}` },
      expectedCategory: 'AUTHENTICATION_FAILURE',
    },
    {
      err: { status: 403, message: 'PERMISSION_DENIED on model' },
      expectedCategory: 'PERMISSION_FAILURE',
    },
    {
      err: { status: 429, message: 'RESOURCE_EXHAUSTED quota exceeded' },
      expectedCategory: 'RATE_LIMIT',
    },
    {
      err: { status: 503, message: 'Service temporarily unavailable' },
      expectedCategory: 'PROVIDER_UNAVAILABLE',
    },
    {
      err: new Error('Request timed out after 8000ms'),
      expectedCategory: 'NETWORK_TIMEOUT',
    },
    {
      err: new Error(`Unexpected fault containing ${TEST_SECRET_KEY}\n    at stackFrame`),
      expectedCategory: 'UNKNOWN_PROVIDER_ERROR',
    },
  ];

  for (const item of cases) {
    const mapped = mapGeminiProviderError(item.err, [TEST_SECRET_KEY]);
    assert.equal(mapped.category, item.expectedCategory);
    assert.equal(mapped.message.includes(TEST_SECRET_KEY), false);
    assert.equal(mapped.message.includes('stackFrame'), false);
  }
});

test('Express routes expose safe status/verify endpoints and enforce method and boundary rules', async () => {
  const registry = createServerProviderRegistry({
    gemini: {
      getEnv: () => ({
        GEMINI_API_KEY: TEST_SECRET_KEY,
        GEMINI_MODEL_ID: 'gemini-4-hydrogen',
      }),
      createSdkClient: () =>
        createMockSdkClient(async (params) => ({
          name: `models/${params.model}`,
        })),
    },
  });

  const app = createServerApp({ registry });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const statusRes = await fetch(`${baseUrl}/api/providers/gemini/status`);
    assert.equal(statusRes.status, 200);
    const statusText = await statusRes.text();
    assert.equal(statusText.includes(TEST_SECRET_KEY), false);
    const statusJson = JSON.parse(statusText) as {
      ok: boolean;
      data: {
        providerId: string;
        modelId: string;
        initializationStatus: string;
      };
    };
    assert.equal(statusJson.ok, true);
    assert.equal(statusJson.data.providerId, 'gemini');
    assert.equal(statusJson.data.modelId, 'gemini-4-hydrogen');
    assert.equal(statusJson.data.initializationStatus, 'INITIALIZED');

    const badMethodStatus = await fetch(`${baseUrl}/api/providers/gemini/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(badMethodStatus.status, 405);

    const injectedKeyRes = await fetch(`${baseUrl}/api/providers/gemini/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: 'client-supplied-key' }),
    });
    assert.equal(injectedKeyRes.status, 403);

    const injectedEndpointRes = await fetch(`${baseUrl}/api/providers/gemini/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: 'https://attacker.example' }),
    });
    assert.equal(injectedEndpointRes.status, 400);

    const verifyRes = await fetch(`${baseUrl}/api/providers/gemini/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(verifyRes.status, 200);
    const verifyText = await verifyRes.text();
    assert.equal(verifyText.includes(TEST_SECRET_KEY), false);
    const verifyJson = JSON.parse(verifyText) as {
      ok: boolean;
      data: {
        initializationStatus: string;
        connectivityChecked: boolean;
      };
    };
    assert.equal(verifyJson.ok, true);
    assert.equal(verifyJson.data.initializationStatus, 'CONNECTIVITY_VERIFIED');
    assert.equal(verifyJson.data.connectivityChecked, true);

    const deferredVisionRes = await fetch(`${baseUrl}/api/v1/object-identification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'prj_12345678',
        sourceAssetId: 'src_12345678',
        mimeType: 'image/png',
        providerConfigRef: {
          providerId: 'gemini',
          modelId: 'gemini-4-hydrogen',
        },
      }),
    });
    assert.equal(deferredVisionRes.status, 501);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test('POST /api/vision/analyze validates multipart binary uploads, rejects bad/boundary inputs, and forwards clean image bytes to Gemini', async () => {
  const capturedUploads: GeminiGenerateContentParams[] = [];

  const registry = createServerProviderRegistry({
    gemini: {
      getEnv: () => ({
        GEMINI_API_KEY: TEST_SECRET_KEY,
        GEMINI_MODEL_ID: 'gemini-4-hydrogen',
      }),
      createSdkClient: () =>
        createMockSdkClient(
          async () => ({ name: 'models/gemini-4-hydrogen' }),
          async (params) => {
            capturedUploads.push(params);
            return {
              text: 'Observed metallic teapot on linen cloth.',
              modelVersion: 'gemini-4-hydrogen',
              responseId: 'resp_http_001',
              usageMetadata: {
                promptTokenCount: 256,
                candidatesTokenCount: 18,
                totalTokenCount: 274,
              },
            };
          },
        ),
    },
  });

  const app = createServerApp({ registry });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    // 1. Valid JPEG, PNG, and WebP multipart requests
    const formatCases: ReadonlyArray<{
      readonly name: string;
      readonly mime: 'image/jpeg' | 'image/png' | 'image/webp';
      readonly bytes: Uint8Array<ArrayBuffer>;
    }> = [
      { name: 'study.jpg', mime: 'image/jpeg', bytes: createValidJpegBytes() },
      { name: 'study.png', mime: 'image/png', bytes: createValidPngBytes() },
      { name: 'study.webp', mime: 'image/webp', bytes: createValidWebpBytes() },
    ];

    for (const item of formatCases) {
      const form = new FormData();
      form.append('projectId', 'prj_12345678');
      form.append('assetId', 'src_12345678');
      form.append('mimeType', item.mime);
      form.append('image', new Blob([item.bytes], { type: item.mime }), item.name);

      const res = await fetch(`${baseUrl}/api/vision/analyze`, {
        method: 'POST',
        body: form,
      });
      assert.equal(res.status, 200);
      const bodyText = await res.text();
      assert.equal(bodyText.includes(TEST_SECRET_KEY), false);
      const parsed = JSON.parse(bodyText) as {
        ok: boolean;
        data: {
          modelId: string;
          rawText: string;
          projectId: string;
          sourceAssetId: string;
        };
      };
      assert.equal(parsed.ok, true);
      assert.equal(parsed.data.modelId, 'gemini-4-hydrogen');
      assert.equal(parsed.data.projectId, 'prj_12345678');
      assert.equal(parsed.data.sourceAssetId, 'src_12345678');
      assert.match(parsed.data.rawText, /teapot/i);
    }
    assert.equal(capturedUploads.length, 3);

    // 2. Method enforcement (GET -> 405)
    const getRes = await fetch(`${baseUrl}/api/vision/analyze`);
    assert.equal(getRes.status, 405);

    // 3. Non-multipart rejected (415)
    const jsonRes = await fetch(`${baseUrl}/api/vision/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'prj_12345678', assetId: 'src_12345678' }),
    });
    assert.equal(jsonRes.status, 415);

    // 4. Empty binary rejected (400)
    const emptyForm = new FormData();
    emptyForm.append('projectId', 'prj_12345678');
    emptyForm.append('assetId', 'src_12345678');
    emptyForm.append('image', new Blob([], { type: 'image/png' }), 'empty.png');
    const emptyRes = await fetch(`${baseUrl}/api/vision/analyze`, {
      method: 'POST',
      body: emptyForm,
    });
    assert.equal(emptyRes.status, 400);

    // 5. Unsupported MIME rejected (400)
    const gifForm = new FormData();
    gifForm.append('projectId', 'prj_12345678');
    gifForm.append('assetId', 'src_12345678');
    gifForm.append(
      'image',
      new Blob([new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])], {
        type: 'image/gif',
      }),
      'anim.gif',
    );
    const gifRes = await fetch(`${baseUrl}/api/vision/analyze`, {
      method: 'POST',
      body: gifForm,
    });
    assert.equal(gifRes.status, 400);

    // 6. Invalid signature (text disguised as PNG) rejected (400)
    const fakeForm = new FormData();
    fakeForm.append('projectId', 'prj_12345678');
    fakeForm.append('assetId', 'src_12345678');
    fakeForm.append(
      'image',
      new Blob([new TextEncoder().encode('not-a-real-png-binary-payload-at-all')], {
        type: 'image/png',
      }),
      'fake.png',
    );
    const fakeRes = await fetch(`${baseUrl}/api/vision/analyze`, {
      method: 'POST',
      body: fakeForm,
    });
    assert.equal(fakeRes.status, 400);

    // 7. Missing Project ID / Asset ID rejected (400)
    const missingProjectForm = new FormData();
    missingProjectForm.append('assetId', 'src_12345678');
    missingProjectForm.append(
      'image',
      new Blob([createValidPngBytes()], { type: 'image/png' }),
      'study.png',
    );
    const missingProjectRes = await fetch(`${baseUrl}/api/vision/analyze`, {
      method: 'POST',
      body: missingProjectForm,
    });
    assert.equal(missingProjectRes.status, 400);

    const missingAssetForm = new FormData();
    missingAssetForm.append('projectId', 'prj_12345678');
    missingAssetForm.append(
      'image',
      new Blob([createValidPngBytes()], { type: 'image/png' }),
      'study.png',
    );
    const missingAssetRes = await fetch(`${baseUrl}/api/vision/analyze`, {
      method: 'POST',
      body: missingAssetForm,
    });
    assert.equal(missingAssetRes.status, 400);

    // 8. Arbitrary URL input rejected (400)
    const urlForm = new FormData();
    urlForm.append('projectId', 'prj_12345678');
    urlForm.append('assetId', 'src_12345678');
    urlForm.append('imageUrl', 'https://attacker.example/pic.png');
    urlForm.append(
      'image',
      new Blob([createValidPngBytes()], { type: 'image/png' }),
      'study.png',
    );
    const urlRes = await fetch(`${baseUrl}/api/vision/analyze`, {
      method: 'POST',
      body: urlForm,
    });
    assert.equal(urlRes.status, 400);

    // 9. Client-supplied credentials and model overrides rejected (403)
    const credForm = new FormData();
    credForm.append('projectId', 'prj_12345678');
    credForm.append('assetId', 'src_12345678');
    credForm.append('apiKey', 'AIzaSyClientAttemptedOverride123456');
    credForm.append(
      'image',
      new Blob([createValidPngBytes()], { type: 'image/png' }),
      'study.png',
    );
    const credRes = await fetch(`${baseUrl}/api/vision/analyze`, {
      method: 'POST',
      body: credForm,
    });
    assert.equal(credRes.status, 403);

    const modelOverrideForm = new FormData();
    modelOverrideForm.append('projectId', 'prj_12345678');
    modelOverrideForm.append('assetId', 'src_12345678');
    modelOverrideForm.append('modelId', 'gemini-4-carbon');
    modelOverrideForm.append(
      'image',
      new Blob([createValidPngBytes()], { type: 'image/png' }),
      'study.png',
    );
    const modelOverrideRes = await fetch(`${baseUrl}/api/vision/analyze`, {
      method: 'POST',
      body: modelOverrideForm,
    });
    assert.equal(modelOverrideRes.status, 403);

    // 10. Oversized inline image (> 14.5 MB) rejected with 413 without modification
    const oversizedBytes = new Uint8Array(new ArrayBuffer(14_600_000));
    oversizedBytes.set(createValidPngBytes(), 0);
    const oversizedForm = new FormData();
    oversizedForm.append('projectId', 'prj_12345678');
    oversizedForm.append('assetId', 'src_12345678');
    oversizedForm.append(
      'image',
      new Blob([oversizedBytes], { type: 'image/png' }),
      'huge.png',
    );
    const oversizedRes = await fetch(`${baseUrl}/api/vision/analyze`, {
      method: 'POST',
      body: oversizedForm,
    });
    assert.equal(oversizedRes.status, 413);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test('GeminiVisionProvider.analyzeRawImage retries transient 503/network errors with backoff and preserves User-Agent header', async () => {
  const pngBytes = createValidPngBytes();
  let attemptCount = 0;
  let capturedHeaders: Record<string, string> | undefined;

  const recoveringProvider = createGeminiVisionProvider({
    getEnv: () => ({
      GEMINI_API_KEY: TEST_SECRET_KEY,
      GEMINI_MODEL_ID: 'gemini-4-hydrogen',
    }),
    retryBaseDelayMs: 5,
    maxRetries: 2,
    createSdkClient: () =>
      createMockSdkClient(
        async () => ({}),
        async (params) => {
          attemptCount += 1;
          capturedHeaders = params.config?.httpOptions?.headers;
          if (attemptCount === 1) {
            throw {
              status: 503,
              message: '{"error":{"code":503,"message":"The model is overloaded.","status":"UNAVAILABLE"}}',
            };
          }
          if (attemptCount === 2) {
            const fetchErr = new TypeError('fetch failed') as TypeError & {
              cause?: unknown;
            };
            fetchErr.cause = { code: 'ECONNRESET', message: 'socket reset' };
            throw fetchErr;
          }
          return {
            text: 'Recovered visual analysis after transient outage: ceramic bowl.',
            modelVersion: 'gemini-4-hydrogen-001',
          };
        },
      ),
  });

  const recovered = await recoveringProvider.analyzeRawImage({
    projectId: 'prj_12345678',
    sourceAssetId: 'src_12345678',
    mimeType: 'image/png',
    imageBytes: pngBytes,
  });

  assert.equal(attemptCount, 3);
  assert.equal(recovered.mappedError, undefined);
  assert.ok(recovered.result);
  assert.match(recovered.result.rawText, /ceramic bowl/i);
  assert.equal(capturedHeaders?.['User-Agent'], 'aistudio-build');

  // Exhausted retries return PROVIDER_UNAVAILABLE with sanitized diagnosticDetail
  let failAttempts = 0;
  const failingProvider = createGeminiVisionProvider({
    getEnv: () => ({
      GEMINI_API_KEY: TEST_SECRET_KEY,
      GEMINI_MODEL_ID: 'gemini-4-hydrogen',
    }),
    retryBaseDelayMs: 5,
    maxRetries: 2,
    createSdkClient: () =>
      createMockSdkClient(
        async () => ({}),
        async () => {
          failAttempts += 1;
          throw {
            status: 503,
            message: `Service unavailable for key=${TEST_SECRET_KEY}`,
          };
        },
      ),
  });

  const failed = await failingProvider.analyzeRawImage({
    projectId: 'prj_12345678',
    sourceAssetId: 'src_12345678',
    mimeType: 'image/png',
    imageBytes: pngBytes,
  });

  assert.equal(failAttempts, 3);
  assert.ok(failed.mappedError);
  assert.equal(failed.mappedError.category, 'PROVIDER_UNAVAILABLE');
  assert.equal(failed.mappedError.httpStatus, 503);
  assert.equal(failed.mappedError.diagnosticDetail?.includes(TEST_SECRET_KEY), false);

  // External cancellation stops retry backoff immediately
  const abortController = new AbortController();
  let abortedAttempts = 0;
  const cancellableProvider = createGeminiVisionProvider({
    getEnv: () => ({
      GEMINI_API_KEY: TEST_SECRET_KEY,
      GEMINI_MODEL_ID: 'gemini-4-hydrogen',
    }),
    retryBaseDelayMs: 500,
    maxRetries: 2,
    createSdkClient: () =>
      createMockSdkClient(
        async () => ({}),
        async () => {
          abortedAttempts += 1;
          setTimeout(() => abortController.abort(), 15);
          throw { status: 503, message: 'Temporary 503' };
        },
      ),
  });

  const cancelled = await cancellableProvider.analyzeRawImage({
    projectId: 'prj_12345678',
    sourceAssetId: 'src_12345678',
    mimeType: 'image/png',
    imageBytes: pngBytes,
    abortSignal: abortController.signal,
  });
  assert.equal(cancelled.cancelled, true);
  assert.equal(abortedAttempts, 1);
});


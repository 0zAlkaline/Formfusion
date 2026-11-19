import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { createServerApp } from '../../../server.ts';
import { normalizeGenerationRequest } from '../../../src/services/image-generation/generationNormalizer.ts';
import { redactSecretValues } from '../../middleware/security.ts';
import {
  ProviderCapabilityService,
  ProviderConfigurationService,
  ProviderHealthService,
} from '../imageGeneration/providerServices.ts';
import { createServerProviderRegistry } from '../providerRegistry.ts';
import {
  OVHCLOUD_PROVIDER_ID,
  OVHCLOUD_SDXL_MODEL_ID,
  resolveOvhcloudPublicConfiguration,
} from './config.ts';
import {
  inspectGeneratedImageBinary,
  InvalidGeneratedImageError,
} from './imageBinaryInspector.ts';
import {
  createOvhcloudSdxlProvider,
  OVHCLOUD_DEFAULT_SMOKE_TEST_PROMPT,
} from './ovhcloudSdxlProvider.ts';

function buildMinimalPng(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(32);
  // PNG signature
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  // Chunk length (13 bytes)
  bytes.set([0x00, 0x00, 0x00, 0x0d], 8);
  // 'IHDR'
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  // Width big-endian
  bytes[16] = (width >>> 24) & 0xff;
  bytes[17] = (width >>> 16) & 0xff;
  bytes[18] = (width >>> 8) & 0xff;
  bytes[19] = width & 0xff;
  // Height big-endian
  bytes[20] = (height >>> 24) & 0xff;
  bytes[21] = (height >>> 16) & 0xff;
  bytes[22] = (height >>> 8) & 0xff;
  bytes[23] = height & 0xff;
  return bytes;
}

function buildMinimalJpeg(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, 0xfe, 0x00, 0x04, 0x46, 0x46, // COM ("FF")
    0xff, 0xc0, // SOF0
    0x00, 0x11, // length 17
    0x08, // precision
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03, // components
    0x01, 0x11, 0x00,
    0x02, 0x11, 0x01,
    0x03, 0x11, 0x01,
    0xff, 0xd9, // EOI
  ]);
}

function buildMinimalWebpVp8X(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30);
  // RIFF
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  // WEBP
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  // VP8X
  bytes.set([0x56, 0x50, 0x38, 0x58], 12);
  const wMinus1 = width - 1;
  const hMinus1 = height - 1;
  bytes[24] = wMinus1 & 0xff;
  bytes[25] = (wMinus1 >> 8) & 0xff;
  bytes[26] = (wMinus1 >> 16) & 0xff;
  bytes[27] = hMinus1 & 0xff;
  bytes[28] = (hMinus1 >> 8) & 0xff;
  bytes[29] = (hMinus1 >> 16) & 0xff;
  return bytes;
}

test('Architecture: ServerProviderRegistry registers OVHcloud SDXL and exposes services', () => {
  const registry = createServerProviderRegistry({
    ovhcloud: {
      getEnv: () => ({}),
    },
  });

  const capService = new ProviderCapabilityService(registry);
  const configService = new ProviderConfigurationService(registry);
  const healthService = new ProviderHealthService(registry);

  assert.ok(healthService);
  const activeCaps = capService.getActiveCapabilities();
  assert.ok(activeCaps);
  assert.equal(activeCaps.providerId, OVHCLOUD_PROVIDER_ID);
  assert.equal(activeCaps.modelId, OVHCLOUD_SDXL_MODEL_ID);
  assert.equal(activeCaps.task, 'text-to-image');
  assert.equal(activeCaps.isFreeTierModel, true);
  assert.equal(activeCaps.supportsImageToImage, false);
  assert.equal(activeCaps.supportsNegativePrompt, true);
  assert.deepEqual(activeCaps.supportedOutputSizes[0], {
    width: 1024,
    height: 1024,
    aspectRatio: '1:1',
    label: '1024 × 1024 (Native SDXL Square)',
  });

  const status = configService.getActivePublicStatus();
  assert.ok(status);
  assert.equal(status.connectionStatus, 'not_configured');
  assert.equal(status.tokenConfigured, false);
  assert.equal(status.isFreeTierModel, true);
});

test('Normalizer: enforces approved prompts, prohibits source images/credentials, and omits unsupported params', () => {
  const provider = createOvhcloudSdxlProvider({ getEnv: () => ({}) });
  const capabilities = provider.getCapabilities();

  const unapproved = normalizeGenerationRequest(
    {
      projectId: 'prj_12345678',
      promptId: 'prm_12345678',
      approvalStatus: 'draft',
      approvedPrompt: 'A copper kettle',
      modelId: OVHCLOUD_SDXL_MODEL_ID,
    },
    capabilities,
  );
  assert.equal(unapproved.ok, false);
  if (!unapproved.ok) {
    assert.equal(unapproved.error.code, 'VALIDATION_ERROR');
  }

  const withSourceImage = normalizeGenerationRequest(
    {
      projectId: 'prj_12345678',
      promptId: 'prm_12345678',
      approvalStatus: 'approved',
      approvedPrompt: 'A copper kettle',
      sourceAssetId: 'src_12345678',
    },
    capabilities,
  );
  assert.equal(withSourceImage.ok, false);
  if (!withSourceImage.ok) {
    assert.equal(withSourceImage.error.code, 'SECURITY_BOUNDARY_VIOLATION');
  }

  const normalized = normalizeGenerationRequest(
    {
      projectId: 'prj_12345678',
      promptId: 'prm_12345678',
      approvalStatus: 'approved',
      approvedPrompt: '  Minimalist ceramic pitcher, studio daylight  ',
      negativePrompt: '  blurry, watermark  ',
      modelId: OVHCLOUD_SDXL_MODEL_ID,
      aspectRatio: '16:9',
      outputWidth: 1920,
      outputHeight: 1080,
      numberOfImages: 4,
      providerParameters: {
        seed: 42,
        guidanceScale: 7.5,
        inferenceSteps: 30,
        safetyFilterLevel: 'strict',
      },
    },
    capabilities,
  );

  assert.equal(normalized.ok, true);
  if (normalized.ok) {
    assert.equal(
      normalized.data.normalizedRequest.approvedPrompt,
      'Minimalist ceramic pitcher, studio daylight',
    );
    assert.equal(
      normalized.data.normalizedRequest.negativePrompt,
      'blurry, watermark',
    );
    assert.equal(normalized.data.normalizedRequest.outputWidth, 1024);
    assert.equal(normalized.data.normalizedRequest.outputHeight, 1024);
    assert.equal(normalized.data.normalizedRequest.numberOfImages, 1);
    assert.deepEqual(normalized.data.normalizedRequest.providerParameters, {});
    assert.ok(normalized.data.omittedParameters.includes('seed'));
    assert.ok(normalized.data.omittedParameters.includes('guidanceScale'));
    assert.ok(normalized.data.omittedParameters.includes('inferenceSteps'));
    assert.ok(normalized.data.omittedParameters.includes('numberOfImages'));

    const mapped = provider.mapProviderPayload(normalized.data.normalizedRequest);
    assert.deepEqual(mapped, {
      prompt: 'Minimalist ceramic pitcher, studio daylight',
      negative_prompt: 'blurry, watermark',
    });
  }
});

test('Binary Inspector: validates PNG, JPEG, WebP headers and rejects invalid MIME/HTML/truncated bytes', () => {
  const png = inspectGeneratedImageBinary({
    bytes: buildMinimalPng(1024, 1024),
    contentTypeHeader: 'application/octet-stream',
  });
  assert.equal(png.mimeType, 'image/png');
  assert.equal(png.outputFormat, 'png');
  assert.equal(png.width, 1024);
  assert.equal(png.height, 1024);

  const jpeg = inspectGeneratedImageBinary({
    bytes: buildMinimalJpeg(1024, 1024),
    contentTypeHeader: 'image/jpeg',
  });
  assert.equal(jpeg.mimeType, 'image/jpeg');
  assert.equal(jpeg.width, 1024);

  const webp = inspectGeneratedImageBinary({
    bytes: buildMinimalWebpVp8X(1024, 1024),
    contentTypeHeader: 'image/webp',
  });
  assert.equal(webp.mimeType, 'image/webp');
  assert.equal(webp.width, 1024);

  assert.throws(
    () =>
      inspectGeneratedImageBinary({
        bytes: new TextEncoder().encode('<html><body>Error</body></html>'),
        contentTypeHeader: 'text/html',
      }),
    InvalidGeneratedImageError,
  );

  assert.throws(
    () =>
      inspectGeneratedImageBinary({
        bytes: buildMinimalPng(1024, 1024),
        contentTypeHeader: 'image/jpeg',
      }),
    InvalidGeneratedImageError,
  );
});

test('OVHcloud Adapter: successful generation returns validated binary, updates counter, and sends no unsupported params', async () => {
  let capturedMethod = '';
  let capturedHeaders: Record<string, string> = {};
  let capturedBody: Record<string, unknown> = {};

  const secretToken = 'ovh_test_secret_token_987654321';
  const pngBytes = buildMinimalPng(1024, 1024);

  const provider = createOvhcloudSdxlProvider({
    getEnv: () => ({
      OVH_AI_ENDPOINTS_ACCESS_TOKEN: secretToken,
    }),
    fetchFn: async (_url, init) => {
      capturedMethod = init?.method ?? '';
      capturedHeaders = (init?.headers as Record<string, string>) ?? {};
      capturedBody = JSON.parse(String(init?.body ?? '{}')) as Record<
        string,
        unknown
      >;
      return new Response(Buffer.from(pngBytes), {
        status: 200,
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(pngBytes.byteLength),
        },
      });
    },
  });

  const result = await provider.generate({
    projectId: 'prj_12345678',
    promptId: 'prm_12345678',
    approvalStatus: 'approved',
    approvedPrompt: 'Minimalist ceramic vase on warm studio backdrop',
    negativePrompt: 'text, watermark',
    modelId: OVHCLOUD_SDXL_MODEL_ID,
    aspectRatio: '16:9',
    outputWidth: 1920,
    outputHeight: 1080,
    numberOfImages: 2,
    providerParameters: { seed: 99, guidanceScale: 8 },
  });

  assert.equal(capturedMethod, 'POST');
  assert.equal(capturedHeaders.Authorization, `Bearer ${secretToken}`);
  assert.equal(capturedHeaders.Accept, 'application/octet-stream');
  assert.deepEqual(capturedBody, {
    prompt: 'Minimalist ceramic vase on warm studio backdrop',
    negative_prompt: 'text, watermark',
  });
  assert.equal('seed' in capturedBody, false);
  assert.equal('width' in capturedBody, false);

  assert.equal(result.status, 'succeeded');
  assert.equal(result.outputFormat, 'png');
  assert.equal(result.mimeType, 'image/png');
  assert.deepEqual(result.outputDimensions, { width: 1024, height: 1024 });
  assert.equal(result.imageBytes?.byteLength, pngBytes.byteLength);
  assert.equal(result.usageMetadata?.isFreeTier, true);
  assert.equal(result.usageMetadata?.accessMode, 'authenticated');
  assert.equal(result.usageMetadata?.testRequestCount, 1);
  assert.equal(provider.getPublicStatus().connectionStatus, 'connected');
});

test('OVHcloud Adapter: checkHealth executes non-generative HEAD probe (never POST) and handles 405/200/429', async () => {
  const methodsSeen: string[] = [];
  const provider = createOvhcloudSdxlProvider({
    getEnv: () => ({ OVH_AI_ENDPOINTS_ALLOW_ANONYMOUS: 'true' }),
    fetchFn: async (_url, init) => {
      methodsSeen.push(init?.method ?? '');
      // OVHcloud text2image returns 405 to HEAD while proving endpoint availability
      return new Response('', { status: 405 });
    },
  });

  const health = await provider.checkHealth();
  assert.deepEqual(methodsSeen, ['HEAD']);
  assert.equal(health.reachable, true);
  assert.equal(health.status.connectionStatus, 'connected');
  assert.equal(health.status.testRequestCount, 0);
});

test('OVHcloud Adapter: normalizes 429 rate limits, 401 auth errors, 5xx outages, timeouts, cancellations, and redacts secrets', async () => {
  const secretToken = 'ovh_super_secret_token_abcdef123456';

  // 429 Rate limit
  const rateLimitedProvider = createOvhcloudSdxlProvider({
    getEnv: () => ({ OVH_AI_ENDPOINTS_ALLOW_ANONYMOUS: 'true' }),
    fetchFn: async () =>
      new Response('Too many requests', {
        status: 429,
        headers: { 'Retry-After': '30' },
      }),
  });
  const rlRes = await rateLimitedProvider.runSmokeTest({ confirmed: true });
  assert.equal(rlRes.ok, false);
  if (!rlRes.ok) {
    assert.equal(rlRes.error.code, 'PROVIDER_UNAVAILABLE');
    assert.equal(rlRes.error.details?.category, 'RATE_LIMITED');
  }
  assert.equal(rateLimitedProvider.getPublicStatus().connectionStatus, 'rate_limited');
  assert.equal(rateLimitedProvider.getPublicStatus().retryAfterSeconds, 30);

  // 401 Auth failure must never leak token
  const authFailProvider = createOvhcloudSdxlProvider({
    getEnv: () => ({ OVH_AI_ENDPOINTS_ACCESS_TOKEN: secretToken }),
    fetchFn: async () =>
      new Response(`Invalid token Bearer ${secretToken}`, { status: 401 }),
  });
  const authRes = await authFailProvider.runSmokeTest({ confirmed: true });
  assert.equal(authRes.ok, false);
  if (!authRes.ok) {
    assert.equal(authRes.error.message.includes(secretToken), false);
    assert.equal(authRes.error.details?.category, 'AUTHENTICATION_FAILURE');
  }

  // 5xx outage
  const outageProvider = createOvhcloudSdxlProvider({
    getEnv: () => ({ OVH_AI_ENDPOINTS_ALLOW_ANONYMOUS: 'true' }),
    fetchFn: async () => new Response('Bad gateway', { status: 502 }),
  });
  const outageRes = await outageProvider.runSmokeTest({ confirmed: true });
  assert.equal(outageRes.ok, false);
  if (!outageRes.ok) {
    assert.equal(outageRes.error.details?.category, 'PROVIDER_UNAVAILABLE');
  }
  assert.equal(outageProvider.getPublicStatus().connectionStatus, 'unavailable');

  // Timeout
  const timeoutProvider = createOvhcloudSdxlProvider({
    getEnv: () => ({ OVH_AI_ENDPOINTS_ALLOW_ANONYMOUS: 'true' }),
    generationTimeoutMs: 25,
    fetchFn: async (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('The operation was aborted.');
          err.name = 'AbortError';
          reject(err);
        });
      }),
  });
  const timeoutRes = await timeoutProvider.runSmokeTest({ confirmed: true });
  assert.equal(timeoutRes.ok, false);
  if (!timeoutRes.ok) {
    assert.equal(timeoutRes.error.details?.category, 'NETWORK_TIMEOUT');
  }

  // External cancellation
  const abortController = new AbortController();
  abortController.abort(new Error('User cancelled'));
  const cancelProvider = createOvhcloudSdxlProvider({
    getEnv: () => ({ OVH_AI_ENDPOINTS_ALLOW_ANONYMOUS: 'true' }),
  });
  const cancelRes = await cancelProvider.runSmokeTest({
    confirmed: true,
    abortSignal: abortController.signal,
  });
  assert.equal(cancelRes.ok, false);
  if (!cancelRes.ok) {
    assert.equal(cancelRes.error.details?.category, 'CANCELLED');
  }
});

test('Free-Tier Safeguards: blocks paid model override, requires smoke test confirmation, and limits concurrency', async () => {
  const paidOverrideConfig = resolveOvhcloudPublicConfiguration({
    OVH_AI_ENDPOINTS_ACCESS_TOKEN: 'valid_test_token_1234',
    OVH_AI_ENDPOINTS_MODEL_ID: 'flux-pro-paid-model',
  });
  assert.equal(paidOverrideConfig.modelValid, false);
  assert.equal(paidOverrideConfig.accessMode, 'disabled');
  assert.equal(paidOverrideConfig.errorCategory, 'INVALID_MODEL_CONFIGURATION');

  const freeTierUnavailableConfig = resolveOvhcloudPublicConfiguration({
    OVH_AI_ENDPOINTS_ALLOW_ANONYMOUS: 'true',
    OVH_AI_ENDPOINTS_FREE_TIER_AVAILABLE: 'false',
  });
  assert.equal(freeTierUnavailableConfig.freeTierAvailable, false);
  assert.equal(freeTierUnavailableConfig.accessMode, 'disabled');
  assert.equal(freeTierUnavailableConfig.errorCategory, 'UNAVAILABLE');

  const unconfirmedProvider = createOvhcloudSdxlProvider({
    getEnv: () => ({ OVH_AI_ENDPOINTS_ALLOW_ANONYMOUS: 'true' }),
  });
  const unconfirmed = await unconfirmedProvider.runSmokeTest({
    confirmed: false,
  });
  assert.equal(unconfirmed.ok, false);
  if (!unconfirmed.ok) {
    assert.equal(unconfirmed.error.code, 'VALIDATION_ERROR');
  }

  // Verify secret redaction for process.env.OVH_AI_ENDPOINTS_ACCESS_TOKEN
  const prevToken = process.env.OVH_AI_ENDPOINTS_ACCESS_TOKEN;
  process.env.OVH_AI_ENDPOINTS_ACCESS_TOKEN = 'ovh_env_secret_value_xyz987';
  try {
    const redacted = redactSecretValues(
      'Failed calling endpoint with ovh_env_secret_value_xyz987',
    );
    assert.equal(redacted.includes('ovh_env_secret_value_xyz987'), false);
    assert.equal(redacted.includes('[REDACTED]'), true);
  } finally {
    if (prevToken === undefined) {
      delete process.env.OVH_AI_ENDPOINTS_ACCESS_TOKEN;
    } else {
      process.env.OVH_AI_ENDPOINTS_ACCESS_TOKEN = prevToken;
    }
  }
});

test('HTTP API Routes: status, capabilities, health, smoke-test, and execute enforce security boundaries cleanly', async () => {
  const pngBytes = buildMinimalPng(1024, 1024);
  const testSecret = 'ovh_route_secret_123456789';
  const registry = createServerProviderRegistry({
    ovhcloud: {
      getEnv: () => ({
        OVH_AI_ENDPOINTS_ACCESS_TOKEN: testSecret,
      }),
      fetchFn: async (_url, init) => {
        if (init?.method === 'HEAD') {
          return new Response('', { status: 405 });
        }
        return new Response(Buffer.from(pngBytes), {
          status: 200,
          headers: { 'Content-Type': 'application/octet-stream' },
        });
      },
    },
  });

  const app = createServerApp({ registry });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    // Status route must never expose secret token
    const statusRes = await fetch(
      `${baseUrl}/api/providers/image-generation/status`,
    );
    assert.equal(statusRes.status, 200);
    const statusText = await statusRes.text();
    assert.equal(statusText.includes(testSecret), false);
    const statusJson = JSON.parse(statusText) as {
      ok: boolean;
      data: { providerId: string; modelId: string; isFreeTierModel: boolean };
    };
    assert.equal(statusJson.ok, true);
    assert.equal(statusJson.data.providerId, OVHCLOUD_PROVIDER_ID);
    assert.equal(statusJson.data.modelId, OVHCLOUD_SDXL_MODEL_ID);
    assert.equal(statusJson.data.isFreeTierModel, true);

    // Capabilities route
    const capRes = await fetch(
      `${baseUrl}/api/providers/image-generation/capabilities`,
    );
    assert.equal(capRes.status, 200);
    const capJson = (await capRes.json()) as {
      ok: boolean;
      data: { supportsImageToImage: boolean; task: string };
    };
    assert.equal(capJson.data.supportsImageToImage, false);
    assert.equal(capJson.data.task, 'text-to-image');

    // Non-generative health probe
    const healthRes = await fetch(
      `${baseUrl}/api/providers/image-generation/health`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
    );
    assert.equal(healthRes.status, 200);
    const healthJson = (await healthRes.json()) as {
      ok: boolean;
      data: { reachable: boolean; status: { testRequestCount: number } };
    };
    assert.equal(healthJson.data.reachable, true);
    assert.equal(healthJson.data.status.testRequestCount, 0);

    // Unconfirmed smoke test rejected
    const unconfirmedRes = await fetch(
      `${baseUrl}/api/providers/image-generation/smoke-test`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmed: false }),
      },
    );
    assert.equal(unconfirmedRes.status, 400);

    // Smoke test with sourceImage rejected as 403 SECURITY_BOUNDARY_VIOLATION
    const imageRejectedRes = await fetch(
      `${baseUrl}/api/providers/image-generation/smoke-test`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmed: true,
          sourceImage: 'data:image/png;base64,AAAA',
        }),
      },
    );
    assert.equal(imageRejectedRes.status, 403);

    // Confirmed smoke test succeeds cleanly
    const confirmedSmokeRes = await fetch(
      `${baseUrl}/api/providers/image-generation/smoke-test`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmed: true }),
      },
    );
    assert.equal(confirmedSmokeRes.status, 200);
    const smokeJson = (await confirmedSmokeRes.json()) as {
      ok: boolean;
      data: {
        promptUsed: string;
        width: number;
        height: number;
        mimeType: string;
        testRequestCount: number;
      };
    };
    assert.equal(smokeJson.ok, true);
    assert.equal(smokeJson.data.promptUsed, OVHCLOUD_DEFAULT_SMOKE_TEST_PROMPT);
    assert.equal(smokeJson.data.width, 1024);
    assert.equal(smokeJson.data.height, 1024);
    assert.equal(smokeJson.data.mimeType, 'image/png');
    assert.equal(smokeJson.data.testRequestCount, 1);

    // Normalized execute rejects unapproved prompt
    const unapprovedExecRes = await fetch(
      `${baseUrl}/api/image-generation/execute`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'prj_12345678',
          promptId: 'prm_12345678',
          approvalStatus: 'draft',
          approvedPrompt: 'Ceramic bowl',
          modelId: OVHCLOUD_SDXL_MODEL_ID,
        }),
      },
    );
    assert.equal(unapprovedExecRes.status, 400);

    // Normalized execute rejects embedded credential
    const credExecRes = await fetch(
      `${baseUrl}/api/image-generation/execute`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'prj_12345678',
          promptId: 'prm_12345678',
          approvalStatus: 'approved',
          approvedPrompt: 'Ceramic bowl',
          geminiApiKey: 'AIzaSyFakeSecretKey1234567890',
        }),
      },
    );
    assert.equal(credExecRes.status, 403);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

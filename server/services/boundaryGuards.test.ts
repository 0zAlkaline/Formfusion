import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { createServerApp } from '../../server.ts';
import { redactSecretValues } from '../middleware/security.ts';
import {
  validateServerImageGenerationPayload,
  validateServerVisionIdentificationPayload,
} from './boundaryGuards.ts';

test('redactSecretValues masks API keys and bearer tokens', () => {
  const sample =
    'Authorization: Bearer my-secret-token-123 and apiKey="AIzaSySecretKey1234567890123456"';
  const redacted = redactSecretValues(sample);
  assert.equal(redacted.includes('my-secret-token-123'), false);
  assert.equal(redacted.includes('AIzaSySecretKey1234567890123456'), false);
});

test('validateServerImageGenerationPayload rejects source images and credentials', () => {
  const withSource = validateServerImageGenerationPayload({
    finalApprovedPrompt: 'Oil painting of a glass pitcher',
    aspectRatio: '1:1',
    resolution: { width: 1024, height: 1024, label: 'standard' },
    modelParameters: {},
    providerConfigRef: { providerId: 'p1', modelId: 'm1' },
    sourceImageUrl: 'https://example.com/a.png',
  });
  assert.equal(withSource.ok, false);
  if (!withSource.ok) {
    assert.equal(withSource.error.code, 'SECURITY_BOUNDARY_VIOLATION');
  }
});

test('validateServerVisionIdentificationPayload rejects embedded secrets', () => {
  const res = validateServerVisionIdentificationPayload({
    projectId: 'prj_12345678',
    sourceAssetId: 'src_12345678',
    mimeType: 'image/png',
    providerConfigRef: {
      providerId: 'gemini-vision',
      modelId: 'gemini-2.5-flash',
      apiSecret: 'should-not-be-here',
    },
  });
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.error.code, 'SECURITY_BOUNDARY_VIOLATION');
  }
});

test('Express API server exposes health and enforces boundary routes', async () => {
  const app = createServerApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const healthRes = await fetch(`${baseUrl}/api/health`);
    assert.equal(healthRes.status, 200);
    const healthJson = (await healthRes.json()) as {
      ok: boolean;
      application: string;
      phase: string;
      boundaries: { visionAndGenerationSeparated: boolean };
    };
    assert.equal(healthJson.ok, true);
    assert.equal(healthJson.application, 'FormFusion');
    assert.equal(healthJson.phase, '01.1');
    assert.equal(healthJson.boundaries.visionAndGenerationSeparated, true);

    const rejectedRes = await fetch(`${baseUrl}/api/v1/image-generation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        finalApprovedPrompt: 'Sculpture in bronze',
        aspectRatio: '1:1',
        resolution: { width: 1024, height: 1024, label: 'standard' },
        modelParameters: {},
        providerConfigRef: { providerId: 'p1', modelId: 'm1' },
        sourceImage: 'data:image/png;base64,AAAA',
      }),
    });
    assert.equal(rejectedRes.status, 400);

    const validDeferredRes = await fetch(`${baseUrl}/api/v1/image-generation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        finalApprovedPrompt: 'Sculpture in bronze',
        aspectRatio: '1:1',
        resolution: { width: 1024, height: 1024, label: 'standard' },
        modelParameters: {},
        providerConfigRef: { providerId: 'p1', modelId: 'm1' },
      }),
    });
    assert.equal(validDeferredRes.status, 501);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

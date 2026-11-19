import assert from 'node:assert/strict';
import test from 'node:test';
import type { PromptDocument } from '../../types/domain';
import {
  buildApprovedTextGenerationRequest,
  ImageGenerationServiceFoundation,
  validateImageGenerationRequest,
  type TextToImageGenerationRequest,
} from './contract';

function createValidTextRequest(): TextToImageGenerationRequest {
  return {
    finalApprovedPrompt:
      'A ceramic teapot resting on weathered cedar wood under warm morning side light, gouache illustration.',
    negativePrompt: 'blurry, low detail, watermark',
    aspectRatio: '4:3',
    resolution: { width: 1024, height: 768, label: 'standard' },
    modelParameters: {
      guidanceScale: 7.5,
      inferenceSteps: 28,
      seed: 42,
      safetyFilterLevel: 'strict',
    },
    providerConfigRef: {
      providerId: 'placeholder-t2i',
      modelId: 'model-v1',
    },
  };
}

test('accepts a valid text-only ImageGenerationRequest', () => {
  const result = validateImageGenerationRequest(createValidTextRequest());
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.aspectRatio, '4:3');
    assert.equal(result.data.providerConfigRef.providerId, 'placeholder-t2i');
  }
});

test('rejects every forbidden source-image key at runtime', () => {
  const forbiddenCases: Record<string, unknown>[] = [
    { sourceImage: 'img-data' },
    { imageFile: { name: 'photo.png' } },
    { base64Image: 'iVBORw0KGgo=' },
    { sourceImageUrl: 'https://example.com/photo.png' },
    { imageAttachment: 'att-1' },
    { uploadedImageReference: 'src_12345678' },
    { sourceAssetId: 'src_12345678' },
  ];

  for (const extra of forbiddenCases) {
    const payload = { ...createValidTextRequest(), ...extra };
    const result = validateImageGenerationRequest(payload);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, 'SECURITY_BOUNDARY_VIOLATION');
    }
  }
});

test('rejects nested image data URIs and binary buffers', () => {
  const withDataUri = {
    ...createValidTextRequest(),
    finalApprovedPrompt: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
  };
  const dataUriResult = validateImageGenerationRequest(withDataUri);
  assert.equal(dataUriResult.ok, false);
  if (!dataUriResult.ok) {
    assert.equal(dataUriResult.error.code, 'SECURITY_BOUNDARY_VIOLATION');
  }

  const withBuffer = {
    ...createValidTextRequest(),
    modelParameters: {
      guidanceScale: 7,
      extraBytes: new Uint8Array([1, 2, 3]),
    },
  };
  const bufferResult = validateImageGenerationRequest(withBuffer);
  assert.equal(bufferResult.ok, false);
  if (!bufferResult.ok) {
    assert.equal(bufferResult.error.code, 'SECURITY_BOUNDARY_VIOLATION');
  }
});

test('rejects credentials embedded inside providerConfigRef', () => {
  const payload = {
    ...createValidTextRequest(),
    providerConfigRef: {
      providerId: 'placeholder-t2i',
      modelId: 'model-v1',
      apiKey: 'secret-value',
    },
  };

  const result = validateImageGenerationRequest(payload);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, 'SECURITY_BOUNDARY_VIOLATION');
  }
});

test('requires PromptDocument approvalStatus === "approved" before building request', () => {
  const basePrompt: PromptDocument = {
    id: 'prm_12345678',
    projectId: 'prj_12345678',
    descriptionId: 'dsc_12345678',
    styleId: 'sty_12345678',
    userInstructions: 'Use warm morning light',
    generatedPrompt: 'Draft prompt text',
    finalPrompt: 'Approved final prompt text',
    negativePrompt: 'blurry',
    approvalStatus: 'draft',
    approvedAt: null,
    revision: 1,
    createdAt: '2026-11-14T00:00:00.000Z',
    updatedAt: '2026-11-14T00:00:00.000Z',
  };

  const unapprovedResult = buildApprovedTextGenerationRequest({
    promptDocument: basePrompt,
    aspectRatio: '1:1',
    resolution: { width: 1024, height: 1024, label: 'standard' },
    modelParameters: {},
    providerConfigRef: { providerId: 'placeholder-t2i', modelId: 'model-v1' },
  });
  assert.equal(unapprovedResult.ok, false);
  if (!unapprovedResult.ok) {
    assert.equal(unapprovedResult.error.code, 'VALIDATION_ERROR');
  }

  const approvedResult = buildApprovedTextGenerationRequest({
    promptDocument: {
      ...basePrompt,
      approvalStatus: 'approved',
      approvedAt: '2026-11-14T00:01:00.000Z',
    },
    aspectRatio: '1:1',
    resolution: { width: 1024, height: 1024, label: 'standard' },
    modelParameters: {},
    providerConfigRef: { providerId: 'placeholder-t2i', modelId: 'model-v1' },
  });
  assert.equal(approvedResult.ok, true);
});

test('ImageGenerationServiceFoundation enforces TypeScript compile-time and runtime boundaries', async () => {
  const service = new ImageGenerationServiceFoundation();
  const valid = createValidTextRequest();

  const validRes = await service.generateArtwork(valid);
  assert.equal(validRes.ok, false);
  if (!validRes.ok) {
    assert.equal(validRes.error.code, 'NOT_IMPLEMENTED');
  }

  // Compile-time boundary verification: tsc --noEmit fails if any of these become assignable.
  if (false) {
    // @ts-expect-error sourceImage must be rejected at compile time
    await service.generateArtwork({ ...valid, sourceImage: 'forbidden' });
    // @ts-expect-error imageFile must be rejected at compile time
    await service.generateArtwork({ ...valid, imageFile: 'forbidden' });
    // @ts-expect-error base64Image must be rejected at compile time
    await service.generateArtwork({ ...valid, base64Image: 'forbidden' });
    // @ts-expect-error sourceImageUrl must be rejected at compile time
    await service.generateArtwork({ ...valid, sourceImageUrl: 'forbidden' });
    // @ts-expect-error imageAttachment must be rejected at compile time
    await service.generateArtwork({ ...valid, imageAttachment: 'forbidden' });
    // @ts-expect-error uploadedImageReference must be rejected at compile time
    await service.generateArtwork({ ...valid, uploadedImageReference: 'forbidden' });
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeSourceAspectRatio,
  createValidatedSourceAsset,
  detectImageSignature,
  formatFileSize,
  MAX_SOURCE_IMAGE_BYTES,
  validateSourceImageBinary,
  validateSourceImageDimensions,
} from './imageValidation';

function makePngHeader(): Uint8Array {
  const bytes = new Uint8Array(32);
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  // Chunk length + "IHDR"
  bytes.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8);
  return bytes;
}

function makeJpegHeader(): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46], 0);
  return bytes;
}

function makeWebpHeader(): Uint8Array {
  const bytes = new Uint8Array(32);
  // "RIFF" .... "WEBP"
  bytes.set([0x52, 0x49, 0x46, 0x46, 0x20, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50], 0);
  return bytes;
}

test('detectImageSignature recognizes JPEG, PNG, and WebP magic bytes', () => {
  assert.equal(detectImageSignature(makeJpegHeader()), 'image/jpeg');
  assert.equal(detectImageSignature(makePngHeader()), 'image/png');
  assert.equal(detectImageSignature(makeWebpHeader()), 'image/webp');
  assert.equal(detectImageSignature(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])), null);
  assert.equal(detectImageSignature(new Uint8Array([0x25, 0x50, 0x44, 0x46])), null);
});

test('validateSourceImageBinary accepts valid JPEG, PNG, and WebP headers', () => {
  const jpeg = validateSourceImageBinary({
    fileName: 'vase.jpg',
    declaredMimeType: 'image/jpeg',
    fileSizeBytes: 1024 * 120,
    headerBytes: makeJpegHeader(),
  });
  assert.equal(jpeg.ok, true);
  if (jpeg.ok) {
    assert.equal(jpeg.data.detectedMimeType, 'image/jpeg');
    assert.equal(jpeg.data.fileExtension, 'jpg');
  }

  const png = validateSourceImageBinary({
    fileName: 'sculpture.png',
    declaredMimeType: 'image/png',
    fileSizeBytes: 1024 * 512,
    headerBytes: makePngHeader(),
  });
  assert.equal(png.ok, true);

  const webp = validateSourceImageBinary({
    fileName: 'lamp.webp',
    declaredMimeType: '',
    fileSizeBytes: 1024 * 64,
    headerBytes: makeWebpHeader(),
  });
  assert.equal(webp.ok, true);
});

test('validateSourceImageBinary rejects empty files and files exceeding 20 MB', () => {
  const empty = validateSourceImageBinary({
    fileName: 'empty.png',
    declaredMimeType: 'image/png',
    fileSizeBytes: 0,
    headerBytes: new Uint8Array(0),
  });
  assert.equal(empty.ok, false);

  const tooLarge = validateSourceImageBinary({
    fileName: 'huge.png',
    declaredMimeType: 'image/png',
    fileSizeBytes: MAX_SOURCE_IMAGE_BYTES + 1,
    headerBytes: makePngHeader(),
  });
  assert.equal(tooLarge.ok, false);
  if (!tooLarge.ok) {
    assert.match(tooLarge.error.message, /20 MB/);
  }
});

test('validateSourceImageBinary rejects renamed non-images and mismatched signatures', () => {
  const renamedText = validateSourceImageBinary({
    fileName: 'notes.png',
    declaredMimeType: 'image/png',
    fileSizeBytes: 128,
    headerBytes: new TextEncoder().encode('Hello world plain text disguised as png'),
  });
  assert.equal(renamedText.ok, false);
  if (!renamedText.ok) {
    assert.match(renamedText.error.message, /signature/i);
  }

  const mismatchedExt = validateSourceImageBinary({
    fileName: 'actually-jpeg.png',
    declaredMimeType: 'image/jpeg',
    fileSizeBytes: 4096,
    headerBytes: makeJpegHeader(),
  });
  assert.equal(mismatchedExt.ok, false);
  if (!mismatchedExt.ok) {
    assert.match(mismatchedExt.error.message, /signature/i);
  }

  const mismatchedMime = validateSourceImageBinary({
    fileName: 'photo.jpg',
    declaredMimeType: 'image/png',
    fileSizeBytes: 4096,
    headerBytes: makeJpegHeader(),
  });
  assert.equal(mismatchedMime.ok, false);
  if (!mismatchedMime.ok) {
    assert.match(mismatchedMime.error.message, /signature/i);
  }

  const unsupportedMime = validateSourceImageBinary({
    fileName: 'anim.gif',
    declaredMimeType: 'image/gif',
    fileSizeBytes: 4096,
    headerBytes: new Uint8Array(32),
  });
  assert.equal(unsupportedMime.ok, false);
  if (!unsupportedMime.ok) {
    assert.match(unsupportedMime.error.message, /Unsupported image format/i);
  }
});

test('validateSourceImageDimensions enforces minimum 256x256 resolution', () => {
  const tooNarrow = validateSourceImageDimensions(255, 512);
  assert.equal(tooNarrow.ok, false);
  if (!tooNarrow.ok) {
    assert.match(tooNarrow.error.message, /too small/i);
  }

  const tooShort = validateSourceImageDimensions(512, 200);
  assert.equal(tooShort.ok, false);

  const exactMin = validateSourceImageDimensions(256, 256);
  assert.equal(exactMin.ok, true);
});

test('createValidatedSourceAsset builds valid SourceAsset strictly marked in_memory', () => {
  const result = createValidatedSourceAsset({
    projectId: 'prj_12345678',
    fileName: 'ceramic-teapot.jpeg',
    declaredMimeType: 'image/jpeg',
    fileSizeBytes: 2_500_000,
    headerBytes: makeJpegHeader(),
    width: 1920,
    height: 1080,
    checksumSha256: 'abc123def456',
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.match(result.data.id, /^src_/);
    assert.equal(result.data.projectId, 'prj_12345678');
    assert.equal(result.data.originalFileName, 'ceramic-teapot.jpeg');
    assert.equal(result.data.fileExtension, 'jpeg');
    assert.equal(result.data.mimeType, 'image/jpeg');
    assert.equal(result.data.fileSizeBytes, 2_500_000);
    assert.equal(result.data.width, 1920);
    assert.equal(result.data.height, 1080);
    assert.equal(result.data.aspectRatio.label, '16:9');
    assert.equal(result.data.validationStatus, 'validated');
    assert.equal(result.data.storageStatus, 'in_memory');
    assert.equal(result.data.localBlobKey, null);
  }
});

test('computeSourceAspectRatio and formatFileSize format cleanly', () => {
  assert.equal(computeSourceAspectRatio(1024, 768).label, '4:3');
  assert.equal(computeSourceAspectRatio(512, 512).label, '1:1');
  assert.equal(computeSourceAspectRatio(1000, 667).label, '1.50:1');
  assert.equal(formatFileSize(512), '512 B');
  assert.equal(formatFileSize(2048), '2.0 KB');
  assert.equal(formatFileSize(20 * 1024 * 1024), '20.00 MB');
});

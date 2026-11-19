import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildArtworkExportFilename,
  computeAspectLockedHeight,
  computeAspectLockedWidth,
  createDefaultExportSettings,
  DEFAULT_JPEG_BACKGROUND_COLOR,
  DEFAULT_JPEG_QUALITY_PERCENT,
  detectAlphaTransparencyFromRgbaPixels,
  evaluateArtworkExportSettings,
  MAX_EXPORT_DIMENSION,
  sanitizeExportFilenameSegment,
  validateBackgroundColor,
  validateCustomDimensionValue,
  validateJpegQualityPercent,
} from './exportConfig.ts';

describe('exportConfig (Phase 06.2 pure export rules)', () => {
  it('initializes original resolution PNG settings by default', () => {
    const defaults = createDefaultExportSettings(1024, 768);
    assert.equal(defaults.format, 'png');
    assert.equal(defaults.dimensionMode, 'original');
    assert.equal(defaults.customWidthInput, '1024');
    assert.equal(defaults.customHeightInput, '768');
    assert.equal(defaults.lockAspectRatio, true);
    assert.equal(defaults.jpegQualityPercent, DEFAULT_JPEG_QUALITY_PERCENT);
    assert.equal(defaults.jpegBackgroundColor, DEFAULT_JPEG_BACKGROUND_COLOR);
  });

  it('validates custom dimensions strictly as positive integers up to 8192 px', () => {
    assert.equal(validateCustomDimensionValue('1024', 'Width').ok, true);
    assert.equal(validateCustomDimensionValue(8192, 'Height').ok, true);

    assert.equal(validateCustomDimensionValue('', 'Width').ok, false);
    assert.equal(validateCustomDimensionValue('0', 'Width').ok, false);
    assert.equal(validateCustomDimensionValue('-200', 'Width').ok, false);
    assert.equal(validateCustomDimensionValue('1024.5', 'Width').ok, false);
    assert.equal(validateCustomDimensionValue('abc', 'Height').ok, false);
    assert.equal(
      validateCustomDimensionValue(MAX_EXPORT_DIMENSION + 1, 'Width').ok,
      false,
    );
    assert.equal(validateCustomDimensionValue('8193', 'Height').ok, false);
  });

  it('computes proportional dimensions when aspect ratio is locked', () => {
    assert.equal(computeAspectLockedHeight(2048, 1024, 768), 1536);
    assert.equal(computeAspectLockedWidth(1536, 1024, 768), 2048);
    assert.equal(computeAspectLockedHeight(512, 1024, 1024), 512);
  });

  it('validates JPEG quality range (60-100%) and background hex colors', () => {
    assert.equal(validateJpegQualityPercent(60).ok, true);
    assert.equal(validateJpegQualityPercent(92).ok, true);
    assert.equal(validateJpegQualityPercent(100).ok, true);
    assert.equal(validateJpegQualityPercent(59).ok, false);
    assert.equal(validateJpegQualityPercent(101).ok, false);

    const bgOk = validateBackgroundColor('#f7f5f0');
    assert.equal(bgOk.ok, true);
    if (bgOk.ok) {
      assert.equal(bgOk.data, '#F7F5F0');
    }
    assert.equal(validateBackgroundColor('not-a-color').ok, false);
  });

  it('builds sanitized filenames matching FormFusion_[ArtworkType]_[GenerationID]_[Width]x[Height].[format]', () => {
    assert.equal(
      buildArtworkExportFilename({
        generationKind: 'original',
        generationId: 'job_12345678-abcd',
        width: 1024,
        height: 1024,
        format: 'png',
      }),
      'FormFusion_Original_job_12345678-abcd_1024x1024.png',
    );
    assert.equal(
      buildArtworkExportFilename({
        generationKind: 'regeneration',
        generationId: 'job_regen/unsafe:id*',
        width: 2048,
        height: 1536,
        format: 'jpeg',
      }),
      'FormFusion_Regenerated_job_regen_unsafe_id_2048x1536.jpeg',
    );
    assert.equal(
      buildArtworkExportFilename({
        generationKind: 'variation',
        generationId: 'job_var_001',
        width: 1024,
        height: 1024,
        format: 'png',
      }),
      'FormFusion_Variation_job_var_001_1024x1024.png',
    );
    assert.equal(sanitizeExportFilenameSegment('  a<b>c:d/e  '), 'a_b_c_d_e');
  });

  it('detects true alpha transparency only when alpha channel < 255 exists', () => {
    const opaqueRgba = new Uint8ClampedArray([
      255, 0, 0, 255,
      0, 255, 0, 255,
    ]);
    assert.equal(detectAlphaTransparencyFromRgbaPixels(opaqueRgba), false);

    const transparentRgba = new Uint8ClampedArray([
      255, 0, 0, 255,
      0, 255, 0, 128,
    ]);
    assert.equal(detectAlphaTransparencyFromRgbaPixels(transparentRgba), true);
  });

  it('enforces locked aspect ratio and emits explicit warning when unlocked aspect ratio stretches image', () => {
    const lockedInvalid = evaluateArtworkExportSettings({
      settings: {
        ...createDefaultExportSettings(1024, 1024),
        dimensionMode: 'custom',
        customWidthInput: '2048',
        customHeightInput: '1024',
        lockAspectRatio: true,
      },
      sourceWidth: 1024,
      sourceHeight: 1024,
      generationKind: 'original',
      generationId: 'job_00000001',
    });
    assert.equal(lockedInvalid.valid, false);
    assert.ok(lockedInvalid.fieldErrors.height);

    const unlockedValid = evaluateArtworkExportSettings({
      settings: {
        ...createDefaultExportSettings(1024, 1024),
        dimensionMode: 'custom',
        customWidthInput: '2048',
        customHeightInput: '1024',
        lockAspectRatio: false,
      },
      sourceWidth: 1024,
      sourceHeight: 1024,
      generationKind: 'original',
      generationId: 'job_00000001',
    });
    assert.equal(unlockedValid.valid, true);
    assert.equal(unlockedValid.spec?.width, 2048);
    assert.equal(unlockedValid.spec?.height, 1024);
    assert.equal(unlockedValid.spec?.isAspectRatioChanged, true);
    assert.ok(
      unlockedValid.warnings.some((w) => w.includes('Aspect ratio is unlocked')),
    );
  });

  it('surfaces JPEG transparency notice and normalizes quality parameter cleanly', () => {
    const jpegEval = evaluateArtworkExportSettings({
      settings: {
        ...createDefaultExportSettings(1024, 1024),
        format: 'jpeg',
        jpegQualityPercent: 85,
        jpegBackgroundColor: '#f7f5f0',
      },
      sourceWidth: 1024,
      sourceHeight: 1024,
      generationKind: 'variation',
      generationId: 'job_00000002',
      hasSourceTransparency: true,
    });
    assert.equal(jpegEval.valid, true);
    assert.equal(jpegEval.spec?.mimeType, 'image/jpeg');
    assert.equal(jpegEval.spec?.jpegQualityNormalized, 0.85);
    assert.equal(jpegEval.spec?.jpegBackgroundColor, '#F7F5F0');
    assert.ok(
      jpegEval.warnings.some((w) => w.includes('JPEG does not support transparency')),
    );
  });
});

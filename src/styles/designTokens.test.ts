import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BRAND_COLORS,
  DESKTOP_LAYOUT_STANDARDS,
  SEMANTIC_COLOR_TOKENS,
  SPACING_SCALE,
  TYPOGRAPHY_TOKENS,
} from './designTokens';

test('BRAND_COLORS match exact FormFusion Phase 01.2 hex specifications', () => {
  assert.equal(BRAND_COLORS.background, '#F3F0E8');
  assert.equal(BRAND_COLORS.surface, '#FFFFFF');
  assert.equal(BRAND_COLORS.primaryText, '#17191E');
  assert.equal(BRAND_COLORS.secondaryText, '#77766F');
  assert.equal(BRAND_COLORS.primaryAccent, '#315BDE');
  assert.equal(BRAND_COLORS.secondaryAccent, '#D7F36A');
  assert.equal(BRAND_COLORS.border, '#E3E0D7');
  assert.equal(BRAND_COLORS.darkSurface, '#17191E');
});

test('SEMANTIC_COLOR_TOKENS expose all 19 required semantic tokens', () => {
  const expectedKeys = [
    'background',
    'foreground',
    'surface',
    'surface-elevated',
    'primary',
    'primary-foreground',
    'secondary',
    'secondary-foreground',
    'muted',
    'muted-foreground',
    'accent',
    'accent-foreground',
    'border',
    'input',
    'focus-ring',
    'destructive',
    'success',
    'warning',
    'info',
  ];
  assert.deepEqual(Object.keys(SEMANTIC_COLOR_TOKENS), expectedKeys);
});

test('TYPOGRAPHY_TOKENS define all 10 roles with Manrope display and Inter body', () => {
  assert.equal(Object.keys(TYPOGRAPHY_TOKENS).length, 10);
  assert.equal(TYPOGRAPHY_TOKENS.displayXl.fontFamily, 'Manrope');
  assert.equal(TYPOGRAPHY_TOKENS.displayLg.fontFamily, 'Manrope');
  assert.equal(TYPOGRAPHY_TOKENS.h1.fontFamily, 'Manrope');
  assert.equal(TYPOGRAPHY_TOKENS.h2.fontFamily, 'Manrope');
  assert.equal(TYPOGRAPHY_TOKENS.h3.fontFamily, 'Manrope');
  assert.equal(TYPOGRAPHY_TOKENS.bodyLg.fontFamily, 'Inter');
  assert.equal(TYPOGRAPHY_TOKENS.body.fontFamily, 'Inter');
  assert.equal(TYPOGRAPHY_TOKENS.bodySm.fontFamily, 'Inter');
  assert.equal(TYPOGRAPHY_TOKENS.label.fontFamily, 'Inter');
  assert.equal(TYPOGRAPHY_TOKENS.caption.fontFamily, 'Inter');
});

test('SPACING_SCALE provides exact 4px-based spacing values', () => {
  assert.deepEqual(Object.values(SPACING_SCALE), [
    '4px',
    '8px',
    '12px',
    '16px',
    '20px',
    '24px',
    '32px',
    '40px',
    '48px',
    '64px',
  ]);
  assert.deepEqual([...DESKTOP_LAYOUT_STANDARDS.targetViewports], [
    1366,
    1440,
    1600,
    1920,
  ]);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  matchStudioRoute,
  normalizeRoutePathname,
  STUDIO_ROUTES,
} from './routeConfig';

test('STUDIO_ROUTES defines all six required Phase 01.3 routes', () => {
  assert.deepEqual(
    STUDIO_ROUTES.map((r) => r.path),
    ['/', '/create', '/styles', '/projects', '/presets', '/settings'],
  );
  assert.equal(STUDIO_ROUTES[1].label, 'Create / Generator');
});

test('matchStudioRoute resolves known routes including trailing slashes', () => {
  const dashboard = matchStudioRoute('/');
  assert.equal(dashboard.matched, true);
  if (dashboard.matched) {
    assert.equal(dashboard.route.id, 'dashboard');
  }

  const create = matchStudioRoute('/create/');
  assert.equal(create.matched, true);
  if (create.matched) {
    assert.equal(create.route.id, 'create');
    assert.equal(create.route.path, '/create');
  }

  const presets = matchStudioRoute('/presets');
  assert.equal(presets.matched, true);
  if (presets.matched) {
    assert.equal(presets.route.id, 'presets');
    assert.equal(presets.route.label, 'My Presets');
  }

  const normalizedPresets = matchStudioRoute('//Presets/');
  assert.equal(normalizedPresets.matched, true);
  if (normalizedPresets.matched) {
    assert.equal(normalizedPresets.route.id, 'presets');
    assert.equal(normalizedPresets.pathname, '/presets');
  }
});

test('matchStudioRoute returns matched: false for unknown paths', () => {
  const unknown = matchStudioRoute('/non-existent-route');
  assert.equal(unknown.matched, false);
  assert.equal(unknown.route, null);
  assert.equal(unknown.pathname, '/non-existent-route');
  assert.equal(normalizeRoutePathname('/projects/?view=grid'), '/projects');
});

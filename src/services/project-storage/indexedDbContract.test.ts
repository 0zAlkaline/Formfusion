import assert from 'node:assert/strict';
import test from 'node:test';
import { STORAGE_STORE_NAMES } from '../../types/storage';
import {
  FORMFUSION_INDEXED_DB_SCHEMA,
  IndexedDbStorageGatewayFoundation,
  ProjectStorageServiceFoundation,
  validateBasePersistedRecord,
} from './indexedDbContract';

test('IndexedDB schema defines all eleven required stores and safe v1->v2 migration', () => {
  assert.equal(FORMFUSION_INDEXED_DB_SCHEMA.version, 2);
  assert.equal(FORMFUSION_INDEXED_DB_SCHEMA.migrations.length, 2);
  assert.equal(FORMFUSION_INDEXED_DB_SCHEMA.migrations[0]?.fromVersion, 0);
  assert.equal(FORMFUSION_INDEXED_DB_SCHEMA.migrations[0]?.toVersion, 1);
  assert.equal(FORMFUSION_INDEXED_DB_SCHEMA.migrations[1]?.fromVersion, 1);
  assert.equal(FORMFUSION_INDEXED_DB_SCHEMA.migrations[1]?.toVersion, 2);
  const storeNames = FORMFUSION_INDEXED_DB_SCHEMA.stores.map(
    (store) => store.storeName,
  );
  assert.deepEqual(storeNames, [...STORAGE_STORE_NAMES]);
});

test('Storage gateway foundation accurately reports non-persistent Phase 01.1 state', async () => {
  const gateway = new IndexedDbStorageGatewayFoundation();
  assert.equal(gateway.isPersistent(), false);

  const storageService = new ProjectStorageServiceFoundation(gateway);
  const listRes = await storageService.listProjects();
  assert.equal(listRes.ok, false);
  if (!listRes.ok) {
    assert.equal(listRes.error.code, 'NOT_IMPLEMENTED');
  }

  const getRes = await storageService.getProjectById('prj_12345678');
  assert.equal(getRes.ok, false);
  if (!getRes.ok) {
    assert.equal(getRes.error.code, 'NOT_IMPLEMENTED');
  }

  const deletePresetRes = await storageService.deletePreset('pst_12345678');
  assert.equal(deletePresetRes.ok, false);
  if (!deletePresetRes.ok) {
    assert.equal(deletePresetRes.error.code, 'NOT_IMPLEMENTED');
  }
});

test('validateBasePersistedRecord rejects missing ids, invalid timestamps, and credentials', () => {
  const missingId = validateBasePersistedRecord('projects', {
    title: 'Test',
    createdAt: '2026-11-14T00:00:00.000Z',
    updatedAt: '2026-11-14T00:00:00.000Z',
  });
  assert.equal(missingId.ok, false);

  const withApiKey = validateBasePersistedRecord('projects', {
    id: 'prj_12345678',
    title: 'Test',
    apiKey: 'AIzaSyFakeKeyValue1234567890',
    createdAt: '2026-11-14T00:00:00.000Z',
    updatedAt: '2026-11-14T00:00:00.000Z',
  });
  assert.equal(withApiKey.ok, false);
  if (!withApiKey.ok) {
    assert.equal(withApiKey.error.code, 'SECURITY_BOUNDARY_VIOLATION');
  }

  const valid = validateBasePersistedRecord('projects', {
    id: 'prj_12345678',
    title: 'Ceramics Study',
    createdAt: '2026-11-14T00:00:00.000Z',
    updatedAt: '2026-11-14T00:00:00.000Z',
  });
  assert.equal(valid.ok, true);
});

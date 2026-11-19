import type { EntityId, IsoTimestamp } from '../types/common.ts';

export type EntityPrefix =
  | 'prj'
  | 'src'
  | 'blb'
  | 'anl'
  | 'dsc'
  | 'sty'
  | 'prm'
  | 'job'
  | 'art'
  | 'var'
  | 'pst'
  | 'obj';

export function createEntityId(prefix: EntityPrefix): EntityId {
  const randomPart =
    typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${randomPart}`;
}

export function isValidEntityId(value: unknown): value is EntityId {
  return typeof value === 'string' && /^[a-z]{3}_[A-Za-z0-9_-]{8,}$/.test(value);
}

export function nowIsoTimestamp(): IsoTimestamp {
  return new Date().toISOString();
}

export function isValidIsoTimestamp(value: unknown): value is IsoTimestamp {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return false;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}

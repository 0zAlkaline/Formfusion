import { errResult, okResult } from '../types/common.ts';
import type { ServiceResult } from '../types/common.ts';
import type { ProviderConfigRef } from '../types/providers.ts';

const CREDENTIAL_KEY_PATTERNS = [
  'apikey',
  'api_key',
  'secret',
  'token',
  'password',
  'privatekey',
  'private_key',
  'authorization',
  'bearer',
  'credential',
  'credentials',
] as const;

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function findCredentialLeakKey(
  input: unknown,
  pathPrefix = '',
): string | null {
  if (Array.isArray(input)) {
    for (let i = 0; i < input.length; i += 1) {
      const nested = findCredentialLeakKey(input[i], `${pathPrefix}[${i}]`);
      if (nested !== null) {
        return nested;
      }
    }
    return null;
  }

  if (!isPlainRecord(input)) {
    return null;
  }

  for (const [key, value] of Object.entries(input)) {
    const normalized = key.toLowerCase().replace(/[\s-]/g, '');
    const fullPath = pathPrefix ? `${pathPrefix}.${key}` : key;
    if (CREDENTIAL_KEY_PATTERNS.some((pattern) => normalized.includes(pattern))) {
      return fullPath;
    }
    const nested = findCredentialLeakKey(value, fullPath);
    if (nested !== null) {
      return nested;
    }
  }

  return null;
}

export function validateProviderConfigRef(
  value: unknown,
): ServiceResult<ProviderConfigRef> {
  if (!isPlainRecord(value)) {
    return errResult(
      'VALIDATION_ERROR',
      'providerConfigRef must be a plain object.',
    );
  }

  const leakKey = findCredentialLeakKey(value, 'providerConfigRef');
  if (leakKey !== null) {
    return errResult(
      'SECURITY_BOUNDARY_VIOLATION',
      `Credential-like field "${leakKey}" is prohibited in client provider references.`,
      { field: leakKey },
    );
  }

  if (!isNonEmptyString(value.providerId)) {
    return errResult(
      'VALIDATION_ERROR',
      'providerConfigRef.providerId must be a non-empty string.',
    );
  }

  if (!isNonEmptyString(value.modelId)) {
    return errResult(
      'VALIDATION_ERROR',
      'providerConfigRef.modelId must be a non-empty string.',
    );
  }

  if (
    value.endpointProfile !== undefined &&
    !isNonEmptyString(value.endpointProfile)
  ) {
    return errResult(
      'VALIDATION_ERROR',
      'providerConfigRef.endpointProfile must be a non-empty string when provided.',
    );
  }

  return okResult({
    providerId: value.providerId.trim(),
    modelId: value.modelId.trim(),
    ...(typeof value.endpointProfile === 'string'
      ? { endpointProfile: value.endpointProfile.trim() }
      : {}),
  });
}

export type EntityId = string;

export type IsoTimestamp = string;

export interface EntityTimestamps {
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

export type ServiceErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'UNSUPPORTED_OPERATION'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_ERROR'
  | 'SECURITY_BOUNDARY_VIOLATION'
  | 'STORAGE_ERROR'
  | 'NOT_IMPLEMENTED';

export interface ServiceError {
  readonly code: ServiceErrorCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, string | number | boolean>>;
}

export type ServiceResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: ServiceError };

export function okResult<T>(data: T): ServiceResult<T> {
  return { ok: true, data };
}

export function errResult<T = never>(
  code: ServiceErrorCode,
  message: string,
  details?: Readonly<Record<string, string | number | boolean>>,
): ServiceResult<T> {
  return {
    ok: false,
    error: details ? { code, message, details } : { code, message },
  };
}

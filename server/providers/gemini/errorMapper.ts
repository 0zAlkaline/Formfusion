import type { ServiceErrorCode } from '../../../src/types/common.ts';
import type {
  GeminiErrorCategory,
  ProviderNormalizedError,
} from '../../../src/types/providers.ts';
import { sanitizeDiagnosticMessage } from '../../middleware/security.ts';
import { GEMINI_PROVIDER_ID } from './config.ts';

export interface MappedGeminiProviderError {
  readonly category: GeminiErrorCategory;
  readonly httpStatus: number;
  readonly serviceErrorCode: ServiceErrorCode;
  readonly retryable: boolean;
  readonly message: string;
  readonly upstreamStatus?: number;
  readonly diagnosticDetail?: string;
  readonly normalized: ProviderNormalizedError;
}

export class GeminiConfigurationError extends Error {
  readonly category: GeminiErrorCategory;

  constructor(category: GeminiErrorCategory, message: string) {
    super(message);
    this.name = 'GeminiConfigurationError';
    this.category = category;
  }
}

export class GeminiSdkInitializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeminiSdkInitializationError';
  }
}

export class GeminiResponseError extends Error {
  readonly reason: 'EMPTY_RESPONSE' | 'BLOCKED_RESPONSE' | 'INVALID_RESPONSE';

  constructor(
    reason: 'EMPTY_RESPONSE' | 'BLOCKED_RESPONSE' | 'INVALID_RESPONSE',
    message: string,
  ) {
    super(message);
    this.name = 'GeminiResponseError';
    this.reason = reason;
  }
}

function extractHttpStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const record = error as Record<string, unknown>;
  for (const candidate of [record.status, record.statusCode, record.code]) {
    if (typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= 100) {
      return candidate;
    }
  }
  if (typeof record.response === 'object' && record.response !== null) {
    const responseStatus = (record.response as Record<string, unknown>).status;
    if (typeof responseStatus === 'number' && Number.isInteger(responseStatus)) {
      return responseStatus;
    }
  }
  if (typeof record.error === 'object' && record.error !== null) {
    const nestedCode = (record.error as Record<string, unknown>).code;
    if (typeof nestedCode === 'number' && Number.isInteger(nestedCode) && nestedCode >= 100) {
      return nestedCode;
    }
  }
  return undefined;
}

function extractCauseText(cause: unknown): string {
  if (!cause) {
    return '';
  }
  if (typeof cause === 'string') {
    return cause;
  }
  if (typeof cause === 'object') {
    const record = cause as Record<string, unknown>;
    const code = typeof record.code === 'string' ? record.code : '';
    const name = typeof record.name === 'string' ? record.name : '';
    const message = typeof record.message === 'string' ? record.message : '';
    const parts = [code, name, message].filter((part) => part.trim().length > 0);
    if (parts.length > 0) {
      return parts.join(' ');
    }
  }
  return '';
}

function extractRawErrorText(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }
  if (error instanceof Error) {
    const causeText = extractCauseText((error as Error & { cause?: unknown }).cause);
    const base = `${error.name}: ${error.message}`;
    return causeText ? `${base} (cause: ${causeText})` : base;
  }
  if (typeof error === 'object' && error !== null) {
    const record = error as Record<string, unknown>;
    if (typeof record.message === 'string') {
      const causeText = extractCauseText(record.cause);
      return causeText ? `${record.message} (cause: ${causeText})` : record.message;
    }
    if (typeof record.error === 'object' && record.error !== null) {
      const nestedMsg = (record.error as Record<string, unknown>).message;
      if (typeof nestedMsg === 'string') {
        return nestedMsg;
      }
    }
  }
  return 'Unexpected Gemini provider error.';
}

function buildMappedError(params: {
  category: GeminiErrorCategory;
  httpStatus: number;
  serviceErrorCode: ServiceErrorCode;
  retryable: boolean;
  message: string;
  upstreamStatus?: number;
  diagnosticDetail?: string;
}): MappedGeminiProviderError {
  return {
    category: params.category,
    httpStatus: params.httpStatus,
    serviceErrorCode: params.serviceErrorCode,
    retryable: params.retryable,
    message: params.message,
    ...(params.upstreamStatus !== undefined
      ? { upstreamStatus: params.upstreamStatus }
      : {}),
    ...(params.diagnosticDetail !== undefined
      ? { diagnosticDetail: params.diagnosticDetail }
      : {}),
    normalized: {
      providerId: GEMINI_PROVIDER_ID,
      code: params.serviceErrorCode,
      message: params.message,
      retryable: params.retryable,
      ...(params.upstreamStatus !== undefined
        ? { upstreamStatus: params.upstreamStatus }
        : {}),
    },
  };
}

export function mapGeminiProviderError(
  error: unknown,
  extraSecrets: readonly (string | undefined)[] = [],
): MappedGeminiProviderError {
  if (error instanceof GeminiConfigurationError) {
    const safeMsg = sanitizeDiagnosticMessage(error.message, extraSecrets);
    const serviceErrorCode: ServiceErrorCode =
      error.category === 'MISSING_CREDENTIAL' ||
      error.category === 'INVALID_CONFIGURATION' ||
      error.category === 'INVALID_MODEL_CONFIGURATION'
        ? 'VALIDATION_ERROR'
        : 'PROVIDER_ERROR';

    return buildMappedError({
      category: error.category,
      httpStatus: error.category === 'MISSING_CREDENTIAL' ? 503 : 400,
      serviceErrorCode,
      retryable: false,
      message: safeMsg,
    });
  }

  if (error instanceof GeminiSdkInitializationError) {
    return buildMappedError({
      category: 'SDK_INITIALIZATION_FAILURE',
      httpStatus: 500,
      serviceErrorCode: 'PROVIDER_ERROR',
      retryable: false,
      message:
        sanitizeDiagnosticMessage(error.message, extraSecrets) ||
        'Failed to initialize the server-side Gemini SDK client.',
    });
  }

  if (error instanceof GeminiResponseError) {
    return buildMappedError({
      category: 'UNKNOWN_PROVIDER_ERROR',
      httpStatus: 502,
      serviceErrorCode: 'PROVIDER_ERROR',
      retryable: error.reason === 'EMPTY_RESPONSE',
      message: sanitizeDiagnosticMessage(error.message, extraSecrets),
    });
  }

  const upstreamStatus = extractHttpStatus(error);
  const rawText = sanitizeDiagnosticMessage(
    extractRawErrorText(error),
    extraSecrets,
  );
  const diagnosticDetail = rawText.length > 240 ? `${rawText.slice(0, 237)}...` : rawText;
  const lower = rawText.toLowerCase();

  if (
    upstreamStatus === 413 ||
    lower.includes('payload too large') ||
    lower.includes('request entity too large') ||
    lower.includes('request size exceeds')
  ) {
    return buildMappedError({
      category: 'INVALID_CONFIGURATION',
      httpStatus: 413,
      serviceErrorCode: 'VALIDATION_ERROR',
      retryable: false,
      message:
        'Source image exceeds the Gemini Vision inline request size limit. Choose a smaller image rather than transforming the original.',
      upstreamStatus: upstreamStatus ?? 413,
      diagnosticDetail,
    });
  }

  if (
    lower.includes('aborterror') ||
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('etimedout') ||
    upstreamStatus === 408 ||
    upstreamStatus === 504
  ) {
    return buildMappedError({
      category: 'NETWORK_TIMEOUT',
      httpStatus: 504,
      serviceErrorCode: 'PROVIDER_UNAVAILABLE',
      retryable: true,
      message: 'Gemini provider request timed out before receiving a response.',
      upstreamStatus,
      diagnosticDetail,
    });
  }

  if (
    upstreamStatus === 401 ||
    lower.includes('api_key_invalid') ||
    lower.includes('api key not valid') ||
    lower.includes('invalid api key') ||
    lower.includes('unauthenticated') ||
    lower.includes('unauthorized')
  ) {
    return buildMappedError({
      category: 'AUTHENTICATION_FAILURE',
      httpStatus: 401,
      serviceErrorCode: 'PROVIDER_ERROR',
      retryable: false,
      message:
        'Gemini provider authentication failed. Verify the server GEMINI_API_KEY secret.',
      upstreamStatus: upstreamStatus ?? 401,
      diagnosticDetail,
    });
  }

  if (
    upstreamStatus === 403 ||
    lower.includes('permission_denied') ||
    lower.includes('permission denied') ||
    lower.includes('forbidden') ||
    lower.includes('billing')
  ) {
    return buildMappedError({
      category: 'PERMISSION_FAILURE',
      httpStatus: 403,
      serviceErrorCode: 'PROVIDER_ERROR',
      retryable: false,
      message:
        'Gemini provider denied access to the configured model or project.',
      upstreamStatus: upstreamStatus ?? 403,
      diagnosticDetail,
    });
  }

  if (
    upstreamStatus === 429 ||
    lower.includes('resource_exhausted') ||
    lower.includes('rate limit') ||
    lower.includes('quota') ||
    lower.includes('too many requests')
  ) {
    return buildMappedError({
      category: 'RATE_LIMIT',
      httpStatus: 429,
      serviceErrorCode: 'PROVIDER_UNAVAILABLE',
      retryable: true,
      message: 'Gemini provider rate limit or quota threshold reached. Try again shortly.',
      upstreamStatus: upstreamStatus ?? 429,
      diagnosticDetail,
    });
  }

  if (
    upstreamStatus === 404 ||
    (lower.includes('model') &&
      (lower.includes('not found') ||
        lower.includes('unsupported') ||
        lower.includes('invalid argument')))
  ) {
    return buildMappedError({
      category: 'INVALID_MODEL_CONFIGURATION',
      httpStatus: 400,
      serviceErrorCode: 'VALIDATION_ERROR',
      retryable: false,
      message:
        'Configured Gemini model identifier was rejected or not found by the provider.',
      upstreamStatus,
      diagnosticDetail,
    });
  }

  if (
    upstreamStatus === 500 ||
    upstreamStatus === 502 ||
    upstreamStatus === 503 ||
    lower.includes('unavailable') ||
    lower.includes('overloaded') ||
    lower.includes('econnrefused') ||
    lower.includes('econnreset') ||
    lower.includes('epipe') ||
    lower.includes('socket hang up') ||
    lower.includes('und_err') ||
    lower.includes('enotfound') ||
    lower.includes('eai_again') ||
    lower.includes('fetch failed') ||
    lower.includes('network')
  ) {
    return buildMappedError({
      category: 'PROVIDER_UNAVAILABLE',
      httpStatus: 503,
      serviceErrorCode: 'PROVIDER_UNAVAILABLE',
      retryable: true,
      message:
        'Gemini provider service is temporarily unreachable or unavailable.',
      upstreamStatus: upstreamStatus ?? 503,
      diagnosticDetail,
    });
  }

  return buildMappedError({
    category: 'UNKNOWN_PROVIDER_ERROR',
    httpStatus: 502,
    serviceErrorCode: 'PROVIDER_ERROR',
    retryable: false,
    message:
      rawText.length > 0
        ? `Gemini provider error: ${rawText}`
        : 'An unexpected error occurred while communicating with Gemini.',
    upstreamStatus,
    diagnosticDetail,
  });
}

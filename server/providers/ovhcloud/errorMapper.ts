import type { ServiceErrorCode } from '../../../src/types/common.ts';
import type { ImageGenerationProviderErrorCategory } from '../../../src/types/providers.ts';
import { sanitizeDiagnosticMessage } from '../../middleware/security.ts';
import { InvalidGeneratedImageError } from './imageBinaryInspector.ts';

export interface MappedOvhcloudError {
  readonly category: ImageGenerationProviderErrorCategory;
  readonly httpStatus: number;
  readonly serviceErrorCode: ServiceErrorCode;
  readonly retryable: boolean;
  readonly message: string;
  readonly upstreamStatus?: number;
  readonly retryAfterSeconds?: number;
}

export class OvhcloudHttpError extends Error {
  readonly status: number;
  readonly retryAfterSeconds?: number;

  constructor(
    status: number,
    message: string,
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'OvhcloudHttpError';
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class OvhcloudConfigurationError extends Error {
  readonly category: ImageGenerationProviderErrorCategory;

  constructor(
    category: ImageGenerationProviderErrorCategory,
    message: string,
  ) {
    super(message);
    this.name = 'OvhcloudConfigurationError';
    this.category = category;
  }
}

export function parseRetryAfterSeconds(
  headerValue: string | null,
): number | undefined {
  if (!headerValue) {
    return undefined;
  }
  const trimmed = headerValue.trim();
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && numeric >= 0) {
    return Math.ceil(numeric);
  }
  const targetMs = Date.parse(trimmed);
  if (Number.isFinite(targetMs)) {
    const diffSeconds = Math.ceil((targetMs - Date.now()) / 1000);
    return diffSeconds > 0 ? diffSeconds : 1;
  }
  return undefined;
}

export function mapOvhcloudProviderError(
  error: unknown,
  options: {
    readonly extraSecrets?: readonly (string | undefined)[];
    readonly timedOut?: boolean;
    readonly cancelled?: boolean;
  } = {},
): MappedOvhcloudError {
  const secrets = options.extraSecrets ?? [];

  if (options.cancelled && !options.timedOut) {
    return {
      category: 'CANCELLED',
      httpStatus: 499,
      serviceErrorCode: 'PROVIDER_UNAVAILABLE',
      retryable: true,
      message: 'OVHcloud image generation request was cancelled.',
    };
  }

  if (options.timedOut) {
    return {
      category: 'NETWORK_TIMEOUT',
      httpStatus: 504,
      serviceErrorCode: 'PROVIDER_UNAVAILABLE',
      retryable: true,
      message:
        'OVHcloud AI Endpoints request timed out before receiving a response.',
    };
  }

  if (error instanceof OvhcloudConfigurationError) {
    return {
      category: error.category,
      httpStatus:
        error.category === 'MISSING_CREDENTIAL' ||
        error.category === 'UNAVAILABLE'
          ? 503
          : 400,
      serviceErrorCode:
        error.category === 'UNAVAILABLE'
          ? 'PROVIDER_UNAVAILABLE'
          : 'VALIDATION_ERROR',
      retryable: false,
      message: sanitizeDiagnosticMessage(error.message, secrets),
    };
  }

  if (error instanceof InvalidGeneratedImageError) {
    return {
      category: 'INVALID_RESPONSE',
      httpStatus: 502,
      serviceErrorCode: 'PROVIDER_ERROR',
      retryable: true,
      message: sanitizeDiagnosticMessage(error.message, secrets),
    };
  }

  if (error instanceof OvhcloudHttpError) {
    const safeMsg = sanitizeDiagnosticMessage(error.message, secrets);

    if (error.status === 429) {
      const retryNote = error.retryAfterSeconds
        ? ` Retry after approximately ${error.retryAfterSeconds}s.`
        : '';
      return {
        category: 'RATE_LIMITED',
        httpStatus: 429,
        serviceErrorCode: 'PROVIDER_UNAVAILABLE',
        retryable: true,
        upstreamStatus: 429,
        ...(error.retryAfterSeconds !== undefined
          ? { retryAfterSeconds: error.retryAfterSeconds }
          : {}),
        message: `OVHcloud AI Endpoints rate limit reached (anonymous tier is capped at 2 requests/min per IP).${retryNote}`,
      };
    }

    if (error.status === 401) {
      return {
        category: 'AUTHENTICATION_FAILURE',
        httpStatus: 401,
        serviceErrorCode: 'PROVIDER_ERROR',
        retryable: false,
        upstreamStatus: 401,
        message:
          'OVHcloud AI Endpoints rejected authentication credentials. Verify OVH_AI_ENDPOINTS_ACCESS_TOKEN on the server.',
      };
    }

    if (error.status === 403) {
      return {
        category: 'PERMISSION_FAILURE',
        httpStatus: 403,
        serviceErrorCode: 'PROVIDER_ERROR',
        retryable: false,
        upstreamStatus: 403,
        message:
          'OVHcloud AI Endpoints denied access to the Stable Diffusion XL endpoint.',
      };
    }

    if (error.status === 404 || error.status === 410) {
      return {
        category: 'UNAVAILABLE',
        httpStatus: 503,
        serviceErrorCode: 'PROVIDER_UNAVAILABLE',
        retryable: false,
        upstreamStatus: error.status,
        message:
          'OVHcloud free-tier Stable Diffusion XL endpoint or model is currently unavailable (HTTP ' +
          `${error.status}). Automatic paid fallback is disabled.`,
      };
    }

    if (error.status >= 400 && error.status < 500) {
      return {
        category: 'INVALID_CONFIGURATION',
        httpStatus: 400,
        serviceErrorCode: 'VALIDATION_ERROR',
        retryable: false,
        upstreamStatus: error.status,
        message:
          safeMsg ||
          `OVHcloud AI Endpoints rejected the request (HTTP ${error.status}).`,
      };
    }

    return {
      category: 'PROVIDER_UNAVAILABLE',
      httpStatus: 503,
      serviceErrorCode: 'PROVIDER_UNAVAILABLE',
      retryable: true,
      upstreamStatus: error.status,
      message: `OVHcloud AI Endpoints returned a server error (HTTP ${error.status}).`,
    };
  }

  const rawText = sanitizeDiagnosticMessage(
    error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    secrets,
  );
  const lower = rawText.toLowerCase();

  if (
    lower.includes('abort') ||
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('etimedout')
  ) {
    return {
      category: 'NETWORK_TIMEOUT',
      httpStatus: 504,
      serviceErrorCode: 'PROVIDER_UNAVAILABLE',
      retryable: true,
      message:
        'OVHcloud AI Endpoints request timed out before receiving a response.',
    };
  }

  if (
    lower.includes('fetch failed') ||
    lower.includes('enotfound') ||
    lower.includes('econnrefused') ||
    lower.includes('eai_again') ||
    lower.includes('network')
  ) {
    return {
      category: 'PROVIDER_UNAVAILABLE',
      httpStatus: 503,
      serviceErrorCode: 'PROVIDER_UNAVAILABLE',
      retryable: true,
      message:
        'Unable to reach OVHcloud AI Endpoints from the server runtime.',
    };
  }

  return {
    category: 'UNKNOWN_PROVIDER_ERROR',
    httpStatus: 502,
    serviceErrorCode: 'PROVIDER_ERROR',
    retryable: false,
    message: rawText
      ? `OVHcloud provider error: ${rawText}`
      : 'Unexpected error communicating with OVHcloud AI Endpoints.',
  };
}

import type {
  GeminiErrorCategory,
  GeminiProviderPublicStatus,
} from '../../types/providers.ts';

export interface GeminiStatusApiResponse {
  readonly ok: boolean;
  readonly data?: GeminiProviderPublicStatus;
  readonly error?: {
    readonly code: string;
    readonly category?: GeminiErrorCategory;
    readonly message: string;
    readonly retryable?: boolean;
  };
}

export async function fetchGeminiProviderStatus(): Promise<GeminiStatusApiResponse> {
  try {
    const response = await fetch('/api/providers/gemini/status', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    const json = (await response.json()) as GeminiStatusApiResponse;
    return json;
  } catch {
    return {
      ok: false,
      error: {
        code: 'PROVIDER_UNAVAILABLE',
        category: 'PROVIDER_UNAVAILABLE',
        message: 'Unable to reach the local FormFusion server status endpoint.',
        retryable: true,
      },
    };
  }
}

export async function verifyGeminiProviderConnectivity(): Promise<GeminiStatusApiResponse> {
  try {
    const response = await fetch('/api/providers/gemini/verify', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    const json = (await response.json()) as GeminiStatusApiResponse;
    return json;
  } catch {
    return {
      ok: false,
      error: {
        code: 'PROVIDER_UNAVAILABLE',
        category: 'PROVIDER_UNAVAILABLE',
        message: 'Unable to reach the local FormFusion server connectivity endpoint.',
        retryable: true,
      },
    };
  }
}

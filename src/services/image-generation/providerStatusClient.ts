import type {
  ImageGenerationProviderCapabilities,
  ImageGenerationProviderErrorCategory,
  ImageGenerationProviderPublicStatus,
  ImageGenerationSmokeTestResult,
  RegisteredImageGenerationProviderSummary,
} from '../../types/providers.ts';

export interface ImageGenerationStatusApiResponse {
  readonly ok: boolean;
  readonly data?: ImageGenerationProviderPublicStatus;
  readonly error?: {
    readonly code: string;
    readonly category?: ImageGenerationProviderErrorCategory;
    readonly message: string;
    readonly retryable?: boolean;
  };
}

export interface ImageGenerationCapabilitiesApiResponse {
  readonly ok: boolean;
  readonly data?: ImageGenerationProviderCapabilities;
  readonly error?: {
    readonly code: string;
    readonly message: string;
  };
}

export interface ImageGenerationProviderListApiResponse {
  readonly ok: boolean;
  readonly data?: {
    readonly providers: readonly RegisteredImageGenerationProviderSummary[];
    readonly activeProviderId: string | null;
  };
  readonly error?: {
    readonly code: string;
    readonly message: string;
  };
}

export interface ImageGenerationHealthApiResponse {
  readonly ok: boolean;
  readonly data?: {
    readonly status: ImageGenerationProviderPublicStatus;
    readonly capabilities: ImageGenerationProviderCapabilities;
    readonly reachable: boolean;
  };
  readonly error?: {
    readonly code: string;
    readonly category?: ImageGenerationProviderErrorCategory;
    readonly message: string;
    readonly retryable?: boolean;
  };
}

export interface ImageGenerationSmokeTestApiResponse {
  readonly ok: boolean;
  readonly data?: ImageGenerationSmokeTestResult;
  readonly status?: ImageGenerationProviderPublicStatus;
  readonly error?: {
    readonly code: string;
    readonly category?: ImageGenerationProviderErrorCategory;
    readonly message: string;
    readonly retryable?: boolean;
  };
}

export async function fetchImageGenerationProviderStatus(): Promise<ImageGenerationStatusApiResponse> {
  try {
    const response = await fetch('/api/providers/image-generation/status', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    return (await response.json()) as ImageGenerationStatusApiResponse;
  } catch {
    return {
      ok: false,
      error: {
        code: 'PROVIDER_UNAVAILABLE',
        category: 'PROVIDER_UNAVAILABLE',
        message: 'Unable to reach the local FormFusion server image generation status endpoint.',
        retryable: true,
      },
    };
  }
}

export async function fetchImageGenerationCapabilities(): Promise<ImageGenerationCapabilitiesApiResponse> {
  try {
    const response = await fetch(
      '/api/providers/image-generation/capabilities',
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
      },
    );
    return (await response.json()) as ImageGenerationCapabilitiesApiResponse;
  } catch {
    return {
      ok: false,
      error: {
        code: 'PROVIDER_UNAVAILABLE',
        message: 'Unable to reach the local FormFusion server capabilities endpoint.',
      },
    };
  }
}

export async function fetchRegisteredImageGenerationProviders(): Promise<ImageGenerationProviderListApiResponse> {
  try {
    const response = await fetch('/api/providers/image-generation/list', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    return (await response.json()) as ImageGenerationProviderListApiResponse;
  } catch {
    return {
      ok: false,
      error: {
        code: 'PROVIDER_UNAVAILABLE',
        message: 'Unable to reach the local FormFusion server provider registry endpoint.',
      },
    };
  }
}

export async function testImageGenerationProviderConnection(options?: {
  readonly allowAnonymousFreeTier?: boolean;
}): Promise<ImageGenerationHealthApiResponse> {
  try {
    const response = await fetch('/api/providers/image-generation/health', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(
        options?.allowAnonymousFreeTier !== undefined
          ? { allowAnonymousFreeTier: options.allowAnonymousFreeTier }
          : {},
      ),
    });
    return (await response.json()) as ImageGenerationHealthApiResponse;
  } catch {
    return {
      ok: false,
      error: {
        code: 'PROVIDER_UNAVAILABLE',
        category: 'PROVIDER_UNAVAILABLE',
        message: 'Unable to reach the local FormFusion server provider health endpoint.',
        retryable: true,
      },
    };
  }
}

export async function runImageGenerationSmokeTest(options: {
  readonly confirmed: boolean;
  readonly prompt?: string;
  readonly allowAnonymousFreeTier?: boolean;
}): Promise<ImageGenerationSmokeTestApiResponse> {
  try {
    const response = await fetch('/api/providers/image-generation/smoke-test', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(options),
    });
    return (await response.json()) as ImageGenerationSmokeTestApiResponse;
  } catch {
    return {
      ok: false,
      error: {
        code: 'PROVIDER_UNAVAILABLE',
        category: 'PROVIDER_UNAVAILABLE',
        message: 'Unable to reach the local FormFusion server smoke-test endpoint.',
        retryable: true,
      },
    };
  }
}

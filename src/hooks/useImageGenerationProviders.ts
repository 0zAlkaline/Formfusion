import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchRegisteredImageGenerationProviders,
  testImageGenerationProviderConnection,
} from '../services/image-generation/providerStatusClient.ts';
import type { RegisteredImageGenerationProviderSummary } from '../types/providers.ts';

export interface ImageGenerationProvidersController {
  readonly providers: readonly RegisteredImageGenerationProviderSummary[];
  readonly selectedProviderId: string;
  readonly selectedProvider: RegisteredImageGenerationProviderSummary | null;
  readonly loadingProviders: boolean;
  readonly providerLoadError: string | null;
  readonly testingHealth: boolean;
  readonly allowAnonymousFreeTier: boolean;
  readonly setSelectedProviderId: (providerId: string) => void;
  readonly setAllowAnonymousFreeTier: (allow: boolean) => void;
  readonly loadRegisteredProviders: () => Promise<void>;
  readonly checkProviderConnection: (providerId?: string) => Promise<void>;
}

export function useImageGenerationProviders(): ImageGenerationProvidersController {
  const [providers, setProviders] = useState<
    readonly RegisteredImageGenerationProviderSummary[]
  >([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string>('');
  const [loadingProviders, setLoadingProviders] = useState(true);
  const [providerLoadError, setProviderLoadError] = useState<string | null>(
    null,
  );
  const [testingHealth, setTestingHealth] = useState(false);
  const [allowAnonymousFreeTier, setAllowAnonymousFreeTier] = useState(false);

  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadRegisteredProviders = useCallback(async () => {
    setLoadingProviders(true);
    setProviderLoadError(null);
    const response = await fetchRegisteredImageGenerationProviders();
    if (!isMountedRef.current) {
      return;
    }

    if (!response.ok || !response.data) {
      setProviders([]);
      setProviderLoadError(
        response.error?.message ??
          'Unable to load registered image generation providers.',
      );
      setLoadingProviders(false);
      return;
    }

    const list = response.data.providers;
    setProviders(list);
    setSelectedProviderId((current) => {
      if (current && list.some((item) => item.capabilities.providerId === current)) {
        return current;
      }
      return (
        response.data?.activeProviderId ??
        list[0]?.capabilities.providerId ??
        ''
      );
    });
    setLoadingProviders(false);
  }, []);

  useEffect(() => {
    void loadRegisteredProviders();
  }, [loadRegisteredProviders]);

  const selectedProvider =
    providers.find(
      (item) => item.capabilities.providerId === selectedProviderId,
    ) ??
    providers[0] ??
    null;

  const checkProviderConnection = useCallback(
    async (providerId?: string) => {
      const target =
        (providerId
          ? providers.find(
              (item) => item.capabilities.providerId === providerId,
            )
          : selectedProvider) ?? null;

      if (!target || testingHealth) {
        return;
      }

      setTestingHealth(true);
      setProviderLoadError(null);

      const res = await testImageGenerationProviderConnection({
        ...(allowAnonymousFreeTier ? { allowAnonymousFreeTier: true } : {}),
      });

      if (!isMountedRef.current) {
        return;
      }

      if (res.data?.status && res.data?.capabilities) {
        const updatedStatus = res.data.status;
        const updatedCapabilities = res.data.capabilities;
        setProviders((prev) =>
          prev.map((item) =>
            item.capabilities.providerId === updatedCapabilities.providerId
              ? {
                  ...item,
                  capabilities: updatedCapabilities,
                  status: updatedStatus,
                }
              : item,
          ),
        );
      }

      if (!res.ok) {
        setProviderLoadError(
          res.error?.message ?? 'Provider connection test failed.',
        );
      }

      setTestingHealth(false);
    },
    [allowAnonymousFreeTier, providers, selectedProvider, testingHealth],
  );

  return {
    providers,
    selectedProviderId,
    selectedProvider,
    loadingProviders,
    providerLoadError,
    testingHealth,
    allowAnonymousFreeTier,
    setSelectedProviderId,
    setAllowAnonymousFreeTier,
    loadRegisteredProviders,
    checkProviderConnection,
  };
}

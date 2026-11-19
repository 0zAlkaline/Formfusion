import type {
  ImageGenerationExecutionOptions,
  ImageGenerationHealthCheckResult,
  ImageGenerationProvider,
  ImageGenerationProviderCapabilities,
  ImageGenerationProviderPublicStatus,
  RegisteredImageGenerationProviderSummary,
} from '../../../src/types/providers.ts';
import type { ServerProviderRegistry } from '../providerRegistry.ts';

export class ProviderCapabilityService {
  private readonly registry: ServerProviderRegistry;

  constructor(registry: ServerProviderRegistry) {
    this.registry = registry;
  }

  getActiveCapabilities(): ImageGenerationProviderCapabilities | null {
    const provider = this.registry.getActiveImageGenerationProvider();
    return provider ? provider.getCapabilities() : null;
  }

  listCapabilities(): readonly ImageGenerationProviderCapabilities[] {
    return this.registry
      .listImageGenerationProviders()
      .map((provider) => provider.getCapabilities());
  }

  getCapabilitiesForProvider(
    providerId: string,
  ): ImageGenerationProviderCapabilities | null {
    const provider = this.registry.getImageGenerationProvider(providerId);
    return provider ? provider.getCapabilities() : null;
  }
}

export class ProviderConfigurationService {
  private readonly registry: ServerProviderRegistry;

  constructor(registry: ServerProviderRegistry) {
    this.registry = registry;
  }

  getActiveProvider(): ImageGenerationProvider | undefined {
    return this.registry.getActiveImageGenerationProvider();
  }

  getProviderById(providerId: string): ImageGenerationProvider | undefined {
    return this.registry.getImageGenerationProvider(providerId);
  }

  getActivePublicStatus(): ImageGenerationProviderPublicStatus | null {
    const provider = this.registry.getActiveImageGenerationProvider();
    return provider ? provider.getPublicStatus() : null;
  }

  listRegisteredProviderSummaries(): readonly RegisteredImageGenerationProviderSummary[] {
    const activeId = this.registry.getActiveImageGenerationProvider()?.providerId ?? null;
    return this.registry.listImageGenerationProviders().map((provider) => ({
      status: provider.getPublicStatus(),
      capabilities: provider.getCapabilities(),
      isActive: provider.providerId === activeId,
    }));
  }
}

export class ProviderHealthService {
  private readonly registry: ServerProviderRegistry;

  constructor(registry: ServerProviderRegistry) {
    this.registry = registry;
  }

  async checkActiveProviderHealth(
    options?: ImageGenerationExecutionOptions,
  ): Promise<ImageGenerationHealthCheckResult | null> {
    const provider = this.registry.getActiveImageGenerationProvider();
    if (!provider) {
      return null;
    }
    return provider.checkHealth(options);
  }
}

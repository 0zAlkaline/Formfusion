import type {
  ImageGenerationProvider,
  ImageGenerationProviderAdapter,
  ProviderCapabilityDeclaration,
  VisionAnalysisProviderAdapter,
} from '../../src/types/providers.ts';
import { GEMINI_PROVIDER_ID } from './gemini/config.ts';
import {
  createGeminiPromptComposerProvider,
  GeminiPromptComposerProvider,
  type GeminiPromptComposerOptions,
} from './gemini/geminiPromptComposer.ts';
import {
  createGeminiVisionProvider,
  GeminiVisionProvider,
  type GeminiVisionProviderOptions,
} from './gemini/geminiVisionProvider.ts';
import { OVHCLOUD_PROVIDER_ID } from './ovhcloud/config.ts';
import {
  createOvhcloudSdxlProvider,
  type OvhcloudSdxlProviderOptions,
} from './ovhcloud/ovhcloudSdxlProvider.ts';

export interface ServerProviderRegistryOptions {
  readonly gemini?: GeminiVisionProviderOptions;
  readonly geminiPromptComposer?: GeminiPromptComposerOptions;
  readonly ovhcloud?: OvhcloudSdxlProviderOptions;
}

export class ServerProviderRegistry {
  private readonly visionAdapters = new Map<string, VisionAnalysisProviderAdapter>();
  private readonly imageAdapters = new Map<string, ImageGenerationProviderAdapter>();
  private readonly imageGenerationProviders = new Map<string, ImageGenerationProvider>();
  private activeImageGenerationProviderId: string | null = null;
  private promptComposerProvider: GeminiPromptComposerProvider | undefined;

  registerVisionAdapter(adapter: VisionAnalysisProviderAdapter): void {
    this.visionAdapters.set(adapter.providerId, adapter);
  }

  registerImageGenerationAdapter(adapter: ImageGenerationProviderAdapter): void {
    this.imageAdapters.set(adapter.providerId, adapter);
  }

  registerImageGenerationProvider(
    provider: ImageGenerationProvider,
    options: { readonly setActive?: boolean } = {},
  ): void {
    this.imageGenerationProviders.set(provider.providerId, provider);
    if (options.setActive === true || this.activeImageGenerationProviderId === null) {
      this.activeImageGenerationProviderId = provider.providerId;
    }
  }

  registerPromptComposerProvider(provider: GeminiPromptComposerProvider): void {
    this.promptComposerProvider = provider;
  }

  getVisionAdapter(providerId: string): VisionAnalysisProviderAdapter | undefined {
    return this.visionAdapters.get(providerId);
  }

  getGeminiVisionProvider(): GeminiVisionProvider | undefined {
    const adapter = this.visionAdapters.get(GEMINI_PROVIDER_ID);
    return adapter instanceof GeminiVisionProvider ? adapter : undefined;
  }

  getGeminiPromptComposerProvider(): GeminiPromptComposerProvider | undefined {
    return this.promptComposerProvider;
  }

  getImageGenerationAdapter(
    providerId: string,
  ): ImageGenerationProviderAdapter | undefined {
    return this.imageAdapters.get(providerId);
  }

  getImageGenerationProvider(
    providerId: string,
  ): ImageGenerationProvider | undefined {
    return this.imageGenerationProviders.get(providerId);
  }

  getActiveImageGenerationProvider(): ImageGenerationProvider | undefined {
    if (!this.activeImageGenerationProviderId) {
      return undefined;
    }
    return this.imageGenerationProviders.get(this.activeImageGenerationProviderId);
  }

  setActiveImageGenerationProvider(providerId: string): boolean {
    if (!this.imageGenerationProviders.has(providerId)) {
      return false;
    }
    this.activeImageGenerationProviderId = providerId;
    return true;
  }

  listImageGenerationProviders(): readonly ImageGenerationProvider[] {
    return Array.from(this.imageGenerationProviders.values());
  }

  listRegisteredCapabilities(): readonly ProviderCapabilityDeclaration[] {
    return [
      ...Array.from(this.visionAdapters.values(), (adapter) =>
        adapter.getCapabilities(),
      ),
      ...Array.from(this.imageAdapters.values(), (adapter) =>
        adapter.getCapabilities(),
      ),
      ...Array.from(this.imageGenerationProviders.values(), (provider) => {
        const caps = provider.getCapabilities();
        return {
          providerId: caps.providerId,
          kind: 'text_to_image' as const,
          displayName: caps.providerName,
          supportedModels: [caps.modelId],
          supportsNegativePrompt: caps.supportsNegativePrompt,
          supportedAspectRatios: caps.supportedOutputSizes.map((s) => s.aspectRatio),
          maxPromptLength: caps.maxPromptLength,
          maxOutputResolution: {
            width: caps.supportedOutputSizes[0]?.width ?? 1024,
            height: caps.supportedOutputSizes[0]?.height ?? 1024,
          },
          supportsSeed: caps.supportsSeed,
        };
      }),
    ];
  }
}

export function createServerProviderRegistry(
  options: ServerProviderRegistryOptions = {},
): ServerProviderRegistry {
  const registry = new ServerProviderRegistry();
  registry.registerVisionAdapter(createGeminiVisionProvider(options.gemini));
  registry.registerPromptComposerProvider(
    createGeminiPromptComposerProvider(options.geminiPromptComposer),
  );
  const ovhProvider = createOvhcloudSdxlProvider(options.ovhcloud);
  registry.registerImageGenerationProvider(ovhProvider, { setActive: true });
  registry.setActiveImageGenerationProvider(OVHCLOUD_PROVIDER_ID);
  return registry;
}

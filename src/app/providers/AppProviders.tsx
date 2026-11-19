import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { StudioArtStyleService } from '../../services/art-style/contract.ts';
import { StudioExportService } from '../../services/export/artworkExportService.ts';
import { ImageGenerationServiceFoundation } from '../../services/image-generation/contract.ts';
import { StudioObjectDescriptionService } from '../../services/object-description/contract.ts';
import { ObjectIdentificationServiceFoundation } from '../../services/object-identification/contract.ts';
import { StudioPresetService } from '../../services/presets/presetService.ts';
import {
  BrowserProjectStorageService,
  type GenerationStorageService,
  type ObjectDescriptionStorageService,
  type ProjectCreativeStateStorageService,
  type ProjectManagementStorageService,
  type PromptDocumentStorageService,
  type SourceAssetStorageService,
} from '../../services/project-storage/browserProjectStorage.ts';
import { BrowserIndexedDbStorageGateway } from '../../services/project-storage/indexedDbGateway.ts';
import { StudioPromptComposerService } from '../../services/prompt-composer/contract.ts';
import type {
  ArtStyleService,
  ExportService,
  ImageGenerationService,
  ObjectDescriptionService,
  ObjectIdentificationService,
  PresetEngineService,
  ProjectStorageService,
  PromptComposerService,
} from '../../types/services.ts';
import type { IndexedDbStorageGateway } from '../../types/storage.ts';

export interface FormFusionServiceContainer {
  readonly objectIdentification: ObjectIdentificationService;
  readonly objectDescription: ObjectDescriptionService;
  readonly artStyle: ArtStyleService;
  readonly presetEngine: PresetEngineService;
  readonly promptComposer: PromptComposerService;
  readonly imageGeneration: ImageGenerationService;
  readonly storageGateway: IndexedDbStorageGateway;
  readonly projectStorage: ProjectStorageService;
  readonly projectManagementStorage: ProjectManagementStorageService;
  readonly sourceAssetStorage: SourceAssetStorageService;
  readonly objectDescriptionStorage: ObjectDescriptionStorageService;
  readonly promptStorage: PromptDocumentStorageService;
  readonly generationStorage: GenerationStorageService;
  readonly creativeStateStorage: ProjectCreativeStateStorageService;
  readonly exportService: ExportService;
}

const ServiceContainerContext = createContext<FormFusionServiceContainer | null>(
  null,
);

export function createFoundationServiceContainer(): FormFusionServiceContainer {
  const storageGateway = new BrowserIndexedDbStorageGateway();
  const projectStorageService = new BrowserProjectStorageService(storageGateway);
  return {
    objectIdentification: new ObjectIdentificationServiceFoundation(),
    objectDescription: new StudioObjectDescriptionService(),
    artStyle: new StudioArtStyleService(storageGateway),
    presetEngine: new StudioPresetService(storageGateway),
    promptComposer: new StudioPromptComposerService(),
    imageGeneration: new ImageGenerationServiceFoundation(),
    storageGateway,
    projectStorage: projectStorageService,
    projectManagementStorage: projectStorageService,
    sourceAssetStorage: projectStorageService,
    objectDescriptionStorage: projectStorageService,
    promptStorage: projectStorageService,
    generationStorage: projectStorageService,
    creativeStateStorage: projectStorageService,
    exportService: new StudioExportService(storageGateway),
  };
}

export function AppProviders({ children }: { readonly children: ReactNode }) {
  const services = useMemo(() => createFoundationServiceContainer(), []);

  return (
    <ServiceContainerContext.Provider value={services}>
      {children}
    </ServiceContainerContext.Provider>
  );
}

export function useStudioServices(): FormFusionServiceContainer {
  const ctx = useContext(ServiceContainerContext);
  if (ctx === null) {
    throw new Error('useStudioServices must be used inside AppProviders.');
  }
  return ctx;
}

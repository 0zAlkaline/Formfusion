import { Router } from 'express';
import type { ServerProviderRegistry } from '../providers/providerRegistry.ts';

export function createHealthRouter(registry: ServerProviderRegistry): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.status(200).json({
      ok: true,
      application: 'FormFusion',
      version: '2.0.0',
      phase: '01.1',
      boundaries: {
        visionAndGenerationSeparated: true,
        credentialsServerSideOnly: true,
        persistentStorageDeferred: true,
      },
      registeredProviders: registry.listRegisteredCapabilities(),
    });
  });

  return router;
}

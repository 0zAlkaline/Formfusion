import 'dotenv/config';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { redactSecretValues, setSecurityHeaders } from './server/middleware/security.ts';
import {
  createServerProviderRegistry,
  type ServerProviderRegistry,
} from './server/providers/providerRegistry.ts';
import { createApiRouter } from './server/routes/api.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface CreateServerAppOptions {
  readonly registry?: ServerProviderRegistry;
}

export function createServerApp(
  options: CreateServerAppOptions = {},
): express.Express {
  const app = express();
  const registry = options.registry ?? createServerProviderRegistry();

  app.disable('x-powered-by');
  app.use(setSecurityHeaders);
  app.use(express.json({ limit: '1mb' }));

  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Malformed JSON request payload.',
        },
      });
      return;
    }
    next(err);
  });

  app.use('/api', createApiRouter(registry));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const rawMessage =
      err instanceof Error ? err.message : 'Unexpected server error.';
    console.error('[FormFusion Server Error]', redactSecretValues(rawMessage));
    res.status(500).json({
      ok: false,
      error: {
        code: 'PROVIDER_ERROR',
        message: 'Internal server error.',
      },
    });
  });

  return app;
}

async function startServer(): Promise<void> {
  const app = createServerApp();
  const httpServer = http.createServer(app);
  const port = Number(process.env.PORT) || 3000;
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        port,
        ws: { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    const indexHtml = path.join(distDir, 'index.html');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
        return;
      }
      res.status(404).send('Build output not found. Run npm run build first.');
    });
  }

  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`FormFusion server listening on http://0.0.0.0:${port}`);
  });
}

const isEntryModule =
  typeof process.argv[1] === 'string' &&
  path.resolve(process.argv[1]) === __filename;

if (isEntryModule) {
  startServer().catch((err: unknown) => {
    const raw = err instanceof Error ? err.message : String(err);
    console.error('Failed to start FormFusion server:', redactSecretValues(raw));
    process.exit(1);
  });
}

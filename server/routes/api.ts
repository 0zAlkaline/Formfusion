import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { normalizeGenerationRequest } from '../../src/services/image-generation/generationNormalizer.ts';
import { MAX_SOURCE_IMAGE_BYTES } from '../../src/services/source-asset/imageValidation.ts';
import { requireJsonBody } from '../middleware/security.ts';
import {
  ProviderCapabilityService,
  ProviderConfigurationService,
  ProviderHealthService,
} from '../providers/imageGeneration/providerServices.ts';
import type { ServerProviderRegistry } from '../providers/providerRegistry.ts';
import {
  validateGeminiVerifyPayload,
  validateImageGenerationHealthCheckPayload,
  validateImageGenerationSmokeTestPayload,
  validateServerImageGenerationPayload,
  validateServerPromptSynthesisPayload,
  validateServerVisionIdentificationPayload,
} from '../services/boundaryGuards.ts';
import { validateVisionMultipartRequest } from '../services/visionImageValidation.ts';
import { createHealthRouter } from './health.ts';

function createVisionUploadMiddleware() {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: MAX_SOURCE_IMAGE_BYTES,
      files: 1,
      fields: 10,
      fieldSize: 8192,
    },
  }).single('image');

  return (req: Request, res: Response, next: NextFunction): void => {
    const contentType = (req.headers['content-type'] ?? '').toLowerCase();
    if (!contentType.includes('multipart/form-data')) {
      res.status(415).json({
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Content-Type must be multipart/form-data for source image analysis.',
        },
      });
      return;
    }

    upload(req, res, (err: unknown) => {
      if (!err) {
        next();
        return;
      }

      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          res.status(413).json({
            ok: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Uploaded source image exceeds the 20 MB maximum upload limit.',
            },
          });
          return;
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
          res.status(400).json({
            ok: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Only a single binary image file under field "image" is accepted.',
            },
          });
          return;
        }
        res.status(400).json({
          ok: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Malformed multipart image upload payload.',
          },
        });
        return;
      }

      res.status(400).json({
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Unable to parse multipart source image upload.',
        },
      });
    });
  };
}

export function createApiRouter(registry: ServerProviderRegistry): Router {
  const router = Router();
  const handleVisionUpload = createVisionUploadMiddleware();
  const capabilityService = new ProviderCapabilityService(registry);
  const configurationService = new ProviderConfigurationService(registry);
  const healthService = new ProviderHealthService(registry);

  router.use(createHealthRouter(registry));

  router.get('/providers/gemini/status', (_req, res) => {
    const geminiProvider = registry.getGeminiVisionProvider();
    if (!geminiProvider) {
      res.status(503).json({
        ok: false,
        error: {
          code: 'PROVIDER_UNAVAILABLE',
          category: 'SDK_INITIALIZATION_FAILURE',
          message: 'Gemini Vision provider is not registered on the server.',
        },
      });
      return;
    }

    res.status(200).json({
      ok: true,
      data: geminiProvider.getStatus(),
    });
  });

  router.all('/providers/gemini/status', (_req, res) => {
    res.setHeader('Allow', 'GET');
    res.status(405).json({
      ok: false,
      error: {
        code: 'UNSUPPORTED_OPERATION',
        message: 'Method not allowed. Use GET for Gemini provider status.',
      },
    });
  });

  router.post(
    '/providers/gemini/verify',
    requireJsonBody,
    async (req, res, next) => {
      try {
        const validation = validateGeminiVerifyPayload(req.body);
        if (!validation.ok) {
          const status =
            validation.error.code === 'SECURITY_BOUNDARY_VIOLATION' ? 403 : 400;
          res.status(status).json(validation);
          return;
        }

        const geminiProvider = registry.getGeminiVisionProvider();
        if (!geminiProvider) {
          res.status(503).json({
            ok: false,
            error: {
              code: 'PROVIDER_UNAVAILABLE',
              category: 'SDK_INITIALIZATION_FAILURE',
              message: 'Gemini Vision provider is not registered on the server.',
              retryable: false,
            },
          });
          return;
        }

        const result = await geminiProvider.verifyConnectivity();
        if (result.mappedError) {
          res.status(result.mappedError.httpStatus).json({
            ok: false,
            error: {
              code: result.mappedError.serviceErrorCode,
              category: result.mappedError.category,
              message: result.mappedError.message,
              retryable: result.mappedError.retryable,
            },
            data: result.status,
          });
          return;
        }

        res.status(200).json({
          ok: true,
          data: result.status,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.all('/providers/gemini/verify', (_req, res) => {
    res.setHeader('Allow', 'POST');
    res.status(405).json({
      ok: false,
      error: {
        code: 'UNSUPPORTED_OPERATION',
        message: 'Method not allowed. Use POST to verify Gemini connectivity.',
      },
    });
  });

  router.post(
    '/vision/analyze',
    handleVisionUpload,
    async (req, res, next) => {
      const requestAbortController = new AbortController();
      const onConnectionClose = () => {
        if (!res.writableEnded) {
          requestAbortController.abort(
            new Error('Client closed connection before Vision analysis completed.'),
          );
        }
      };
      res.on('close', onConnectionClose);

      try {
        const validation = validateVisionMultipartRequest({
          fields: req.body,
          file: req.file,
        });

        if (!validation.ok) {
          const status =
            validation.error.code === 'SECURITY_BOUNDARY_VIOLATION'
              ? 403
              : validation.error.details?.maxInlineBytes !== undefined
                ? 413
                : 400;
          res.status(status).json(validation);
          return;
        }

        const geminiProvider = registry.getGeminiVisionProvider();
        if (!geminiProvider) {
          res.status(503).json({
            ok: false,
            error: {
              code: 'PROVIDER_UNAVAILABLE',
              category: 'SDK_INITIALIZATION_FAILURE',
              message: 'Gemini Vision provider is not registered on the server.',
              retryable: false,
            },
          });
          return;
        }

        const analysisResult = await geminiProvider.analyzeRawImage({
          projectId: validation.data.projectId,
          sourceAssetId: validation.data.assetId,
          mimeType: validation.data.mimeType,
          imageBytes: validation.data.imageBytes,
          abortSignal: requestAbortController.signal,
        });

        if (res.writableEnded || analysisResult.cancelled) {
          return;
        }

        if (analysisResult.mappedError) {
          res.status(analysisResult.mappedError.httpStatus).json({
            ok: false,
            error: {
              code: analysisResult.mappedError.serviceErrorCode,
              category: analysisResult.mappedError.category,
              message: analysisResult.mappedError.message,
              retryable: analysisResult.mappedError.retryable,
            },
          });
          return;
        }

        if (!analysisResult.result) {
          res.status(502).json({
            ok: false,
            error: {
              code: 'PROVIDER_ERROR',
              category: 'UNKNOWN_PROVIDER_ERROR',
              message: 'Gemini Vision returned no analysis result.',
              retryable: true,
            },
          });
          return;
        }

        res.status(200).json({
          ok: true,
          data: analysisResult.result,
        });
      } catch (error) {
        next(error);
      } finally {
        res.off('close', onConnectionClose);
        if (req.file?.buffer) {
          req.file.buffer.fill(0);
          req.file = undefined;
        }
      }
    },
  );

  router.all('/vision/analyze', (_req, res) => {
    res.setHeader('Allow', 'POST');
    res.status(405).json({
      ok: false,
      error: {
        code: 'UNSUPPORTED_OPERATION',
        message: 'Method not allowed. Use POST with multipart/form-data to analyze a source image.',
      },
    });
  });

  router.post(
    '/prompts/synthesize',
    requireJsonBody,
    async (req, res, next) => {
      const requestAbortController = new AbortController();
      const onConnectionClose = () => {
        if (!res.writableEnded) {
          requestAbortController.abort(
            new Error('Client closed connection before prompt synthesis completed.'),
          );
        }
      };
      res.on('close', onConnectionClose);

      try {
        const validation = validateServerPromptSynthesisPayload(req.body);
        if (!validation.ok) {
          const status =
            validation.error.code === 'SECURITY_BOUNDARY_VIOLATION' ? 403 : 400;
          res.status(status).json(validation);
          return;
        }

        const promptProvider = registry.getGeminiPromptComposerProvider();
        if (!promptProvider) {
          res.status(503).json({
            ok: false,
            error: {
              code: 'PROVIDER_UNAVAILABLE',
              category: 'SDK_INITIALIZATION_FAILURE',
              message: 'Gemini Prompt Composer provider is not registered on the server.',
              retryable: false,
            },
          });
          return;
        }

        const synthesisResult = await promptProvider.synthesizeMasterPrompt({
          ...validation.data,
          abortSignal: requestAbortController.signal,
        });

        if (res.writableEnded || synthesisResult.cancelled) {
          return;
        }

        if (synthesisResult.mappedError) {
          res.status(synthesisResult.mappedError.httpStatus).json({
            ok: false,
            error: {
              code: synthesisResult.mappedError.serviceErrorCode,
              category: synthesisResult.mappedError.category,
              message: synthesisResult.mappedError.message,
              retryable: synthesisResult.mappedError.retryable,
            },
          });
          return;
        }

        if (!synthesisResult.result) {
          res.status(502).json({
            ok: false,
            error: {
              code: 'PROVIDER_ERROR',
              category: 'UNKNOWN_PROVIDER_ERROR',
              message: 'Gemini Prompt Composer returned no prompt synthesis result.',
              retryable: true,
            },
          });
          return;
        }

        res.status(200).json({
          ok: true,
          data: synthesisResult.result,
        });
      } catch (error) {
        next(error);
      } finally {
        res.off('close', onConnectionClose);
      }
    },
  );

  router.all('/prompts/synthesize', (_req, res) => {
    res.setHeader('Allow', 'POST');
    res.status(405).json({
      ok: false,
      error: {
        code: 'UNSUPPORTED_OPERATION',
        message: 'Method not allowed. Use POST with JSON body to synthesize a prompt.',
      },
    });
  });

  router.post(
    '/v1/object-identification',
    requireJsonBody,
    (req, res) => {
      const validation = validateServerVisionIdentificationPayload(req.body);
      if (!validation.ok) {
        const status =
          validation.error.code === 'SECURITY_BOUNDARY_VIOLATION' ? 403 : 400;
        res.status(status).json(validation);
        return;
      }

      res.status(501).json({
        ok: false,
        error: {
          code: 'NOT_IMPLEMENTED',
          message:
            'Structured ObjectAnalysis pipeline is deferred to Phase 02.3.3. Use POST /api/vision/analyze for Phase 02.3.2 raw Vision inspection.',
        },
      });
    },
  );

  router.get('/providers/image-generation/status', (_req, res) => {
    const status = configurationService.getActivePublicStatus();
    if (!status) {
      res.status(503).json({
        ok: false,
        error: {
          code: 'PROVIDER_UNAVAILABLE',
          category: 'UNAVAILABLE',
          message: 'No active image generation provider is registered on the server.',
        },
      });
      return;
    }

    res.status(200).json({
      ok: true,
      data: status,
    });
  });

  router.all('/providers/image-generation/status', (_req, res) => {
    res.setHeader('Allow', 'GET');
    res.status(405).json({
      ok: false,
      error: {
        code: 'UNSUPPORTED_OPERATION',
        message: 'Method not allowed. Use GET for image generation provider status.',
      },
    });
  });

  router.get('/providers/image-generation/capabilities', (_req, res) => {
    const capabilities = capabilityService.getActiveCapabilities();
    if (!capabilities) {
      res.status(503).json({
        ok: false,
        error: {
          code: 'PROVIDER_UNAVAILABLE',
          message: 'No active image generation provider is registered on the server.',
        },
      });
      return;
    }

    res.status(200).json({
      ok: true,
      data: capabilities,
    });
  });

  router.all('/providers/image-generation/capabilities', (_req, res) => {
    res.setHeader('Allow', 'GET');
    res.status(405).json({
      ok: false,
      error: {
        code: 'UNSUPPORTED_OPERATION',
        message: 'Method not allowed. Use GET for image generation provider capabilities.',
      },
    });
  });

  router.get('/providers/image-generation/list', (_req, res) => {
    const providers = configurationService.listRegisteredProviderSummaries();
    res.status(200).json({
      ok: true,
      data: {
        providers,
        activeProviderId:
          configurationService.getActiveProvider()?.providerId ?? null,
      },
    });
  });

  router.all('/providers/image-generation/list', (_req, res) => {
    res.setHeader('Allow', 'GET');
    res.status(405).json({
      ok: false,
      error: {
        code: 'UNSUPPORTED_OPERATION',
        message: 'Method not allowed. Use GET to list registered image generation providers.',
      },
    });
  });

  router.post(
    '/providers/image-generation/health',
    requireJsonBody,
    async (req, res, next) => {
      const requestAbortController = new AbortController();
      const onConnectionClose = () => {
        if (!res.writableEnded) {
          requestAbortController.abort(
            new Error('Client closed connection before provider health check completed.'),
          );
        }
      };
      res.on('close', onConnectionClose);

      try {
        const validation = validateImageGenerationHealthCheckPayload(req.body);
        if (!validation.ok) {
          const status =
            validation.error.code === 'SECURITY_BOUNDARY_VIOLATION' ? 403 : 400;
          res.status(status).json(validation);
          return;
        }

        const healthResult = await healthService.checkActiveProviderHealth({
          allowAnonymousFreeTier: validation.data.allowAnonymousFreeTier,
          abortSignal: requestAbortController.signal,
        });

        if (res.writableEnded) {
          return;
        }

        if (!healthResult) {
          res.status(503).json({
            ok: false,
            error: {
              code: 'PROVIDER_UNAVAILABLE',
              category: 'UNAVAILABLE',
              message: 'No active image generation provider is registered on the server.',
            },
          });
          return;
        }

        if (!healthResult.reachable) {
          const httpStatus =
            healthResult.status.connectionStatus === 'rate_limited'
              ? 429
              : healthResult.status.connectionStatus === 'not_configured' ||
                  healthResult.status.connectionStatus === 'unavailable'
                ? 503
                : 502;
          res.status(httpStatus).json({
            ok: false,
            data: healthResult,
            error: {
              code:
                healthResult.status.connectionStatus === 'not_configured'
                  ? 'VALIDATION_ERROR'
                  : 'PROVIDER_UNAVAILABLE',
              category: healthResult.status.errorCategory ?? 'PROVIDER_UNAVAILABLE',
              message: healthResult.status.statusMessage,
              retryable:
                healthResult.status.connectionStatus === 'rate_limited' ||
                healthResult.status.connectionStatus === 'unavailable',
            },
          });
          return;
        }

        res.status(200).json({
          ok: true,
          data: healthResult,
        });
      } catch (error) {
        next(error);
      } finally {
        res.off('close', onConnectionClose);
      }
    },
  );

  router.all('/providers/image-generation/health', (_req, res) => {
    res.setHeader('Allow', 'POST');
    res.status(405).json({
      ok: false,
      error: {
        code: 'UNSUPPORTED_OPERATION',
        message: 'Method not allowed. Use POST for image generation provider health checks.',
      },
    });
  });

  router.post(
    '/providers/image-generation/smoke-test',
    requireJsonBody,
    async (req, res, next) => {
      const requestAbortController = new AbortController();
      const onConnectionClose = () => {
        if (!res.writableEnded) {
          requestAbortController.abort(
            new Error('Client closed connection before smoke test completed.'),
          );
        }
      };
      res.on('close', onConnectionClose);

      try {
        const validation = validateImageGenerationSmokeTestPayload(req.body);
        if (!validation.ok) {
          const status =
            validation.error.code === 'SECURITY_BOUNDARY_VIOLATION' ? 403 : 400;
          res.status(status).json(validation);
          return;
        }

        const provider = configurationService.getActiveProvider();
        if (!provider) {
          res.status(503).json({
            ok: false,
            error: {
              code: 'PROVIDER_UNAVAILABLE',
              category: 'UNAVAILABLE',
              message: 'No active image generation provider is registered on the server.',
            },
          });
          return;
        }

        const smokeResult = await provider.runSmokeTest({
          confirmed: validation.data.confirmed,
          prompt: validation.data.prompt,
          allowAnonymousFreeTier: validation.data.allowAnonymousFreeTier,
          abortSignal: requestAbortController.signal,
        });

        if (res.writableEnded) {
          return;
        }

        const latestStatus = provider.getPublicStatus();

        if (!smokeResult.ok) {
          const category = smokeResult.error.details?.category;
          const upstreamStatus = smokeResult.error.details?.upstreamStatus;
          const httpStatus =
            category === 'RATE_LIMITED'
              ? 429
              : category === 'NETWORK_TIMEOUT'
                ? 504
                : typeof upstreamStatus === 'number'
                  ? upstreamStatus
                  : smokeResult.error.code === 'SECURITY_BOUNDARY_VIOLATION'
                    ? 403
                    : smokeResult.error.code === 'VALIDATION_ERROR'
                      ? 400
                      : smokeResult.error.code === 'PROVIDER_UNAVAILABLE'
                        ? 503
                        : 502;
          res.status(httpStatus).json({
            ok: false,
            status: latestStatus,
            error: {
              code: smokeResult.error.code,
              ...(typeof category === 'string' ? { category } : {}),
              message: smokeResult.error.message,
              ...(typeof smokeResult.error.details?.retryable === 'boolean'
                ? { retryable: smokeResult.error.details.retryable }
                : {}),
            },
          });
          return;
        }

        res.status(200).json({
          ok: true,
          status: latestStatus,
          data: smokeResult.data,
        });
      } catch (error) {
        next(error);
      } finally {
        res.off('close', onConnectionClose);
      }
    },
  );

  router.all('/providers/image-generation/smoke-test', (_req, res) => {
    res.setHeader('Allow', 'POST');
    res.status(405).json({
      ok: false,
      error: {
        code: 'UNSUPPORTED_OPERATION',
        message: 'Method not allowed. Use POST for image generation smoke tests.',
      },
    });
  });

  router.post(
    '/image-generation/execute',
    requireJsonBody,
    async (req, res, next) => {
      const requestAbortController = new AbortController();
      const onConnectionClose = () => {
        if (!res.writableEnded) {
          requestAbortController.abort(
            new Error('Client closed connection before image generation completed.'),
          );
        }
      };
      res.on('close', onConnectionClose);

      try {
        const requestedProviderId =
          typeof req.body === 'object' &&
          req.body !== null &&
          typeof (req.body as Record<string, unknown>).providerId === 'string'
            ? ((req.body as Record<string, unknown>).providerId as string).trim()
            : undefined;

        const provider = requestedProviderId
          ? configurationService.getProviderById(requestedProviderId)
          : configurationService.getActiveProvider();

        if (!provider) {
          res.status(requestedProviderId ? 400 : 503).json({
            ok: false,
            error: {
              code: requestedProviderId ? 'VALIDATION_ERROR' : 'PROVIDER_UNAVAILABLE',
              message: requestedProviderId
                ? `Requested image generation provider "${requestedProviderId}" is not registered on the server. Automatic provider switching is disabled.`
                : 'No active image generation provider is registered on the server.',
            },
          });
          return;
        }

        const capabilities = provider.getCapabilities();
        const normalized = normalizeGenerationRequest(req.body, capabilities);
        if (!normalized.ok) {
          const status =
            normalized.error.code === 'SECURITY_BOUNDARY_VIOLATION' ? 403 : 400;
          res.status(status).json(normalized);
          return;
        }

        const allowAnonymousFreeTier =
          typeof req.body === 'object' &&
          req.body !== null &&
          (req.body as Record<string, unknown>).allowAnonymousFreeTier === true;

        const generationResult = await provider.generate(
          normalized.data.normalizedRequest,
          {
            abortSignal: requestAbortController.signal,
            ...(allowAnonymousFreeTier ? { allowAnonymousFreeTier: true } : {}),
          },
        );

        if (res.writableEnded) {
          return;
        }

        if (generationResult.status !== 'succeeded' || !generationResult.imageBytes) {
          const status =
            generationResult.error?.category === 'RATE_LIMITED'
              ? 429
              : generationResult.error?.category === 'NETWORK_TIMEOUT'
                ? 504
                : generationResult.error?.code === 'SECURITY_BOUNDARY_VIOLATION'
                  ? 403
                  : generationResult.error?.code === 'VALIDATION_ERROR'
                    ? 400
                    : generationResult.error?.code === 'PROVIDER_UNAVAILABLE'
                      ? 503
                      : 502;
          res.status(status).json({
            ok: false,
            data: generationResult,
            error: generationResult.error,
          });
          return;
        }

        const base64 = Buffer.from(
          generationResult.imageBytes.buffer,
          generationResult.imageBytes.byteOffset,
          generationResult.imageBytes.byteLength,
        ).toString('base64');
        const mimeType = generationResult.mimeType ?? 'image/png';

        res.status(200).json({
          ok: true,
          data: {
            generationId: generationResult.generationId,
            providerId: generationResult.providerId,
            modelId: generationResult.modelId,
            status: generationResult.status,
            outputFormat: generationResult.outputFormat,
            mimeType: generationResult.mimeType,
            outputDimensions: generationResult.outputDimensions,
            temporaryImageDataUrl: `data:${mimeType};base64,${base64}`,
            createdAt: generationResult.createdAt,
            durationMs: generationResult.durationMs,
            usageMetadata: generationResult.usageMetadata,
          },
          normalizationWarnings: normalized.data.warnings,
        });
      } catch (error) {
        next(error);
      } finally {
        res.off('close', onConnectionClose);
      }
    },
  );

  router.all('/image-generation/execute', (_req, res) => {
    res.setHeader('Allow', 'POST');
    res.status(405).json({
      ok: false,
      error: {
        code: 'UNSUPPORTED_OPERATION',
        message: 'Method not allowed. Use POST with JSON body to execute normalized image generation.',
      },
    });
  });

  router.post(
    '/v1/image-generation',
    requireJsonBody,
    (req, res) => {
      const validation = validateServerImageGenerationPayload(req.body);
      if (!validation.ok) {
        res.status(400).json(validation);
        return;
      }

      res.status(501).json({
        ok: false,
        error: {
          code: 'NOT_IMPLEMENTED',
          message:
            'Text-to-Image provider execution is deferred beyond Phase 01.1.',
        },
      });
    },
  );

  router.use((_req, res) => {
    res.status(404).json({
      ok: false,
      error: {
        code: 'NOT_FOUND',
        message: 'API route not found.',
      },
    });
  });

  return router;
}

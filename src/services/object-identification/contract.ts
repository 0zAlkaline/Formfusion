import { errResult, okResult } from '../../types/common.ts';
import type { ServiceResult } from '../../types/common.ts';
import type { ObjectAnalysis } from '../../types/domain.ts';
import type { RawVisionAnalysisResult } from '../../types/providers.ts';
import type {
  AnalyzeRawSourceImageRequest,
  IdentifyObjectsRequest,
  ObjectIdentificationService,
} from '../../types/services.ts';
import {
  buildVisionAnalyzeFormData,
  defaultVisionMultipartTransport,
  type VisionMultipartTransport,
} from './visionAnalysisClient.ts';

export class ObjectIdentificationServiceFoundation
  implements ObjectIdentificationService
{
  private readonly transport: VisionMultipartTransport;

  constructor(transport: VisionMultipartTransport = defaultVisionMultipartTransport) {
    this.transport = transport;
  }

  async analyzeRawSourceImage(
    request: AnalyzeRawSourceImageRequest,
  ): Promise<ServiceResult<RawVisionAnalysisResult>> {
    if (request.sourceAsset.validationStatus !== 'validated') {
      return errResult(
        'VALIDATION_ERROR',
        'Source asset must pass validation before Vision analysis.',
      );
    }

    const formData = buildVisionAnalyzeFormData({
      projectId: request.projectId,
      asset: request.sourceAsset,
      binaryBlob: request.binaryBlob,
    });

    try {
      const response = await this.transport({
        endpoint: '/api/vision/analyze',
        formData,
        abortSignal: request.abortSignal,
      });

      if (!response.body.ok || !response.body.data) {
        return errResult(
          'PROVIDER_ERROR',
          response.body.error?.message ?? 'Vision analysis request failed.',
        );
      }
      return okResult(response.body.data);
    } catch (error: unknown) {
      return errResult(
        'PROVIDER_UNAVAILABLE',
        error instanceof Error ? error.message : 'Vision request failed.',
      );
    }
  }

  async analyzeSourceAsset(
    _request: IdentifyObjectsRequest,
  ): Promise<ServiceResult<ObjectAnalysis>> {
    return errResult(
      'NOT_IMPLEMENTED',
      'Structured ObjectAnalysis normalization is deferred to Phase 02.3.3.',
    );
  }
}

export type {
  AnalyzeRawSourceImageRequest,
  IdentifyObjectsRequest,
  ObjectIdentificationService,
};

import { errResult, okResult } from '../../types/common.ts';
import type { EntityId, ServiceResult } from '../../types/common.ts';
import type { SourceAsset } from '../../types/domain.ts';
import type {
  GeminiErrorCategory,
  RawVisionAnalysisResult,
} from '../../types/providers.ts';
import { isValidEntityId } from '../../utils/ids.ts';
import type { SourceAssetStorageService } from '../project-storage/browserProjectStorage.ts';
import {
  formatFileSize,
  validateSourceImageBinary,
} from '../source-asset/imageValidation.ts';

export const GEMINI_INLINE_PAYLOAD_RAW_LIMIT_BYTES = 14_500_000;

export type VisionAnalysisRequestPhase =
  | 'idle'
  | 'validating'
  | 'uploading'
  | 'analyzing'
  | 'success'
  | 'error'
  | 'cancelled';

export interface VisionAnalyzeApiResponse {
  readonly ok: boolean;
  readonly data?: RawVisionAnalysisResult;
  readonly error?: {
    readonly code: string;
    readonly category?: GeminiErrorCategory;
    readonly message: string;
    readonly retryable?: boolean;
  };
}

export interface VisionMultipartTransportParams {
  readonly endpoint: string;
  readonly formData: FormData;
  readonly abortSignal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly onUploadComplete?: () => void;
}

export type VisionMultipartTransport = (
  params: VisionMultipartTransportParams,
) => Promise<{
  readonly status: number;
  readonly body: VisionAnalyzeApiResponse;
}>;

export interface ExecuteVisionAnalysisOptions {
  readonly projectId: EntityId;
  readonly expectedAsset: SourceAsset | null;
  readonly sourceAssetStorage: Pick<
    SourceAssetStorageService,
    'getProjectSourceAsset'
  >;
  readonly abortSignal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly onPhaseChange?: (phase: VisionAnalysisRequestPhase) => void;
  readonly transport?: VisionMultipartTransport;
}

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return true;
  }
  return error instanceof Error && error.name === 'AbortError';
}

export async function defaultVisionMultipartTransport(
  params: VisionMultipartTransportParams,
): Promise<{
  readonly status: number;
  readonly body: VisionAnalyzeApiResponse;
}> {
  const timeoutMs = params.timeoutMs ?? 75000;

  if (typeof XMLHttpRequest !== 'undefined') {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      let settled = false;

      const cleanup = () => {
        if (params.abortSignal) {
          params.abortSignal.removeEventListener('abort', onAbort);
        }
      };

      const onAbort = () => {
        if (!settled) {
          settled = true;
          xhr.abort();
          cleanup();
          reject(new DOMException('Vision analysis cancelled.', 'AbortError'));
        }
      };

      if (params.abortSignal?.aborted) {
        settled = true;
        reject(new DOMException('Vision analysis cancelled.', 'AbortError'));
        return;
      }

      if (params.abortSignal) {
        params.abortSignal.addEventListener('abort', onAbort, { once: true });
      }

      xhr.open('POST', params.endpoint, true);
      xhr.timeout = timeoutMs;
      xhr.responseType = 'text';

      xhr.upload.onload = () => {
        if (!settled) {
          params.onUploadComplete?.();
        }
      };

      xhr.onload = () => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();

        try {
          const parsed = JSON.parse(
            xhr.responseText || '{}',
          ) as VisionAnalyzeApiResponse;
          resolve({
            status: xhr.status,
            body: parsed,
          });
        } catch {
          resolve({
            status: xhr.status || 502,
            body: {
              ok: false,
              error: {
                code: 'PROVIDER_ERROR',
                message: 'Server returned an unreadable Vision response payload.',
                retryable: true,
              },
            },
          });
        }
      };

      xhr.onerror = () => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(new Error('Network connection failed while transmitting source image.'));
      };

      xhr.ontimeout = () => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(new Error('Vision analysis request timed out waiting for server response.'));
      };

      xhr.send(params.formData);
    });
  }

  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  if (params.abortSignal) {
    if (params.abortSignal.aborted) {
      throw new DOMException('Vision analysis cancelled.', 'AbortError');
    }
    params.abortSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(params.endpoint, {
      method: 'POST',
      body: params.formData,
      signal: controller.signal,
    });
    params.onUploadComplete?.();
    const parsed = (await response.json()) as VisionAnalyzeApiResponse;
    return {
      status: response.status,
      body: parsed,
    };
  } finally {
    clearTimeout(timer);
    if (params.abortSignal) {
      params.abortSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}

export function buildVisionAnalyzeFormData(params: {
  readonly projectId: EntityId;
  readonly asset: SourceAsset;
  readonly binaryBlob: Blob;
}): FormData {
  const formData = new FormData();
  formData.append('projectId', params.projectId);
  formData.append('assetId', params.asset.id);
  formData.append('mimeType', params.asset.mimeType);
  formData.append('image', params.binaryBlob, params.asset.originalFileName);
  return formData;
}

export async function executeVisionAnalysisFromStorage(
  options: ExecuteVisionAnalysisOptions,
): Promise<ServiceResult<RawVisionAnalysisResult>> {
  const notifyPhase = (phase: VisionAnalysisRequestPhase) => {
    options.onPhaseChange?.(phase);
  };

  if (options.abortSignal?.aborted) {
    notifyPhase('cancelled');
    return errResult('UNSUPPORTED_OPERATION', 'Vision analysis was cancelled.', {
      cancelled: true,
    });
  }

  notifyPhase('validating');

  if (!isValidEntityId(options.projectId)) {
    notifyPhase('error');
    return errResult(
      'VALIDATION_ERROR',
      'Active project identifier is invalid. Reload or start a new study before analyzing.',
    );
  }

  const expectedAsset = options.expectedAsset;
  if (!expectedAsset) {
    notifyPhase('error');
    return errResult(
      'VALIDATION_ERROR',
      'Upload and validate a source image before running object analysis.',
    );
  }

  if (expectedAsset.validationStatus !== 'validated') {
    notifyPhase('error');
    return errResult(
      'VALIDATION_ERROR',
      'Source asset must pass Phase 02.1 validation before Vision analysis.',
    );
  }

  if (expectedAsset.projectId !== options.projectId) {
    notifyPhase('error');
    return errResult(
      'VALIDATION_ERROR',
      'Active source asset does not match the current study project.',
    );
  }

  if (expectedAsset.storageStatus !== 'persisted') {
    notifyPhase('error');
    return errResult(
      'STORAGE_ERROR',
      'Save the source image to local IndexedDB storage before running Vision analysis.',
    );
  }

  const restored = await options.sourceAssetStorage.getProjectSourceAsset(
    options.projectId,
  );

  if (options.abortSignal?.aborted) {
    notifyPhase('cancelled');
    return errResult('UNSUPPORTED_OPERATION', 'Vision analysis was cancelled.', {
      cancelled: true,
    });
  }

  if (!restored.ok) {
    notifyPhase('error');
    return errResult('STORAGE_ERROR', restored.error.message);
  }

  if (!restored.data || !restored.data.sourceAsset || !restored.data.blob) {
    notifyPhase('error');
    return errResult(
      'NOT_FOUND',
      'Original source image Blob could not be found in local IndexedDB storage.',
    );
  }

  const {
    project: storedProject,
    sourceAsset: storedAsset,
    blob: originalBlob,
  } = restored.data;

  if (
    storedProject.id !== options.projectId ||
    storedAsset.id !== expectedAsset.id ||
    storedAsset.projectId !== options.projectId
  ) {
    notifyPhase('error');
    return errResult(
      'CONFLICT',
      'Stored source asset does not match the currently inspected image or active study.',
    );
  }

  if (storedAsset.validationStatus !== 'validated') {
    notifyPhase('error');
    return errResult(
      'VALIDATION_ERROR',
      'Stored source asset has not passed image integrity validation.',
    );
  }

  if (originalBlob.size <= 0) {
    notifyPhase('error');
    return errResult(
      'VALIDATION_ERROR',
      'Stored source image Blob is empty or unreadable.',
    );
  }

  if (originalBlob.size > GEMINI_INLINE_PAYLOAD_RAW_LIMIT_BYTES) {
    notifyPhase('error');
    return errResult(
      'VALIDATION_ERROR',
      `Source image (${formatFileSize(originalBlob.size)}) exceeds the Gemini inline Vision limit (${formatFileSize(GEMINI_INLINE_PAYLOAD_RAW_LIMIT_BYTES)} raw before encoding). Choose a smaller image without altering the original asset.`,
    );
  }

  const headerSlice = await originalBlob.slice(0, 64).arrayBuffer();
  const headerBytes = new Uint8Array(headerSlice);
  const signatureCheck = validateSourceImageBinary({
    fileName: storedAsset.originalFileName,
    declaredMimeType: storedAsset.mimeType,
    fileSizeBytes: originalBlob.size,
    headerBytes,
  });

  if (!signatureCheck.ok) {
    notifyPhase('error');
    return signatureCheck;
  }

  if (options.abortSignal?.aborted) {
    notifyPhase('cancelled');
    return errResult('UNSUPPORTED_OPERATION', 'Vision analysis was cancelled.', {
      cancelled: true,
    });
  }

  const formData = buildVisionAnalyzeFormData({
    projectId: options.projectId,
    asset: storedAsset,
    binaryBlob: originalBlob,
  });

  notifyPhase('uploading');

  const transport = options.transport ?? defaultVisionMultipartTransport;

  try {
    const response = await transport({
      endpoint: '/api/vision/analyze',
      formData,
      abortSignal: options.abortSignal,
      timeoutMs: options.timeoutMs,
      onUploadComplete: () => {
        if (!options.abortSignal?.aborted) {
          notifyPhase('analyzing');
        }
      },
    });

    if (options.abortSignal?.aborted) {
      notifyPhase('cancelled');
      return errResult('UNSUPPORTED_OPERATION', 'Vision analysis was cancelled.', {
        cancelled: true,
      });
    }

    if (!response.body.ok || !response.body.data) {
      notifyPhase('error');
      const errorMessage =
        response.body.error?.message ??
        `Vision analysis failed with status ${response.status}.`;
      const errorCode =
        response.status === 400 || response.status === 413 || response.status === 415
          ? 'VALIDATION_ERROR'
          : response.status === 403
            ? 'SECURITY_BOUNDARY_VIOLATION'
            : response.status === 503 || response.status === 504 || response.status === 429
              ? 'PROVIDER_UNAVAILABLE'
              : 'PROVIDER_ERROR';

      return errResult(errorCode, errorMessage, {
        retryable: response.body.error?.retryable ?? response.status >= 500,
        ...(response.body.error?.category
          ? { category: response.body.error.category }
          : {}),
      });
    }

    notifyPhase('success');
    return okResult(response.body.data);
  } catch (error: unknown) {
    if (isAbortError(error) || options.abortSignal?.aborted) {
      notifyPhase('cancelled');
      return errResult('UNSUPPORTED_OPERATION', 'Vision analysis was cancelled.', {
        cancelled: true,
      });
    }

    notifyPhase('error');
    const message =
      error instanceof Error && error.message.trim().length > 0
        ? error.message
        : 'Unable to reach FormFusion Vision analysis service.';
    return errResult('PROVIDER_UNAVAILABLE', message, { retryable: true });
  }
}

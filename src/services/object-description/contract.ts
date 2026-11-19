import { errResult } from '../../types/common.ts';
import type { ServiceResult } from '../../types/common.ts';
import type { ObjectAnalysis, ObjectDescription } from '../../types/domain.ts';
import type {
  NormalizeObjectDescriptionRequest,
  ObjectDescriptionService,
} from '../../types/services.ts';

export class ObjectDescriptionServiceFoundation
  implements ObjectDescriptionService
{
  createFromAnalysis(
    _analysis: ObjectAnalysis,
  ): ServiceResult<ObjectDescription> {
    return errResult(
      'NOT_IMPLEMENTED',
      'ObjectDescriptionService normalization is deferred beyond Phase 01.1.',
    );
  }

  normalizeAndValidate(
    _request: NormalizeObjectDescriptionRequest,
  ): ServiceResult<ObjectDescription> {
    return errResult(
      'NOT_IMPLEMENTED',
      'ObjectDescriptionService validation workflow is deferred beyond Phase 01.1.',
    );
  }

  resetFromAnalysis(
    _analysis: ObjectAnalysis,
    _existingDescription?: ObjectDescription | null,
  ): ServiceResult<ObjectDescription> {
    return errResult(
      'NOT_IMPLEMENTED',
      'ObjectDescriptionService reset workflow is deferred beyond Phase 01.1.',
    );
  }
}

export {
  StudioObjectDescriptionService,
  areEditableFieldsEqual,
  buildPromptReadyObjectSummary,
  extractEditableFieldsFromAnalysis,
  extractEditableFieldsFromDescription,
  formatDelimitedList,
  formatMultiItemList,
  parseDelimitedListInput,
  parseLineOrSemicolonListInput,
  validateEditableDescriptionFields,
} from './objectDescriptionService.ts';
export { normalizeRawVisionToObjectAnalysis } from './analysisNormalizer.ts';
export type { NormalizeObjectDescriptionRequest, ObjectDescriptionService };

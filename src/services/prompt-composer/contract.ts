import { errResult } from '../../types/common.ts';
import type { ServiceResult } from '../../types/common.ts';
import type { PromptDocument } from '../../types/domain.ts';
import type { PromptSynthesisProviderOutput } from '../../types/providers.ts';
import type {
  ApprovePromptRequest,
  ComposePromptRequest,
  NormalizedPromptInputs,
  PromptComposerService,
  PromptInputValidationReport,
} from '../../types/services.ts';

export class PromptComposerServiceFoundation implements PromptComposerService {
  validatePromptInputs(
    _request: ComposePromptRequest,
  ): ServiceResult<PromptInputValidationReport> {
    return errResult(
      'NOT_IMPLEMENTED',
      'PromptComposerService input validation is not enabled on foundation stub.',
    );
  }

  normalizePromptInputs(
    _request: ComposePromptRequest,
  ): ServiceResult<NormalizedPromptInputs> {
    return errResult(
      'NOT_IMPLEMENTED',
      'PromptComposerService input normalization is not enabled on foundation stub.',
    );
  }

  async synthesizeMasterPrompt(
    _request: ComposePromptRequest,
  ): Promise<ServiceResult<PromptDocument>> {
    return errResult(
      'NOT_IMPLEMENTED',
      'PromptComposerService prompt synthesis is not enabled on foundation stub.',
    );
  }

  validateGeneratedPrompt(
    _synthesis: PromptSynthesisProviderOutput,
    _normalized: NormalizedPromptInputs,
  ): ServiceResult<PromptSynthesisProviderOutput> {
    return errResult(
      'NOT_IMPLEMENTED',
      'PromptComposerService prompt validation is not enabled on foundation stub.',
    );
  }

  savePromptDocument(
    _document: PromptDocument,
    _previousDocument?: PromptDocument | null,
  ): ServiceResult<PromptDocument> {
    return errResult(
      'NOT_IMPLEMENTED',
      'PromptComposerService document saving is not enabled on foundation stub.',
    );
  }

  approveFinalPrompt(
    _request: ApprovePromptRequest,
  ): ServiceResult<PromptDocument> {
    return errResult(
      'NOT_IMPLEMENTED',
      'PromptComposerService approval workflow is not enabled on foundation stub.',
    );
  }

  async regeneratePrompt(
    _request: ComposePromptRequest,
  ): Promise<ServiceResult<PromptDocument>> {
    return errResult(
      'NOT_IMPLEMENTED',
      'PromptComposerService prompt regeneration is not enabled on foundation stub.',
    );
  }

  async composePrompt(
    _request: ComposePromptRequest,
  ): Promise<ServiceResult<PromptDocument>> {
    return errResult(
      'NOT_IMPLEMENTED',
      'PromptComposerService prompt composition is deferred beyond Phase 01.1.',
    );
  }

  approvePrompt(
    _request: ApprovePromptRequest,
  ): ServiceResult<PromptDocument> {
    return errResult(
      'NOT_IMPLEMENTED',
      'PromptComposerService approval workflow is deferred beyond Phase 01.1.',
    );
  }
}

export {
  PROMPT_SYNTHESIS_ENDPOINT,
  StudioPromptComposerService,
  createDefaultCompositionPreferences,
  createDefaultManualCreativeDirection,
  deriveOutputOrientation,
  detectPotentialInputConflicts,
  extractSupportedNegativeDirectives,
  markPromptEdited,
  normalizeArtStyleConfiguration,
  unlockApprovedPromptForNewRevision,
  type PromptSynthesizeApiResponse,
  type StudioPromptComposerOptions,
} from './promptComposerService.ts';

export type {
  ApprovePromptRequest,
  ComposePromptRequest,
  PromptComposerService,
};

import { errResult, okResult } from '../../types/common.ts';
import type { ServiceResult } from '../../types/common.ts';
import type {
  GeneratedArtwork,
  Project,
  ProjectStatus,
  PromptDocument,
  SourceAsset,
} from '../../types/domain.ts';

export type ProjectListFilter = 'all' | 'active' | 'archived';

export type ProjectListSort =
  | 'updated_desc'
  | 'created_desc'
  | 'name_asc'
  | 'name_desc';

export type ProjectSourceAvailability = 'available' | 'missing_blob' | 'none';

export type ProjectWorkflowStageId =
  | 'artwork_generated'
  | 'prompt_approved'
  | 'prompt_composed'
  | 'description_ready'
  | 'object_analyzed'
  | 'source_uploaded'
  | 'draft';

export interface ProjectSummary {
  readonly project: Project;
  readonly sourceAsset: SourceAsset | null;
  readonly sourceAvailability: ProjectSourceAvailability;
  readonly artworkCount: number;
  readonly generationJobCount: number;
  readonly analysisCount: number;
  readonly descriptionCount: number;
  readonly promptCount: number;
  readonly latestArtwork: GeneratedArtwork | null;
  readonly latestArtworkBlob: Blob | null;
  readonly sourcePreviewBlob: Blob | null;
  readonly workflowStage: ProjectWorkflowStageId;
  readonly workflowStageLabel: string;
  readonly isActiveProject: boolean;
}

export const MAX_PROJECT_TITLE_LENGTH = 120;
export const MAX_PROJECT_DESCRIPTION_LENGTH = 500;

const RESTORABLE_STATUSES: ReadonlySet<Exclude<ProjectStatus, 'archived'>> =
  new Set(['draft', 'analyzed', 'prompt_ready', 'generated']);

export function validateProjectTitle(rawTitle: unknown): ServiceResult<string> {
  if (typeof rawTitle !== 'string') {
    return errResult(
      'VALIDATION_ERROR',
      'Project name is required and must be plain text.',
    );
  }
  const trimmed = rawTitle.trim();
  if (trimmed.length === 0) {
    return errResult(
      'VALIDATION_ERROR',
      'Project name cannot be empty.',
    );
  }
  if (trimmed.length > MAX_PROJECT_TITLE_LENGTH) {
    return errResult(
      'VALIDATION_ERROR',
      `Project name must be ${MAX_PROJECT_TITLE_LENGTH} characters or fewer.`,
    );
  }
  return okResult(trimmed);
}

export function normalizeProjectDescription(rawDescription?: string | null): string {
  if (typeof rawDescription !== 'string') {
    return '';
  }
  const trimmed = rawDescription.trim();
  return trimmed.slice(0, MAX_PROJECT_DESCRIPTION_LENGTH);
}

export function inferRestorableProjectStatus(input: {
  readonly project: Project;
  readonly artworkCount?: number;
  readonly hasApprovedPrompt?: boolean;
  readonly hasPrompt?: boolean;
  readonly hasAnalysisOrDescription?: boolean;
}): Exclude<ProjectStatus, 'archived'> {
  const { project } = input;
  if (
    project.previousStatus &&
    RESTORABLE_STATUSES.has(project.previousStatus)
  ) {
    return project.previousStatus;
  }

  if (
    (input.artworkCount ?? 0) > 0 ||
    project.activeGenerationJobId !== null
  ) {
    return 'generated';
  }

  if (input.hasApprovedPrompt || project.activePromptId !== null || input.hasPrompt) {
    return 'prompt_ready';
  }

  if (
    input.hasAnalysisOrDescription ||
    project.activeAnalysisId !== null ||
    project.activeDescriptionId !== null
  ) {
    return 'analyzed';
  }

  return 'draft';
}

export function computeProjectWorkflowStage(input: {
  readonly project: Project;
  readonly sourceAsset: SourceAsset | null;
  readonly analysisCount: number;
  readonly descriptionCount: number;
  readonly latestPrompt: PromptDocument | null;
  readonly promptCount: number;
  readonly artworkCount: number;
}): {
  readonly workflowStage: ProjectWorkflowStageId;
  readonly workflowStageLabel: string;
} {
  if (input.artworkCount > 0) {
    return {
      workflowStage: 'artwork_generated',
      workflowStageLabel: 'Artwork Generated',
    };
  }

  if (input.latestPrompt?.approvalStatus === 'approved') {
    return {
      workflowStage: 'prompt_approved',
      workflowStageLabel: 'Prompt Approved',
    };
  }

  if (input.promptCount > 0 || input.project.activePromptId !== null) {
    return {
      workflowStage: 'prompt_composed',
      workflowStageLabel: 'Prompt Composed',
    };
  }

  if (
    input.descriptionCount > 0 ||
    input.project.activeDescriptionId !== null
  ) {
    return {
      workflowStage: 'description_ready',
      workflowStageLabel: 'Description Ready',
    };
  }

  if (input.analysisCount > 0 || input.project.activeAnalysisId !== null) {
    return {
      workflowStage: 'object_analyzed',
      workflowStageLabel: 'Object Analyzed',
    };
  }

  if (input.sourceAsset !== null || input.project.sourceAssetId !== null) {
    return {
      workflowStage: 'source_uploaded',
      workflowStageLabel: 'Source Image Ready',
    };
  }

  return {
    workflowStage: 'draft',
    workflowStageLabel: 'Draft Study',
  };
}

export function filterProjectSummaries(
  summaries: readonly ProjectSummary[],
  options: {
    readonly searchQuery: string;
    readonly filter: ProjectListFilter;
  },
): readonly ProjectSummary[] {
  const normalizedQuery = options.searchQuery.trim().toLowerCase();

  return summaries.filter((item) => {
    const isArchived = item.project.status === 'archived';
    if (options.filter === 'active' && isArchived) {
      return false;
    }
    if (options.filter === 'archived' && !isArchived) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    return item.project.title.toLowerCase().includes(normalizedQuery);
  });
}

export function sortProjectSummaries(
  summaries: readonly ProjectSummary[],
  sort: ProjectListSort,
): readonly ProjectSummary[] {
  const copy = [...summaries];
  switch (sort) {
    case 'name_asc':
      return copy.sort((a, b) => {
        const cmp = a.project.title.localeCompare(b.project.title, undefined, {
          sensitivity: 'base',
        });
        return cmp !== 0
          ? cmp
          : b.project.updatedAt.localeCompare(a.project.updatedAt);
      });
    case 'name_desc':
      return copy.sort((a, b) => {
        const cmp = b.project.title.localeCompare(a.project.title, undefined, {
          sensitivity: 'base',
        });
        return cmp !== 0
          ? cmp
          : b.project.updatedAt.localeCompare(a.project.updatedAt);
      });
    case 'created_desc':
      return copy.sort((a, b) => {
        const cmp = b.project.createdAt.localeCompare(a.project.createdAt);
        return cmp !== 0
          ? cmp
          : b.project.updatedAt.localeCompare(a.project.updatedAt);
      });
    case 'updated_desc':
    default:
      return copy.sort((a, b) =>
        b.project.updatedAt.localeCompare(a.project.updatedAt),
      );
  }
}

export function formatProjectStatusLabel(status: ProjectStatus): string {
  switch (status) {
    case 'draft':
      return 'Draft';
    case 'analyzed':
      return 'Analyzed';
    case 'prompt_ready':
      return 'Prompt Ready';
    case 'generated':
      return 'Generated';
    case 'archived':
      return 'Archived';
  }
}

export function formatProjectSourceAvailabilityLabel(
  availability: ProjectSourceAvailability,
): string {
  switch (availability) {
    case 'available':
      return 'Source Image Available';
    case 'missing_blob':
      return 'Source Metadata Only';
    case 'none':
      return 'No Source Image';
  }
}

export function formatProjectDisplayDate(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return iso;
  }
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

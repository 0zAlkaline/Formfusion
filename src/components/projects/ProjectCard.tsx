import {
  Archive,
  ArchiveRestore,
  FolderOpen,
  Image as ImageIcon,
  Info,
  Pencil,
  Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  formatProjectDisplayDate,
  formatProjectSourceAvailabilityLabel,
  formatProjectStatusLabel,
  type ProjectSummary,
} from '../../services/project-storage/projectManagement.ts';
import type { Project, ProjectStatus } from '../../types/domain.ts';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  Typography,
  cn,
  type BadgeTone,
} from '../ui/index.ts';

export interface ProjectCardProps {
  readonly summary: ProjectSummary;
  readonly isOpening?: boolean;
  readonly isBusy?: boolean;
  readonly onOpen: (project: Project) => void;
  readonly onRename: (project: Project) => void;
  readonly onInspectMetadata: (summary: ProjectSummary) => void;
  readonly onRequestArchive: (project: Project) => void;
  readonly onRestore: (project: Project) => void;
  readonly onRequestDelete: (project: Project) => void;
}

const STATUS_BADGE_TONES: Record<ProjectStatus, BadgeTone> = {
  draft: 'neutral',
  analyzed: 'info',
  prompt_ready: 'accent',
  generated: 'success',
  archived: 'warning',
};

export function ProjectCard({
  summary,
  isOpening = false,
  isBusy = false,
  onOpen,
  onRename,
  onInspectMetadata,
  onRequestArchive,
  onRestore,
  onRequestDelete,
}: ProjectCardProps) {
  const { project } = summary;
  const isArchived = project.status === 'archived';
  const previewBlob = summary.latestArtworkBlob ?? summary.sourcePreviewBlob;
  const previewKind = summary.latestArtworkBlob
    ? 'Latest Artwork'
    : summary.sourcePreviewBlob
      ? 'Source Image'
      : null;

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!previewBlob) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(previewBlob);
    setPreviewUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [previewBlob]);

  return (
    <Card
      data-testid={`project-card-${project.id}`}
      className={cn(
        'flex flex-col justify-between overflow-hidden transition-colors',
        summary.isActiveProject &&
          'border-[var(--ff-color-primary)] ring-1 ring-[var(--ff-color-primary)]/15',
      )}
    >
      <div>
        <div className="relative flex h-40 w-full items-center justify-center border-b border-[var(--ff-color-border)] bg-[var(--ff-color-muted)] overflow-hidden">
          {previewUrl ? (
            <>
              <img
                src={previewUrl}
                alt={`${project.title} preview`}
                className="h-full w-full object-cover"
              />
              {previewKind ? (
                <span className="absolute bottom-2.5 left-2.5 rounded-[var(--ff-radius-sm)] bg-[#17191E]/75 px-2 py-0.5 text-[11px] font-medium text-[#FFFFFF]">
                  {previewKind}
                </span>
              ) : null}
            </>
          ) : (
            <div className="flex flex-col items-center gap-1.5 text-[var(--ff-color-muted-foreground)]">
              <ImageIcon className="h-5 w-5" aria-hidden="true" />
              <span className="text-[12px] font-medium">
                {summary.sourceAvailability === 'missing_blob'
                  ? 'Source Image Unavailable'
                  : 'No Preview Image'}
              </span>
            </div>
          )}

          {summary.isActiveProject ? (
            <span className="absolute top-2.5 right-2.5">
              <Badge tone="primary">Active Study</Badge>
            </span>
          ) : null}
        </div>

        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="line-clamp-1">
              <span title={project.title}>{project.title}</span>
            </CardTitle>
            <Badge tone={STATUS_BADGE_TONES[project.status]}>
              {formatProjectStatusLabel(project.status)}
            </Badge>
          </div>
          {project.description ? (
            <Typography
              variant="body-sm"
              muted
              className="mt-1 line-clamp-2"
              title={project.description}
            >
              {project.description}
            </Typography>
          ) : null}
        </CardHeader>

        <CardContent className="pt-0">
          <dl className="divide-y divide-[var(--ff-color-border)] border-t border-[var(--ff-color-border)] text-[12px]">
            <div className="flex items-center justify-between gap-3 py-1.5">
              <dt className="text-[var(--ff-color-muted-foreground)]">Workflow Stage</dt>
              <dd className="font-medium text-[var(--ff-color-foreground)]">
                {summary.workflowStageLabel}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 py-1.5">
              <dt className="text-[var(--ff-color-muted-foreground)]">Generated Artworks</dt>
              <dd className="font-medium tabular-nums text-[var(--ff-color-foreground)]">
                {summary.artworkCount}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 py-1.5">
              <dt className="text-[var(--ff-color-muted-foreground)]">Source Image</dt>
              <dd className="font-medium text-[var(--ff-color-foreground)]">
                {formatProjectSourceAvailabilityLabel(summary.sourceAvailability)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 py-1.5">
              <dt className="text-[var(--ff-color-muted-foreground)]">Created</dt>
              <dd className="tabular-nums text-[var(--ff-color-muted-foreground)]">
                {formatProjectDisplayDate(project.createdAt)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 py-1.5">
              <dt className="text-[var(--ff-color-muted-foreground)]">Last Modified</dt>
              <dd className="tabular-nums text-[var(--ff-color-muted-foreground)]">
                {formatProjectDisplayDate(project.updatedAt)}
              </dd>
            </div>
          </dl>
        </CardContent>
      </div>

      <CardFooter className="flex flex-col items-stretch gap-2 border-t border-[var(--ff-color-border)] bg-[var(--ff-color-surface-elevated)] px-5 py-3.5">
        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            className="flex-1"
            leftIcon={<FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />}
            loading={isOpening}
            disabled={isBusy}
            onClick={() => onOpen(project)}
          >
            Open
          </Button>
          <Button
            variant="outline"
            size="sm"
            leftIcon={<Info className="h-3.5 w-3.5" aria-hidden="true" />}
            disabled={isBusy}
            aria-label={`Inspect metadata for ${project.title}`}
            onClick={() => onInspectMetadata(summary)}
          >
            Metadata
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<Pencil className="h-3.5 w-3.5" aria-hidden="true" />}
            disabled={isBusy}
            aria-label={`Rename ${project.title}`}
            onClick={() => onRename(project)}
          >
            Rename
          </Button>
          {isArchived ? (
            <Button
              variant="outline"
              size="sm"
              leftIcon={<ArchiveRestore className="h-3.5 w-3.5" aria-hidden="true" />}
              disabled={isBusy}
              aria-label={`Restore ${project.title}`}
              onClick={() => onRestore(project)}
            >
              Restore
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<Archive className="h-3.5 w-3.5" aria-hidden="true" />}
              disabled={isBusy}
              aria-label={`Archive ${project.title}`}
              onClick={() => onRequestArchive(project)}
            >
              Archive
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
            disabled={isBusy}
            aria-label={`Delete ${project.title}`}
            className="text-[var(--ff-color-destructive)] hover:bg-[var(--ff-color-destructive-subtle)] hover:text-[var(--ff-color-destructive)]"
            onClick={() => onRequestDelete(project)}
          >
            Delete
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}

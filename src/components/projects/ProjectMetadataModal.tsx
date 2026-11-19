import {
  formatProjectDisplayDate,
  formatProjectSourceAvailabilityLabel,
  formatProjectStatusLabel,
  type ProjectSummary,
} from '../../services/project-storage/projectManagement.ts';
import { formatFileSize } from '../../services/source-asset/imageValidation.ts';
import { Badge, Button, Modal, SurfacePanel, Typography } from '../ui/index.ts';

export interface ProjectMetadataModalProps {
  readonly open: boolean;
  readonly summary: ProjectSummary | null;
  readonly onClose: () => void;
  readonly onOpenProject: (projectId: string) => void;
}

function MetaRow({
  label,
  value,
  mono = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-[13px]">
      <dt className="shrink-0 text-[var(--ff-color-muted-foreground)]">{label}</dt>
      <dd
        className={
          mono
            ? 'min-w-0 break-all text-right font-mono text-[12px] text-[var(--ff-color-foreground)]'
            : 'min-w-0 break-words text-right font-medium text-[var(--ff-color-foreground)]'
        }
      >
        {value}
      </dd>
    </div>
  );
}

export function ProjectMetadataModal({
  open,
  summary,
  onClose,
  onOpenProject,
}: ProjectMetadataModalProps) {
  if (!summary) {
    return null;
  }

  const { project, sourceAsset } = summary;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={project.title}
      description="Persisted IndexedDB metadata and workflow relationship counts."
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              onClose();
              onOpenProject(project.id);
            }}
          >
            Open Project
          </Button>
        </>
      }
    >
      <div className="space-y-5" data-testid="project-metadata-dialog">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={project.status === 'archived' ? 'warning' : 'neutral'}>
            {formatProjectStatusLabel(project.status)}
          </Badge>
          <Badge tone="info">{summary.workflowStageLabel}</Badge>
          {summary.isActiveProject ? (
            <Badge tone="primary">Active Project</Badge>
          ) : null}
        </div>

        {project.description ? (
          <SurfacePanel tone="muted" padding="sm">
            <Typography variant="caption" muted className="block">
              Study Description
            </Typography>
            <Typography variant="body-sm" className="mt-1">
              {project.description}
            </Typography>
          </SurfacePanel>
        ) : null}

        <dl className="divide-y divide-[var(--ff-color-border)] border-y border-[var(--ff-color-border)]">
          <MetaRow label="Project ID" value={project.id} mono />
          <MetaRow label="Created" value={formatProjectDisplayDate(project.createdAt)} />
          <MetaRow label="Last Modified" value={formatProjectDisplayDate(project.updatedAt)} />
          <MetaRow
            label="Source Image"
            value={formatProjectSourceAvailabilityLabel(summary.sourceAvailability)}
          />
          {sourceAsset ? (
            <MetaRow
              label="Source File"
              value={`${sourceAsset.originalFileName} · ${sourceAsset.width}×${sourceAsset.height} px · ${formatFileSize(sourceAsset.fileSizeBytes)}`}
            />
          ) : null}
          <MetaRow label="Object Analyses" value={String(summary.analysisCount)} />
          <MetaRow label="Object Descriptions" value={String(summary.descriptionCount)} />
          <MetaRow label="Prompt Revisions" value={String(summary.promptCount)} />
          <MetaRow label="Generation Jobs" value={String(summary.generationJobCount)} />
          <MetaRow label="Generated Artworks" value={String(summary.artworkCount)} />
        </dl>
      </div>
    </Modal>
  );
}

import { Archive, FolderKanban, Plus, SearchX } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStudioServices } from '../app/providers/AppProviders.tsx';
import { CreateProjectModal } from '../components/projects/CreateProjectModal.tsx';
import { ProjectCard } from '../components/projects/ProjectCard.tsx';
import { ProjectMetadataModal } from '../components/projects/ProjectMetadataModal.tsx';
import { RenameProjectModal } from '../components/projects/RenameProjectModal.tsx';
import {
  Alert,
  Button,
  ConfirmationDialog,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  SearchInput,
  Select,
  SurfacePanel,
  cn,
} from '../components/ui/index.ts';
import {
  filterProjectSummaries,
  sortProjectSummaries,
  type ProjectListFilter,
  type ProjectListSort,
  type ProjectSummary,
} from '../services/project-storage/projectManagement.ts';
import type { Project } from '../types/domain.ts';

interface MyProjectsPageProps {
  readonly onNavigate: (path: string) => void;
}

const SORT_OPTIONS: readonly { readonly value: ProjectListSort; readonly label: string }[] = [
  { value: 'updated_desc', label: 'Recently Modified' },
  { value: 'created_desc', label: 'Recently Created' },
  { value: 'name_asc', label: 'Name A–Z' },
  { value: 'name_desc', label: 'Name Z–A' },
];

export function MyProjectsPage({ onNavigate }: MyProjectsPageProps) {
  const { projectManagementStorage } = useStudioServices();

  const [summaries, setSummaries] = useState<readonly ProjectSummary[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<ProjectListFilter>('all');
  const [sort, setSort] = useState<ProjectListSort>('updated_desc');

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [renameTarget, setRenameTarget] = useState<Project | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  const [metadataTarget, setMetadataTarget] = useState<ProjectSummary | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Project | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [openingId, setOpeningId] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const loadProjects = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    const res = await projectManagementStorage.listProjectSummaries();
    if (!res.ok) {
      setLoadError(res.error.message);
      setIsLoading(false);
      return;
    }
    setSummaries(res.data);
    setIsLoading(false);
  }, [projectManagementStorage]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const counts = useMemo(() => {
    let active = 0;
    let archived = 0;
    for (const item of summaries) {
      if (item.project.status === 'archived') {
        archived += 1;
      } else {
        active += 1;
      }
    }
    return {
      all: summaries.length,
      active,
      archived,
    };
  }, [summaries]);

  const visibleSummaries = useMemo(() => {
    const filtered = filterProjectSummaries(summaries, {
      searchQuery,
      filter,
    });
    return sortProjectSummaries(filtered, sort);
  }, [summaries, searchQuery, filter, sort]);

  const isAnyActionBusy =
    isCreating ||
    isRenaming ||
    isArchiving ||
    isDeleting ||
    openingId !== null ||
    restoringId !== null;

  const handleCreateProject = async (input: {
    readonly title: string;
    readonly description: string;
  }) => {
    setIsCreating(true);
    setCreateError(null);
    setActionError(null);

    const res = await projectManagementStorage.createProject({
      title: input.title,
      description: input.description,
      setAsActive: true,
    });

    setIsCreating(false);

    if (!res.ok) {
      setCreateError(res.error.message);
      return;
    }

    setCreateOpen(false);
    onNavigate('/create');
  };

  const handleOpenProject = async (projectId: string) => {
    setOpeningId(projectId);
    setActionError(null);
    const res = await projectManagementStorage.openProject(projectId);
    setOpeningId(null);

    if (!res.ok) {
      setActionError(res.error.message);
      await loadProjects();
      return;
    }

    onNavigate('/create');
  };

  const handleRenameSubmit = async (projectId: string, nextTitle: string) => {
    setIsRenaming(true);
    setRenameError(null);
    setActionError(null);

    const res = await projectManagementStorage.renameProject(projectId, nextTitle);
    setIsRenaming(false);

    if (!res.ok) {
      setRenameError(res.error.message);
      return;
    }

    setRenameTarget(null);
    setNoticeMessage(`Renamed project to "${res.data.title}".`);
    await loadProjects();
  };

  const handleConfirmArchive = async () => {
    if (!archiveTarget) {
      return;
    }
    setIsArchiving(true);
    setActionError(null);
    const res = await projectManagementStorage.archiveProject(archiveTarget.id);
    setIsArchiving(false);

    if (!res.ok) {
      setActionError(res.error.message);
      setArchiveTarget(null);
      return;
    }

    const archivedTitle = res.data.title;
    setArchiveTarget(null);
    setNoticeMessage(`Archived "${archivedTitle}". Its artworks and records remain safely preserved.`);
    await loadProjects();
  };

  const handleRestoreProject = async (project: Project) => {
    setRestoringId(project.id);
    setActionError(null);
    const res = await projectManagementStorage.restoreProject(project.id);
    setRestoringId(null);

    if (!res.ok) {
      setActionError(res.error.message);
      return;
    }

    setNoticeMessage(`Restored "${res.data.title}" to Active Projects.`);
    await loadProjects();
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) {
      return;
    }
    setIsDeleting(true);
    setActionError(null);
    const deletedTitle = deleteTarget.title;
    const res = await projectManagementStorage.deleteProject(deleteTarget.id);
    setIsDeleting(false);

    if (!res.ok) {
      setActionError(res.error.message);
      setDeleteTarget(null);
      return;
    }

    setDeleteTarget(null);
    setNoticeMessage(`Permanently deleted "${deletedTitle}".`);
    await loadProjects();
  };

  const filterTabs: readonly {
    readonly id: ProjectListFilter;
    readonly label: string;
    readonly count: number;
  }[] = [
    { id: 'all', label: 'All Projects', count: counts.all },
    { id: 'active', label: 'Active Projects', count: counts.active },
    { id: 'archived', label: 'Archived Projects', count: counts.archived },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Projects"
        description="Manage saved creative studies, inspect workflow progress, archive completed explorations, or start a new project."
        actions={
          <Button
            variant="primary"
            leftIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
            onClick={() => {
              setCreateError(null);
              setCreateOpen(true);
            }}
            data-testid="new-project-button"
          >
            Create New Project
          </Button>
        }
      />

      {noticeMessage ? (
        <Alert
          tone="success"
          title={noticeMessage}
          action={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setNoticeMessage(null)}
            >
              Dismiss
            </Button>
          }
        />
      ) : null}

      {actionError ? (
        <Alert
          tone="destructive"
          title="Project operation failed"
          description={actionError}
          action={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setActionError(null)}
            >
              Dismiss
            </Button>
          }
        />
      ) : null}

      <SurfacePanel tone="elevated" padding="sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div
            role="tablist"
            aria-label="Project status filter"
            className="inline-flex flex-wrap items-center gap-1.5"
          >
            {filterTabs.map((tab) => {
              const selected = filter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setFilter(tab.id)}
                  className={cn(
                    'inline-flex h-9 items-center gap-2 rounded-[var(--ff-radius-md)] border px-3.5 text-[13px] font-medium transition-colors cursor-pointer',
                    selected
                      ? 'border-[var(--ff-color-primary)] bg-[var(--ff-color-primary)] text-[var(--ff-color-primary-foreground)]'
                      : 'border-[var(--ff-color-border)] bg-[var(--ff-color-surface)] text-[var(--ff-color-foreground)] hover:bg-[var(--ff-color-muted)]',
                  )}
                >
                  <span>{tab.label}</span>
                  <span
                    className={cn(
                      'text-[12px] tabular-nums',
                      selected
                        ? 'text-[var(--ff-color-primary-foreground)]/85'
                        : 'text-[var(--ff-color-muted-foreground)]',
                    )}
                  >
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="w-full sm:w-72">
              <SearchInput
                aria-label="Search projects by name"
                placeholder="Search projects by name..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onClear={() => setSearchQuery('')}
              />
            </div>

            <div className="w-full sm:w-52">
              <Select
                aria-label="Sort projects"
                value={sort}
                options={[...SORT_OPTIONS]}
                onChange={(event) => setSort(event.target.value as ProjectListSort)}
              />
            </div>
          </div>
        </div>
      </SurfacePanel>

      {isLoading ? (
        <LoadingState
          label="Loading saved projects..."
          description="Reading local IndexedDB studies and workflow counts."
        />
      ) : loadError ? (
        <ErrorState
          title="Unable to load projects"
          message={loadError}
          onRetry={() => void loadProjects()}
        />
      ) : summaries.length === 0 ? (
        <EmptyState
          icon={<FolderKanban className="h-5 w-5" aria-hidden="true" />}
          title="No saved projects yet"
          description="Create your first FormFusion study to organize source images, object analyses, curated styles, prompts, and generated artworks."
          action={
            <Button
              variant="primary"
              leftIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
              onClick={() => {
                setCreateError(null);
                setCreateOpen(true);
              }}
            >
              Create New Project
            </Button>
          }
        />
      ) : visibleSummaries.length === 0 && searchQuery.trim() !== '' ? (
        <EmptyState
          icon={<SearchX className="h-5 w-5" aria-hidden="true" />}
          title="No matching projects"
          description={`No projects matched "${searchQuery.trim()}" in the current view.`}
          action={
            <Button variant="outline" onClick={() => setSearchQuery('')}>
              Clear Search
            </Button>
          }
        />
      ) : visibleSummaries.length === 0 && filter === 'archived' ? (
        <EmptyState
          icon={<Archive className="h-5 w-5" aria-hidden="true" />}
          title="No archived projects"
          description="Archived projects appear here with all their artworks and prompt history preserved until you restore or delete them."
          action={
            <Button variant="outline" onClick={() => setFilter('all')}>
              View All Projects
            </Button>
          }
        />
      ) : visibleSummaries.length === 0 && filter === 'active' ? (
        <EmptyState
          icon={<FolderKanban className="h-5 w-5" aria-hidden="true" />}
          title="No active projects"
          description="All saved projects are currently archived. Restore an archived study or create a new project."
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button variant="outline" onClick={() => setFilter('archived')}>
                View Archived Projects
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  setCreateError(null);
                  setCreateOpen(true);
                }}
              >
                Create New Project
              </Button>
            </div>
          }
        />
      ) : (
        <div
          data-testid="projects-grid"
          className="grid gap-6 md:grid-cols-2 xl:grid-cols-3"
        >
          {visibleSummaries.map((summary) => (
            <ProjectCard
              key={summary.project.id}
              summary={summary}
              isOpening={openingId === summary.project.id}
              isBusy={isAnyActionBusy}
              onOpen={(proj) => void handleOpenProject(proj.id)}
              onRename={(proj) => {
                setRenameError(null);
                setRenameTarget(proj);
              }}
              onInspectMetadata={(item) => setMetadataTarget(item)}
              onRequestArchive={(proj) => setArchiveTarget(proj)}
              onRestore={(proj) => void handleRestoreProject(proj)}
              onRequestDelete={(proj) => setDeleteTarget(proj)}
            />
          ))}
        </div>
      )}

      <CreateProjectModal
        open={createOpen}
        isSubmitting={isCreating}
        submitError={createError}
        onClose={() => setCreateOpen(false)}
        onSubmit={handleCreateProject}
      />

      <RenameProjectModal
        open={renameTarget !== null}
        project={renameTarget}
        isSubmitting={isRenaming}
        submitError={renameError}
        onClose={() => setRenameTarget(null)}
        onSubmit={handleRenameSubmit}
      />

      <ProjectMetadataModal
        open={metadataTarget !== null}
        summary={metadataTarget}
        onClose={() => setMetadataTarget(null)}
        onOpenProject={(projId) => void handleOpenProject(projId)}
      />

      <ConfirmationDialog
        open={archiveTarget !== null}
        onClose={() => {
          if (!isArchiving) {
            setArchiveTarget(null);
          }
        }}
        onConfirm={() => void handleConfirmArchive()}
        title={`Archive "${archiveTarget?.title ?? ''}"?`}
        description="This project will move to Archived Projects. All source assets, analyses, descriptions, prompts, and generated artworks stay intact and can be restored anytime."
        confirmLabel="Archive Project"
        loading={isArchiving}
      />

      <ConfirmationDialog
        open={deleteTarget !== null}
        onClose={() => {
          if (!isDeleting) {
            setDeleteTarget(null);
          }
        }}
        onConfirm={() => void handleConfirmDelete()}
        title={`Delete "${deleteTarget?.title ?? ''}" permanently?`}
        description="This action permanently removes the project along with its analyses, object descriptions, prompts, generation history, and artworks. Any assets shared with other projects remain safe."
        confirmLabel="Delete Permanently"
        tone="destructive"
        loading={isDeleting}
      />
    </div>
  );
}

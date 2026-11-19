import { Bookmark, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStudioServices } from '../app/providers/AppProviders.tsx';
import { STUDIO_ROUTES } from '../app/routes/routeConfig.ts';
import { PresetCard } from '../components/presets/PresetCard.tsx';
import { PresetFormModal } from '../components/presets/PresetFormModal.tsx';
import {
  Alert,
  Button,
  ConfirmationDialog,
  EmptyState,
  LoadingState,
  PageHeader,
  SearchInput,
  SurfacePanel,
  Typography,
} from '../components/ui/index.ts';
import { CURATED_ART_STYLES } from '../services/art-style/contract.ts';
import type { ArtStyle, PersonalPreset } from '../types/domain.ts';
import type { SavePersonalPresetInput } from '../types/services.ts';

interface MyPresetsPageProps {
  readonly onNavigate: (path: string) => void;
}

export function MyPresetsPage({ onNavigate }: MyPresetsPageProps) {
  const route = STUDIO_ROUTES[4];
  const { artStyle, presetEngine, creativeStateStorage } = useStudioServices();

  const [presets, setPresets] = useState<readonly PersonalPreset[]>([]);
  const [styles, setStyles] = useState<readonly ArtStyle[]>(CURATED_ART_STYLES);
  const [searchQuery, setSearchQuery] = useState('');

  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [editingPreset, setEditingPreset] = useState<PersonalPreset | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<PersonalPreset | null>(
    null,
  );
  const [isDeleting, setIsDeleting] = useState(false);

  const loadPresetsAndStyles = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    const [presetsRes, stylesRes] = await Promise.all([
      presetEngine.listPresets(),
      artStyle.listStyles(),
    ]);

    if (!presetsRes.ok) {
      setErrorMessage(presetsRes.error.message);
      setIsLoading(false);
      return;
    }

    setPresets(presetsRes.data);
    if (stylesRes.ok && stylesRes.data.length > 0) {
      setStyles(stylesRes.data);
    }
    setIsLoading(false);
  }, [presetEngine, artStyle]);

  useEffect(() => {
    void loadPresetsAndStyles();
  }, [loadPresetsAndStyles]);

  const filteredPresets = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return presets;
    }
    return presets.filter((preset) => {
      const haystack = [
        preset.name,
        preset.description,
        preset.creativeDirectionSnapshot.styleName,
        preset.creativeDirectionSnapshot.styleCategory,
        preset.userCreativeInstructions,
        ...preset.tags,
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [presets, searchQuery]);

  const openCreateModal = () => {
    setModalMode('create');
    setEditingPreset(null);
    setModalError(null);
    setModalOpen(true);
  };

  const openEditModal = (preset: PersonalPreset) => {
    setModalMode('edit');
    setEditingPreset(preset);
    setModalError(null);
    setModalOpen(true);
  };

  const handleSubmitPreset = async (input: SavePersonalPresetInput) => {
    setIsSubmitting(true);
    setModalError(null);
    setErrorMessage(null);

    const res =
      modalMode === 'edit' && editingPreset
        ? await presetEngine.updatePreset(editingPreset.id, input)
        : await presetEngine.createPreset(input);

    setIsSubmitting(false);

    if (!res.ok) {
      setModalError(res.error.message);
      return;
    }

    setModalOpen(false);
    setEditingPreset(null);
    setNoticeMessage(
      modalMode === 'edit'
        ? `Updated preset "${res.data.name}".`
        : `Saved personal preset "${res.data.name}".`,
    );
    await loadPresetsAndStyles();
  };

  const handleDuplicate = async (preset: PersonalPreset) => {
    setDuplicatingId(preset.id);
    setErrorMessage(null);
    const res = await presetEngine.duplicatePreset(preset.id);
    setDuplicatingId(null);

    if (!res.ok) {
      setErrorMessage(res.error.message);
      return;
    }

    setNoticeMessage(`Duplicated preset as "${res.data.name}".`);
    await loadPresetsAndStyles();
  };

  const handleConfirmDelete = async () => {
    if (!deleteCandidate) {
      return;
    }
    setIsDeleting(true);
    setErrorMessage(null);
    const res = await presetEngine.deletePreset(deleteCandidate.id);
    setIsDeleting(false);

    if (!res.ok) {
      setErrorMessage(res.error.message);
      return;
    }

    const removedName = deleteCandidate.name;
    setDeleteCandidate(null);
    setNoticeMessage(`Deleted preset "${removedName}".`);
    await loadPresetsAndStyles();
  };

  const handleApplyPreset = async (preset: PersonalPreset) => {
    setApplyingId(preset.id);
    setErrorMessage(null);

    const projectRes = await creativeStateStorage.getOrCreateActiveProject();
    if (!projectRes.ok) {
      setApplyingId(null);
      setErrorMessage(projectRes.error.message);
      return;
    }

    const applyRes = await presetEngine.applyPresetToProject(
      projectRes.data.id,
      preset.id,
    );
    setApplyingId(null);

    if (!applyRes.ok) {
      setErrorMessage(applyRes.error.message);
      return;
    }

    onNavigate('/create');
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={route.title}
        description="Save reusable creative direction snapshots, output ratios, background treatments, and prompt instructions—and apply them cleanly without altering your uploaded source image, object description, or prompt history."
        actions={
          <div className="flex items-center gap-2.5">
            <Button variant="outline" onClick={() => onNavigate('/styles')}>
              Explore Style Library
            </Button>
            <Button
              variant="primary"
              data-testid="new-preset-btn"
              leftIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
              onClick={openCreateModal}
            >
              New Preset
            </Button>
          </div>
        }
      />

      {errorMessage ? (
        <Alert
          tone="destructive"
          title="Preset operation failed"
          description={errorMessage}
        />
      ) : null}

      {noticeMessage ? (
        <Alert
          tone="success"
          title="Preset library updated"
          description={noticeMessage}
        />
      ) : null}

      <SurfacePanel tone="default" padding="md" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="w-full max-w-md">
            <SearchInput
              id="my-presets-search"
              aria-label="Search presets"
              placeholder="Search presets by name, style, instructions, or tag..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <Typography variant="caption" muted className="tabular-nums">
            {filteredPresets.length} of {presets.length} presets saved locally
          </Typography>
        </div>
      </SurfacePanel>

      {isLoading ? (
        <LoadingState
          label="Loading personal presets..."
          description="Reading locally persisted preset configurations from IndexedDB."
        />
      ) : presets.length === 0 ? (
        <EmptyState
          icon={<Bookmark className="h-5 w-5" aria-hidden="true" />}
          title="No Personal Presets Yet"
          description="Capture your favorite curated or manual Creative Direction rules, aspect ratios, and creative instructions into a reusable studio preset."
          action={
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
              onClick={openCreateModal}
            >
              Create Your First Preset
            </Button>
          }
        />
      ) : filteredPresets.length === 0 ? (
        <EmptyState
          icon={<Bookmark className="h-5 w-5" aria-hidden="true" />}
          title="No presets match your search"
          description="Clear the search filter to view all saved personal presets."
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSearchQuery('')}
            >
              Clear Search
            </Button>
          }
        />
      ) : (
        <div
          data-testid="my-presets-grid"
          className="grid grid-cols-1 gap-5 md:grid-cols-2"
        >
          {filteredPresets.map((preset) => (
            <PresetCard
              key={preset.id}
              preset={preset}
              isApplying={applyingId === preset.id}
              isDuplicating={duplicatingId === preset.id}
              onApply={(p) => void handleApplyPreset(p)}
              onEdit={openEditModal}
              onDuplicate={(p) => void handleDuplicate(p)}
              onDeleteRequest={setDeleteCandidate}
            />
          ))}
        </div>
      )}

      <PresetFormModal
        open={modalOpen}
        mode={modalMode}
        initialPreset={editingPreset}
        availableStyles={styles}
        isSubmitting={isSubmitting}
        errorMessage={modalError}
        onClose={() => {
          if (!isSubmitting) {
            setModalOpen(false);
          }
        }}
        onSubmit={handleSubmitPreset}
      />

      <ConfirmationDialog
        open={deleteCandidate !== null}
        onClose={() => {
          if (!isDeleting) {
            setDeleteCandidate(null);
          }
        }}
        onConfirm={() => void handleConfirmDelete()}
        title="Delete Personal Preset?"
        description={
          deleteCandidate
            ? `Delete "${deleteCandidate.name}" from your local preset library? Active studies and saved prompt revisions will remain untouched.`
            : ''
        }
        confirmLabel="Delete Preset"
        tone="destructive"
        loading={isDeleting}
      />
    </div>
  );
}

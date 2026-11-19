import { Heart, Palette, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStudioServices } from '../app/providers/AppProviders.tsx';
import { STUDIO_ROUTES } from '../app/routes/routeConfig.ts';
import { StyleCard } from '../components/styles/StyleCard.tsx';
import { StyleDetailsModal } from '../components/styles/StyleDetailsModal.tsx';
import {
  Alert,
  Button,
  EmptyState,
  LoadingState,
  PageHeader,
  SearchInput,
  Select,
  SurfacePanel,
  Typography,
  cn,
} from '../components/ui/index.ts';
import {
  CURATED_STYLE_CATEGORIES,
  computeStyleCategoryCounts,
  filterAndSortStyleCatalog,
} from '../services/art-style/contract.ts';
import type {
  ArtStyle,
  CuratedArtStyleCategory,
  StyleCatalogItem,
} from '../types/domain.ts';
import type { StyleSortOption } from '../types/services.ts';

interface StyleLibraryPageProps {
  readonly onNavigate: (path: string) => void;
}

const SORT_OPTIONS: readonly { value: StyleSortOption; label: string }[] = [
  { value: 'curated_order', label: 'Sort: Curated Order' },
  { value: 'favorites_first', label: 'Sort: Favorites First' },
  { value: 'name_asc', label: 'Sort: Name (A–Z)' },
  { value: 'name_desc', label: 'Sort: Name (Z–A)' },
];

export function StyleLibraryPage({ onNavigate }: StyleLibraryPageProps) {
  const route = STUDIO_ROUTES[2];
  const { artStyle, creativeStateStorage } = useStudioServices();

  const [catalogItems, setCatalogItems] = useState<readonly StyleCatalogItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<
    CuratedArtStyleCategory | 'all'
  >('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [sortBy, setSortBy] = useState<StyleSortOption>('curated_order');

  const [activeStyleId, setActiveStyleId] = useState<string | null>(null);
  const [inspectedStyle, setInspectedStyle] = useState<ArtStyle | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [selectingStyleId, setSelectingStyleId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadCatalogAndProject = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    const [catalogRes, projectRes] = await Promise.all([
      artStyle.listCatalogWithFavorites(),
      creativeStateStorage.getOrCreateActiveProject(),
    ]);

    if (!catalogRes.ok) {
      setErrorMessage(catalogRes.error.message);
      setIsLoading(false);
      return;
    }

    setCatalogItems(catalogRes.data);
    if (projectRes.ok) {
      setActiveStyleId(projectRes.data.selectedStyleId);
    }
    setIsLoading(false);
  }, [artStyle, creativeStateStorage]);

  useEffect(() => {
    void loadCatalogAndProject();
  }, [loadCatalogAndProject]);

  const categoryCounts = useMemo(
    () => computeStyleCategoryCounts(catalogItems, favoritesOnly),
    [catalogItems, favoritesOnly],
  );

  const totalFavoritesCount = useMemo(
    () => catalogItems.filter((item) => item.isFavorite).length,
    [catalogItems],
  );

  const visibleItems = useMemo(
    () =>
      filterAndSortStyleCatalog(catalogItems, {
        search: searchQuery,
        category: selectedCategory,
        favoritesOnly,
        sortBy,
      }),
    [catalogItems, searchQuery, selectedCategory, favoritesOnly, sortBy],
  );

  const activeStyle = useMemo(
    () =>
      activeStyleId
        ? catalogItems.find((item) => item.style.id === activeStyleId)?.style ??
          null
        : null,
    [catalogItems, activeStyleId],
  );

  const inspectedItemIsFavorite = useMemo(() => {
    if (!inspectedStyle) {
      return false;
    }
    return Boolean(
      catalogItems.find((item) => item.style.id === inspectedStyle.id)
        ?.isFavorite,
    );
  }, [catalogItems, inspectedStyle]);

  const handleToggleFavorite = async (styleId: string) => {
    setErrorMessage(null);
    const res = await artStyle.toggleFavoriteStyle(styleId);
    if (!res.ok) {
      setErrorMessage(res.error.message);
      return;
    }

    setCatalogItems((prev) =>
      prev.map((item) =>
        item.style.id === styleId
          ? { ...item, isFavorite: res.data }
          : item,
      ),
    );
  };

  const handleSelectStyle = async (style: ArtStyle) => {
    setSelectingStyleId(style.id);
    setErrorMessage(null);

    const res = await creativeStateStorage.setProjectSelectedStyle(
      null,
      style.id,
      'curated',
    );
    setSelectingStyleId(null);

    if (!res.ok) {
      setErrorMessage(res.error.message);
      return;
    }

    setActiveStyleId(style.id);
    setInspectedStyle(null);
    onNavigate('/create');
  };

  const handleClearActiveStyle = async () => {
    setErrorMessage(null);
    const res = await creativeStateStorage.setProjectSelectedStyle(
      null,
      null,
      'manual',
    );
    if (!res.ok) {
      setErrorMessage(res.error.message);
      return;
    }
    setActiveStyleId(null);
  };

  const resetFilters = () => {
    setSearchQuery('');
    setSelectedCategory('all');
    setFavoritesOnly(false);
    setSortBy('curated_order');
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={route.title}
        description="Browse curated artistic directions, inspect visual and rendering rules, save favorites locally, and assign a style to your active FormFusion project."
        actions={
          <div className="flex items-center gap-2.5">
            <Button variant="outline" onClick={() => onNavigate('/presets')}>
              My Presets
            </Button>
            <Button variant="primary" onClick={() => onNavigate('/create')}>
              Go to Create / Generator
            </Button>
          </div>
        }
      />

      {errorMessage ? (
        <Alert
          tone="destructive"
          title="Style Library error"
          description={errorMessage}
        />
      ) : null}

      {activeStyle ? (
        <SurfacePanel
          tone="muted"
          padding="sm"
          data-testid="active-project-style-banner"
          className="flex flex-wrap items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2.5">
            <Sparkles
              className="h-4 w-4 text-[var(--ff-color-primary)]"
              aria-hidden="true"
            />
            <Typography variant="body-sm">
              Active Project Style:{' '}
              <strong className="font-semibold text-[var(--ff-color-foreground)]">
                {activeStyle.name}
              </strong>
            </Typography>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void handleClearActiveStyle()}
            >
              Clear Selection
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onNavigate('/create')}
            >
              Open in Prompt Composer
            </Button>
          </div>
        </SurfacePanel>
      ) : null}

      {/* Controls: Search, Favorites toggle, Sort, Category Tabs */}
      <SurfacePanel tone="default" padding="md" className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[1fr_auto_auto] md:items-center">
          <SearchInput
            id="style-library-search"
            aria-label="Search art styles"
            placeholder="Search by style name, category, medium, or keyword..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />

          <Button
            type="button"
            variant={favoritesOnly ? 'primary' : 'outline'}
            size="md"
            data-testid="filter-favorites-btn"
            aria-pressed={favoritesOnly}
            leftIcon={
              <Heart
                className={cn(
                  'h-4 w-4',
                  favoritesOnly ? 'fill-current' : '',
                )}
                aria-hidden="true"
              />
            }
            onClick={() => setFavoritesOnly((prev) => !prev)}
          >
            Favorites ({totalFavoritesCount})
          </Button>

          <div className="min-w-[200px]">
            <Select
              id="style-library-sort"
              aria-label="Sort styles"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as StyleSortOption)}
              options={[...SORT_OPTIONS]}
            />
          </div>
        </div>

        <div
          role="tablist"
          aria-label="Filter styles by category"
          className="flex flex-wrap items-center gap-2 border-t border-[var(--ff-color-border)] pt-3.5"
        >
          {CURATED_STYLE_CATEGORIES.map((category) => {
            const count = categoryCounts[category.id] ?? 0;
            const isActive = selectedCategory === category.id;
            return (
              <button
                key={category.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                data-testid={`category-filter-${category.id}`}
                onClick={() => setSelectedCategory(category.id)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-[var(--ff-radius-md)] border px-3 py-1.5 text-[13px] font-medium transition-colors cursor-pointer whitespace-nowrap',
                  isActive
                    ? 'border-[var(--ff-color-primary)] bg-[var(--ff-color-primary)] text-[var(--ff-color-primary-foreground)]'
                    : 'border-[var(--ff-color-border)] bg-[var(--ff-color-surface-elevated)] text-[var(--ff-color-foreground)] hover:bg-[var(--ff-color-muted)]',
                )}
              >
                <span>{category.label}</span>
                <span
                  className={cn(
                    'text-[11px] tabular-nums',
                    isActive
                      ? 'text-white/85'
                      : 'text-[var(--ff-color-muted-foreground)]',
                  )}
                >
                  ({count})
                </span>
              </button>
            );
          })}
        </div>
      </SurfacePanel>

      {/* Catalog Grid */}
      {isLoading ? (
        <LoadingState
          label="Loading curated Art Style Library..."
          description="Ensuring curated visual directions and local favorites are ready."
        />
      ) : visibleItems.length === 0 ? (
        <EmptyState
          icon={<Palette className="h-5 w-5" aria-hidden="true" />}
          title={
            favoritesOnly
              ? 'No favorited styles match your current filters'
              : 'No art styles match your search or category filter'
          }
          description="Try clearing your search query, switching categories, or removing the favorites filter to explore all curated styles."
          action={
            <Button variant="outline" size="sm" onClick={resetFilters}>
              Reset Filters
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          <Typography variant="caption" muted className="block tabular-nums">
            Showing {visibleItems.length} of {catalogItems.length} curated styles
          </Typography>

          <div
            data-testid="style-library-grid"
            className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3"
          >
            {visibleItems.map(({ style, isFavorite }) => (
              <StyleCard
                key={style.id}
                style={style}
                isFavorite={isFavorite}
                isSelected={activeStyleId === style.id}
                isSelecting={selectingStyleId === style.id}
                onToggleFavorite={(id) => void handleToggleFavorite(id)}
                onViewDetails={(target) => setInspectedStyle(target)}
                onSelectStyle={(target) => void handleSelectStyle(target)}
              />
            ))}
          </div>
        </div>
      )}

      <StyleDetailsModal
        style={inspectedStyle}
        open={inspectedStyle !== null}
        isFavorite={inspectedItemIsFavorite}
        isSelected={
          inspectedStyle !== null && activeStyleId === inspectedStyle.id
        }
        isSelecting={
          inspectedStyle !== null && selectingStyleId === inspectedStyle.id
        }
        onClose={() => setInspectedStyle(null)}
        onToggleFavorite={(id) => void handleToggleFavorite(id)}
        onSelectStyle={(target) => void handleSelectStyle(target)}
      />
    </div>
  );
}

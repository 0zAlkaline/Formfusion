export type StudioRouteId =
  | 'dashboard'
  | 'create'
  | 'styles'
  | 'projects'
  | 'presets'
  | 'settings';

export interface StudioRouteDefinition {
  readonly id: StudioRouteId;
  readonly path: string;
  readonly label: string;
  readonly title: string;
  readonly contextLabel: string;
  readonly description: string;
  readonly phaseScopeNote: string;
}

export type StudioRouteMatch =
  | {
      readonly matched: true;
      readonly route: StudioRouteDefinition;
      readonly pathname: string;
    }
  | {
      readonly matched: false;
      readonly route: null;
      readonly pathname: string;
    };

export const STUDIO_ROUTES: readonly StudioRouteDefinition[] = [
  {
    id: 'dashboard',
    path: '/',
    label: 'Dashboard',
    title: 'Studio Dashboard',
    contextLabel: 'Workspace Overview',
    description:
      'Editorial overview of active creative studies, recent artwork direction, and local studio architecture.',
    phaseScopeNote:
      'Dashboard overview slot ready for future project and recent-artwork summaries.',
  },
  {
    id: 'create',
    path: '/create',
    label: 'Create / Generator',
    title: 'Create / Generator',
    contextLabel: 'Structured Production Workflow',
    description:
      'Multi-stage creative studio pipeline from source object analysis to approved text-to-image generation.',
    phaseScopeNote:
      'Workflow canvas slot ready for upload, Vision analysis, description editing, style selection, prompt approval, and generation.',
  },
  {
    id: 'styles',
    path: '/styles',
    label: 'Style Library',
    title: 'Style Library',
    contextLabel: 'Curated Visual Directions',
    description:
      'Curated artistic mediums, lighting vocabularies, and negative directive systems.',
    phaseScopeNote:
      'Style Library catalog slot ready for curated art style browsing and inspection.',
  },
  {
    id: 'projects',
    path: '/projects',
    label: 'My Projects',
    title: 'My Projects',
    contextLabel: 'Local-First Archive',
    description:
      'Saved FormFusion creative studies stored locally via the IndexedDB project architecture.',
    phaseScopeNote:
      'Project archive slot ready for local-first IndexedDB CRUD and bundle management.',
  },
  {
    id: 'presets',
    path: '/presets',
    label: 'My Presets',
    title: 'My Presets',
    contextLabel: 'Reusable Studio Configurations',
    description:
      'Saved aspect ratios, resolution tiers, negative directives, and instruction templates.',
    phaseScopeNote:
      'Preset management slot ready for reusable generation parameter templates.',
  },
  {
    id: 'settings',
    path: '/settings',
    label: 'Settings',
    title: 'Studio Settings',
    contextLabel: 'Workspace & Boundary Preferences',
    description:
      'Desktop workspace preferences, local storage inspection, and server-side boundary overview.',
    phaseScopeNote:
      'Settings slot ready for non-sensitive studio preferences (provider keys remain strictly server-side).',
  },
] as const;

export function normalizeRoutePathname(pathname: string): string {
  const withoutQuery = pathname.split('?')[0]?.split('#')[0] ?? '/';
  const collapsed = withoutQuery.replace(/\/{2,}/g, '/');
  if (collapsed === '' || collapsed === '/') {
    return '/';
  }
  const trimmed = collapsed.replace(/\/+$/, '');
  return (trimmed || '/').toLowerCase();
}

export function matchStudioRoute(pathname: string): StudioRouteMatch {
  const normalized = normalizeRoutePathname(pathname);
  const match = STUDIO_ROUTES.find((route) => route.path === normalized);
  if (match) {
    return {
      matched: true,
      route: match,
      pathname: normalized,
    };
  }
  return {
    matched: false,
    route: null,
    pathname: normalized,
  };
}

export function resolveStudioRouteByPath(
  pathname: string,
): StudioRouteDefinition {
  const result = matchStudioRoute(pathname);
  return result.matched ? result.route : STUDIO_ROUTES[0];
}

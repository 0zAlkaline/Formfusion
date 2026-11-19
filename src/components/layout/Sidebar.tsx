import {
  Bookmark,
  FolderKanban,
  LayoutDashboard,
  Palette,
  Settings,
  Wand2,
} from 'lucide-react';
import type { ReactNode } from 'react';
import {
  STUDIO_ROUTES,
  type StudioRouteId,
} from '../../app/routes/routeConfig.ts';
import { SidebarItem } from '../ui/Navigation.tsx';
import { Typography } from '../ui/Typography.tsx';

const ROUTE_ICONS: Record<StudioRouteId, ReactNode> = {
  dashboard: <LayoutDashboard className="h-4 w-4" />,
  create: <Wand2 className="h-4 w-4" />,
  styles: <Palette className="h-4 w-4" />,
  projects: <FolderKanban className="h-4 w-4" />,
  presets: <Bookmark className="h-4 w-4" />,
  settings: <Settings className="h-4 w-4" />,
};

interface BrandIdentityProps {
  readonly onNavigate: (path: string) => void;
}

export function BrandIdentity({ onNavigate }: BrandIdentityProps) {
  return (
    <div className="flex h-[var(--ff-layout-header-height)] items-center justify-between border-b border-[var(--ff-color-border)] px-5">
      <a
        href="/"
        onClick={(event) => {
          event.preventDefault();
          onNavigate('/');
        }}
        className="font-[family-name:var(--ff-font-display)] text-[17px] font-bold tracking-[-0.02em] text-[var(--ff-color-foreground)] whitespace-nowrap shrink-0"
      >
        FormFusion
      </a>
      <Typography variant="caption" muted className="whitespace-nowrap">
        v2.0
      </Typography>
    </div>
  );
}

export function WorkspaceLabel() {
  return (
    <div className="hidden border-b border-[var(--ff-color-border)] px-5 py-3 lg:block">
      <Typography variant="caption" muted className="block">
        Personal Creative Studio
      </Typography>
    </div>
  );
}

interface PrimaryNavigationProps {
  readonly activeRouteId: StudioRouteId | null;
  readonly onNavigate: (path: string) => void;
}

export function PrimaryNavigation({
  activeRouteId,
  onNavigate,
}: PrimaryNavigationProps) {
  return (
    <nav
      aria-label="Primary Navigation"
      className="flex flex-wrap gap-1 p-3 lg:flex-col lg:gap-1 lg:p-4"
    >
      {STUDIO_ROUTES.map((route) => (
        <SidebarItem
          key={route.id}
          href={route.path}
          label={route.label}
          icon={ROUTE_ICONS[route.id]}
          active={activeRouteId === route.id}
          onSelect={() => onNavigate(route.path)}
        />
      ))}
    </nav>
  );
}

export function SidebarFooter() {
  return (
    <div className="hidden border-t border-[var(--ff-color-border)] px-5 py-4 lg:mt-auto lg:block">
      <Typography variant="caption" muted className="block">
        Local-First Desktop Studio
      </Typography>
      <Typography variant="body-sm" className="mt-0.5 font-medium">
        Phase 01.3 Shell
      </Typography>
    </div>
  );
}

export interface SidebarProps {
  readonly activeRouteId: StudioRouteId | null;
  readonly onNavigate: (path: string) => void;
}

export function Sidebar({ activeRouteId, onNavigate }: SidebarProps) {
  return (
    <aside className="border-b border-[var(--ff-color-border)] bg-[var(--ff-color-surface)] lg:flex lg:w-[var(--ff-layout-sidebar-width)] lg:shrink-0 lg:flex-col lg:border-b-0 lg:border-r">
      <BrandIdentity onNavigate={onNavigate} />
      <WorkspaceLabel />
      <PrimaryNavigation
        activeRouteId={activeRouteId}
        onNavigate={onNavigate}
      />
      <SidebarFooter />
    </aside>
  );
}

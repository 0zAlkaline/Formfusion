import type { StudioRouteMatch } from '../app/routes/routeConfig.ts';
import { ApplicationShell } from '../components/layout/ApplicationShell.tsx';
import { Button } from '../components/ui/Button.tsx';
import type { BreadcrumbItem } from '../components/ui/Navigation.tsx';
import { CreatePage } from './CreatePage.tsx';
import { DashboardPage } from './DashboardPage.tsx';
import { MyPresetsPage } from './MyPresetsPage.tsx';
import { MyProjectsPage } from './MyProjectsPage.tsx';
import { NotFoundPage } from './NotFoundPage.tsx';
import { SettingsPage } from './SettingsPage.tsx';
import { StyleLibraryPage } from './StyleLibraryPage.tsx';

interface StudioRouteViewProps {
  readonly routeMatch: StudioRouteMatch;
  readonly onNavigate: (path: string) => void;
}

export function StudioRouteView({
  routeMatch,
  onNavigate,
}: StudioRouteViewProps) {
  const breadcrumbs: readonly BreadcrumbItem[] = routeMatch.matched
    ? routeMatch.route.id === 'dashboard'
      ? [{ label: 'FormFusion Studio' }, { label: 'Dashboard' }]
      : [
          {
            label: 'FormFusion Studio',
            href: '/',
            onNavigate: () => onNavigate('/'),
          },
          { label: routeMatch.route.label },
        ]
    : [
        {
          label: 'FormFusion Studio',
          href: '/',
          onNavigate: () => onNavigate('/'),
        },
        { label: 'Not Found' },
      ];

  const pageContext = routeMatch.matched
    ? routeMatch.route.contextLabel
    : 'Unknown Route';

  const headerActions =
    routeMatch.matched && routeMatch.route.id === 'create' ? (
      <Button variant="outline" size="sm" onClick={() => onNavigate('/projects')}>
        My Projects
      </Button>
    ) : (
      <Button variant="primary" size="sm" onClick={() => onNavigate('/create')}>
        Create / Generator
      </Button>
    );

  const renderPage = () => {
    if (!routeMatch.matched) {
      return (
        <NotFoundPage
          requestedPath={routeMatch.pathname}
          onNavigate={onNavigate}
        />
      );
    }

    switch (routeMatch.route.id) {
      case 'dashboard':
        return <DashboardPage onNavigate={onNavigate} />;
      case 'create':
        return <CreatePage onNavigate={onNavigate} />;
      case 'styles':
        return <StyleLibraryPage onNavigate={onNavigate} />;
      case 'projects':
        return <MyProjectsPage onNavigate={onNavigate} />;
      case 'presets':
        return <MyPresetsPage onNavigate={onNavigate} />;
      case 'settings':
        return <SettingsPage onNavigate={onNavigate} />;
    }
  };

  return (
    <ApplicationShell
      activeRouteId={routeMatch.matched ? routeMatch.route.id : null}
      breadcrumbs={breadcrumbs}
      pageContext={pageContext}
      headerActions={headerActions}
      onNavigate={onNavigate}
    >
      {renderPage()}
    </ApplicationShell>
  );
}

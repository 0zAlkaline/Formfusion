import type { ReactNode } from 'react';
import type { StudioRouteId } from '../../app/routes/routeConfig.ts';
import type { BreadcrumbItem } from '../ui/Navigation.tsx';
import { GlobalOverlayProvider } from './GlobalOverlayRoot.tsx';
import { PageContainer, type PageContainerWidth } from './PageContainer.tsx';
import { Sidebar } from './Sidebar.tsx';
import { TopHeader } from './TopHeader.tsx';

export interface ApplicationShellProps {
  readonly activeRouteId: StudioRouteId | null;
  readonly breadcrumbs: readonly BreadcrumbItem[];
  readonly pageContext?: string;
  readonly headerActions?: ReactNode;
  readonly containerWidth?: PageContainerWidth;
  readonly onNavigate: (path: string) => void;
  readonly children: ReactNode;
}

export function ApplicationShell({
  activeRouteId,
  breadcrumbs,
  pageContext,
  headerActions,
  containerWidth = 'wide',
  onNavigate,
  children,
}: ApplicationShellProps) {
  return (
    <GlobalOverlayProvider>
      <div className="min-h-screen bg-[var(--ff-color-background)] text-[var(--ff-color-foreground)] lg:flex">
        <Sidebar activeRouteId={activeRouteId} onNavigate={onNavigate} />

        <div className="flex min-w-0 flex-1 flex-col">
          <TopHeader
            breadcrumbs={breadcrumbs}
            pageContext={pageContext}
            actions={headerActions}
          />

          <main className="min-w-0 flex-1">
            <PageContainer maxWidth={containerWidth}>{children}</PageContainer>
          </main>
        </div>
      </div>
    </GlobalOverlayProvider>
  );
}

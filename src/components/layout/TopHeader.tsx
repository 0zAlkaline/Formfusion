import type { ReactNode } from 'react';
import { Breadcrumb, type BreadcrumbItem } from '../ui/Navigation.tsx';
import { Typography } from '../ui/Typography.tsx';

export interface TopHeaderProps {
  readonly breadcrumbs: readonly BreadcrumbItem[];
  readonly pageContext?: string;
  readonly actions?: ReactNode;
}

export function TopHeader({
  breadcrumbs,
  pageContext,
  actions,
}: TopHeaderProps) {
  return (
    <header className="flex min-h-[var(--ff-layout-header-height)] items-center justify-between gap-6 border-b border-[var(--ff-color-border)] bg-[var(--ff-color-surface)] px-6 py-2 lg:px-8">
      <div className="flex min-w-0 items-center gap-4">
        <Breadcrumb items={breadcrumbs} />
        {pageContext ? (
          <>
            <span
              className="hidden h-4 w-px bg-[var(--ff-color-border)] lg:inline-block"
              aria-hidden="true"
            />
            <Typography
              variant="caption"
              muted
              className="hidden truncate lg:inline-block"
            >
              {pageContext}
            </Typography>
          </>
        ) : null}
      </div>

      {actions ? (
        <div className="flex shrink-0 items-center gap-3">{actions}</div>
      ) : null}
    </header>
  );
}

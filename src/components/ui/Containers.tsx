import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn.ts';
import { Typography } from './Typography.tsx';

export type SurfaceTone = 'default' | 'elevated' | 'muted' | 'dark';

const SURFACE_TONE_CLASSES: Record<SurfaceTone, string> = {
  default:
    'bg-[var(--ff-color-surface)] text-[var(--ff-color-foreground)] border-[var(--ff-color-border)]',
  elevated:
    'bg-[var(--ff-color-surface-elevated)] text-[var(--ff-color-foreground)] border-[var(--ff-color-border)]',
  muted:
    'bg-[var(--ff-color-muted)] text-[var(--ff-color-foreground)] border-[var(--ff-color-border)]',
  dark: 'bg-[var(--ff-color-surface-dark)] text-[var(--ff-color-secondary-foreground)] border-[#272A32]',
};

export interface SurfacePanelProps extends HTMLAttributes<HTMLDivElement> {
  readonly tone?: SurfaceTone;
  readonly padding?: 'none' | 'sm' | 'md' | 'lg';
  readonly children: ReactNode;
}

const PANEL_PADDING: Record<NonNullable<SurfacePanelProps['padding']>, string> = {
  none: 'p-0',
  sm: 'p-4',
  md: 'p-5',
  lg: 'p-6',
};

export function SurfacePanel({
  tone = 'default',
  padding = 'md',
  className,
  children,
  ...rest
}: SurfacePanelProps) {
  return (
    <div
      className={cn(
        'rounded-[var(--ff-radius-md)] border',
        SURFACE_TONE_CLASSES[tone],
        PANEL_PADDING[padding],
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export interface CardProps extends HTMLAttributes<HTMLElement> {
  readonly padding?: 'none' | 'sm' | 'md' | 'lg';
  readonly children: ReactNode;
}

export function Card({
  padding = 'lg',
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <section
      className={cn(
        'rounded-[var(--ff-radius-md)] border border-[var(--ff-color-border)] bg-[var(--ff-color-surface)] text-[var(--ff-color-foreground)]',
        PANEL_PADDING[padding],
        className,
      )}
      {...rest}
    >
      {children}
    </section>
  );
}

export function CardHeader({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex flex-col gap-1', className)} {...rest}>
      {children}
    </div>
  );
}

export function CardTitle({
  className,
  children,
}: {
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <Typography variant="h3" className={className}>
      {children}
    </Typography>
  );
}

export function CardDescription({
  className,
  children,
}: {
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <Typography variant="body-sm" muted className={className}>
      {children}
    </Typography>
  );
}

export function CardContent({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('mt-4', className)} {...rest}>
      {children}
    </div>
  );
}

export function CardFooter({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'mt-5 flex items-center justify-end gap-3 border-t border-[var(--ff-color-border)] pt-4',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export interface SectionContainerProps extends HTMLAttributes<HTMLElement> {
  readonly title?: string;
  readonly description?: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}

export function SectionContainer({
  title,
  description,
  action,
  className,
  children,
  ...rest
}: SectionContainerProps) {
  return (
    <section className={cn('space-y-4', className)} {...rest}>
      {title || description || action ? (
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--ff-color-border)] pb-3">
          <div className="space-y-1">
            {title ? <Typography variant="h2">{title}</Typography> : null}
            {description ? (
              <Typography variant="body-sm" muted>
                {description}
              </Typography>
            ) : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export interface PageHeaderProps {
  readonly title: string;
  readonly description?: string;
  readonly breadcrumb?: ReactNode;
  readonly actions?: ReactNode;
  readonly className?: string;
}

export function PageHeader({
  title,
  description,
  breadcrumb,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 border-b border-[var(--ff-color-border)] pb-6',
        className,
      )}
    >
      {breadcrumb ? <div>{breadcrumb}</div> : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-1">
          <Typography variant="display-lg">{title}</Typography>
          {description ? (
            <Typography variant="body" muted className="max-w-2xl">
              {description}
            </Typography>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 items-center gap-3">{actions}</div>
        ) : null}
      </div>
    </div>
  );
}

export interface WorkspacePanelProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly toolbar?: ReactNode;
  readonly aside?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}

export function WorkspacePanel({
  title,
  subtitle,
  toolbar,
  aside,
  children,
  className,
}: WorkspacePanelProps) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-[var(--ff-radius-md)] border border-[var(--ff-color-border)] bg-[var(--ff-color-surface)]',
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--ff-color-border)] px-6 py-4">
        <div className="min-w-0">
          <Typography variant="h3">{title}</Typography>
          {subtitle ? (
            <Typography variant="caption" muted className="mt-0.5 block">
              {subtitle}
            </Typography>
          ) : null}
        </div>
        {toolbar ? (
          <div className="flex shrink-0 items-center gap-2">{toolbar}</div>
        ) : null}
      </div>

      <div className={cn('grid', aside ? 'lg:grid-cols-[1fr_340px]' : 'grid-cols-1')}>
        <div className="min-w-0 p-6">{children}</div>
        {aside ? (
          <aside className="border-t border-[var(--ff-color-border)] bg-[var(--ff-color-surface-elevated)] p-6 lg:border-l lg:border-t-0">
            {aside}
          </aside>
        ) : null}
      </div>
    </div>
  );
}

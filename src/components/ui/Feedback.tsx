import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  FolderOpen,
  Info,
  Loader2,
} from 'lucide-react';
import { useId, useState, type HTMLAttributes, type ReactNode } from 'react';
import { Button } from './Button.tsx';
import { cn } from './cn.ts';
import { Typography } from './Typography.tsx';

export type BadgeTone =
  | 'neutral'
  | 'primary'
  | 'accent'
  | 'success'
  | 'warning'
  | 'destructive'
  | 'info';

const BADGE_STYLES: Record<BadgeTone, string> = {
  neutral:
    'bg-[var(--ff-color-muted)] text-[var(--ff-color-foreground)] border-[var(--ff-color-border)]',
  primary:
    'bg-[var(--ff-color-primary)] text-[var(--ff-color-primary-foreground)] border-transparent',
  accent:
    'bg-[var(--ff-color-accent)] text-[var(--ff-color-accent-foreground)] border-[#C5E252]',
  success:
    'bg-[var(--ff-color-success-subtle)] text-[var(--ff-color-success)] border-[#C3DFCF]',
  warning:
    'bg-[var(--ff-color-warning-subtle)] text-[var(--ff-color-warning)] border-[#EAD7B6]',
  destructive:
    'bg-[var(--ff-color-destructive-subtle)] text-[var(--ff-color-destructive)] border-[#ECC7C4]',
  info:
    'bg-[var(--ff-color-info-subtle)] text-[var(--ff-color-info)] border-[#C8D4F6]',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  readonly tone?: BadgeTone;
  readonly children: ReactNode;
  readonly className?: string;
}

export function Badge({
  tone = 'neutral',
  children,
  className,
  ...rest
}: BadgeProps) {
  return (
    <span
      {...rest}
      className={cn(
        'inline-flex items-center rounded-[var(--ff-radius-sm)] border px-2 py-0.5 text-[12px] font-medium leading-4 whitespace-nowrap shrink-0',
        BADGE_STYLES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export type AlertTone = 'info' | 'success' | 'warning' | 'destructive';

const ALERT_STYLES: Record<AlertTone, string> = {
  info: 'bg-[var(--ff-color-info-subtle)] border-[#C8D4F6] text-[var(--ff-color-foreground)]',
  success:
    'bg-[var(--ff-color-success-subtle)] border-[#C3DFCF] text-[var(--ff-color-foreground)]',
  warning:
    'bg-[var(--ff-color-warning-subtle)] border-[#EAD7B6] text-[var(--ff-color-foreground)]',
  destructive:
    'bg-[var(--ff-color-destructive-subtle)] border-[#ECC7C4] text-[var(--ff-color-foreground)]',
};

const ALERT_ICON_COLOR: Record<AlertTone, string> = {
  info: 'text-[var(--ff-color-info)]',
  success: 'text-[var(--ff-color-success)]',
  warning: 'text-[var(--ff-color-warning)]',
  destructive: 'text-[var(--ff-color-destructive)]',
};

function AlertIcon({ tone }: { readonly tone: AlertTone }) {
  const iconClass = cn('h-4 w-4 shrink-0 mt-0.5', ALERT_ICON_COLOR[tone]);
  switch (tone) {
    case 'success':
      return <CheckCircle2 className={iconClass} aria-hidden="true" />;
    case 'warning':
      return <AlertTriangle className={iconClass} aria-hidden="true" />;
    case 'destructive':
      return <AlertCircle className={iconClass} aria-hidden="true" />;
    default:
      return <Info className={iconClass} aria-hidden="true" />;
  }
}

export interface AlertProps {
  readonly tone?: AlertTone;
  readonly title: string;
  readonly description?: string;
  readonly action?: ReactNode;
  readonly className?: string;
  readonly 'data-testid'?: string;
}

export function Alert({
  tone = 'info',
  title,
  description,
  action,
  className,
  'data-testid': testId,
}: AlertProps) {
  return (
    <div
      role={tone === 'destructive' || tone === 'warning' ? 'alert' : 'status'}
      data-testid={testId}
      className={cn(
        'flex items-start justify-between gap-4 rounded-[var(--ff-radius-md)] border px-4 py-3',
        ALERT_STYLES[tone],
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <AlertIcon tone={tone} />
        <div className="space-y-0.5">
          <p className="text-[14px] font-medium leading-5 text-[var(--ff-color-foreground)]">
            {title}
          </p>
          {description ? (
            <p className="text-[13px] leading-5 text-[var(--ff-color-muted-foreground)]">
              {description}
            </p>
          ) : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export interface TooltipProps {
  readonly content: string;
  readonly children: ReactNode;
  readonly side?: 'top' | 'bottom';
}

export function Tooltip({
  content,
  children,
  side = 'top',
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const tooltipId = useId();

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      aria-describedby={open ? tooltipId : undefined}
    >
      {children}
      {open ? (
        <span
          id={tooltipId}
          role="tooltip"
          className={cn(
            'pointer-events-none absolute left-1/2 z-40 -translate-x-1/2 whitespace-nowrap rounded-[var(--ff-radius-sm)] bg-[var(--ff-color-surface-dark)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--ff-color-secondary-foreground)]',
            side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
          )}
        >
          {content}
        </span>
      ) : null}
    </span>
  );
}

export interface EmptyStateProps {
  readonly icon?: ReactNode;
  readonly title: string;
  readonly description: string;
  readonly action?: ReactNode;
  readonly className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-[var(--ff-radius-md)] border border-dashed border-[var(--ff-color-input)] bg-[var(--ff-color-surface-elevated)] px-6 py-10 text-center',
        className,
      )}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-[var(--ff-radius-md)] border border-[var(--ff-color-border)] bg-[var(--ff-color-surface)] text-[var(--ff-color-muted-foreground)]">
        {icon ?? <FolderOpen className="h-5 w-5" aria-hidden="true" />}
      </div>
      <Typography variant="h3" className="mt-4">
        {title}
      </Typography>
      <Typography variant="body-sm" muted className="mt-1.5 max-w-md">
        {description}
      </Typography>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export interface LoadingStateProps {
  readonly label?: string;
  readonly description?: string;
  readonly className?: string;
}

export function LoadingState({
  label = 'Preparing studio workspace',
  description,
  className,
}: LoadingStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex flex-col items-center justify-center rounded-[var(--ff-radius-md)] border border-[var(--ff-color-border)] bg-[var(--ff-color-surface)] px-6 py-10 text-center',
        className,
      )}
    >
      <Loader2
        className="h-5 w-5 animate-spin text-[var(--ff-color-primary)]"
        aria-hidden="true"
      />
      <Typography variant="label" className="mt-3">
        {label}
      </Typography>
      {description ? (
        <Typography variant="caption" muted className="mt-1">
          {description}
        </Typography>
      ) : null}
    </div>
  );
}

export interface ErrorStateProps {
  readonly title?: string;
  readonly message: string;
  readonly onRetry?: () => void;
  readonly retryLabel?: string;
  readonly className?: string;
}

export function ErrorState({
  title = 'Unable to complete operation',
  message,
  onRetry,
  retryLabel = 'Try Again',
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-start gap-3 rounded-[var(--ff-radius-md)] border border-[#ECC7C4] bg-[var(--ff-color-destructive-subtle)] p-5',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <AlertCircle
          className="mt-0.5 h-5 w-5 shrink-0 text-[var(--ff-color-destructive)]"
          aria-hidden="true"
        />
        <div className="space-y-1">
          <Typography variant="h3">{title}</Typography>
          <Typography variant="body-sm" muted>
            {message}
          </Typography>
        </div>
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}

import { Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from './cn.ts';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'outline'
  | 'ghost'
  | 'destructive';

export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANT_STYLES: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--ff-color-primary)] text-[var(--ff-color-primary-foreground)] border border-transparent hover:bg-[var(--ff-color-primary-hover)] active:bg-[var(--ff-color-primary-active)]',
  secondary:
    'bg-[var(--ff-color-secondary)] text-[var(--ff-color-secondary-foreground)] border border-transparent hover:bg-[var(--ff-color-secondary-hover)] active:bg-[var(--ff-color-secondary-active)]',
  outline:
    'bg-[var(--ff-color-surface)] text-[var(--ff-color-foreground)] border border-[var(--ff-color-border)] hover:border-[var(--ff-color-input)] hover:bg-[var(--ff-color-surface-elevated)] active:bg-[var(--ff-color-muted)]',
  ghost:
    'bg-transparent text-[var(--ff-color-foreground)] border border-transparent hover:bg-[var(--ff-color-muted)] active:bg-[var(--ff-color-border)]',
  destructive:
    'bg-[var(--ff-color-destructive)] text-[var(--ff-color-destructive-foreground)] border border-transparent hover:bg-[var(--ff-color-destructive-hover)] active:opacity-95',
};

const SIZE_STYLES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5',
  md: 'h-10 px-4 text-[14px] gap-2',
  lg: 'h-11 px-5 text-[14px] gap-2',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly loading?: boolean;
  readonly pressed?: boolean;
  readonly leftIcon?: ReactNode;
  readonly rightIcon?: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  pressed = false,
  disabled = false,
  leftIcon,
  rightIcon,
  className,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <button
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      aria-pressed={pressed || undefined}
      className={cn(
        'inline-flex items-center justify-center rounded-[var(--ff-radius-md)] font-[family-name:var(--ff-font-body)] font-medium whitespace-nowrap shrink-0 cursor-pointer select-none transition-[background-color,border-color,color,transform,opacity] duration-150 ease-out active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45 disabled:active:translate-y-0',
        VARIANT_STYLES[variant],
        SIZE_STYLES[size],
        pressed && variant === 'outline' && 'bg-[var(--ff-color-muted)] border-[var(--ff-color-foreground)]',
        className,
      )}
      {...rest}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden="true" />
      ) : (
        leftIcon && <span className="inline-flex shrink-0">{leftIcon}</span>
      )}
      <span>{children}</span>
      {!loading && rightIcon && (
        <span className="inline-flex shrink-0">{rightIcon}</span>
      )}
    </button>
  );
}

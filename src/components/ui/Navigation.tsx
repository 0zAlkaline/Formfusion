import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button, type ButtonProps } from './Button.tsx';
import { cn } from './cn.ts';

export interface SidebarItemProps {
  readonly href: string;
  readonly label: string;
  readonly icon?: ReactNode;
  readonly active?: boolean;
  readonly onSelect?: () => void;
}

export function SidebarItem({
  href,
  label,
  icon,
  active = false,
  onSelect,
}: SidebarItemProps) {
  return (
    <a
      href={href}
      aria-current={active ? 'page' : undefined}
      onClick={(event) => {
        if (onSelect) {
          event.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        'flex items-center gap-2.5 rounded-[var(--ff-radius-md)] px-3 py-2 text-[14px] font-medium whitespace-nowrap shrink-0 transition-colors duration-150',
        active
          ? 'bg-[var(--ff-color-primary)] text-[var(--ff-color-primary-foreground)]'
          : 'text-[var(--ff-color-foreground)] hover:bg-[var(--ff-color-muted)]',
      )}
    >
      {icon ? (
        <span
          className={cn(
            'inline-flex h-4 w-4 shrink-0 items-center justify-center',
            active
              ? 'text-[var(--ff-color-primary-foreground)]'
              : 'text-[var(--ff-color-muted-foreground)]',
          )}
          aria-hidden="true"
        >
          {icon}
        </span>
      ) : null}
      <span className="truncate">{label}</span>
    </a>
  );
}

export interface BreadcrumbItem {
  readonly label: string;
  readonly href?: string;
  readonly onNavigate?: () => void;
}

export interface BreadcrumbProps {
  readonly items: readonly BreadcrumbItem[];
  readonly className?: string;
}

export function Breadcrumb({ items, className }: BreadcrumbProps) {
  return (
    <nav aria-label="Breadcrumb" className={cn('flex items-center', className)}>
      <ol className="flex flex-wrap items-center gap-1.5 text-[13px] text-[var(--ff-color-muted-foreground)]">
        {items.map((item, idx) => {
          const isLast = idx === items.length - 1;
          return (
            <li key={`${item.label}-${idx}`} className="inline-flex items-center gap-1.5">
              {idx > 0 ? (
                <ChevronRight
                  className="h-3.5 w-3.5 text-[var(--ff-color-muted-foreground)]"
                  aria-hidden="true"
                />
              ) : null}
              {item.href && !isLast ? (
                <a
                  href={item.href}
                  onClick={(event) => {
                    if (item.onNavigate) {
                      event.preventDefault();
                      item.onNavigate();
                    }
                  }}
                  className="hover:text-[var(--ff-color-foreground)] transition-colors whitespace-nowrap"
                >
                  {item.label}
                </a>
              ) : (
                <span
                  aria-current={isLast ? 'page' : undefined}
                  className={cn(
                    'whitespace-nowrap',
                    isLast
                      ? 'font-medium text-[var(--ff-color-foreground)]'
                      : 'text-[var(--ff-color-muted-foreground)]',
                  )}
                >
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export type HeaderActionProps = ButtonProps;

export function HeaderAction({
  variant = 'outline',
  size = 'sm',
  ...rest
}: HeaderActionProps) {
  return <Button variant={variant} size={size} {...rest} />;
}

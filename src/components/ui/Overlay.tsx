import { ChevronDown, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button } from './Button.tsx';
import { cn } from './cn.ts';
import { Typography } from './Typography.tsx';

export interface ModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  readonly size?: 'sm' | 'md' | 'lg';
}

const MODAL_WIDTHS: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'max-w-md',
  md: 'max-w-xl',
  lg: 'max-w-3xl',
};

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: ModalProps) {
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#17191E]/45 p-6"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        className={cn(
          'w-full rounded-[var(--ff-radius-lg)] border border-[var(--ff-color-border)] bg-[var(--ff-color-surface)] text-[var(--ff-color-foreground)]',
          MODAL_WIDTHS[size],
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[var(--ff-color-border)] px-6 py-4">
          <div className="space-y-1">
            <Typography id={titleId} variant="h2">
              {title}
            </Typography>
            {description ? (
              <Typography id={descId} variant="body-sm" muted>
                {description}
              </Typography>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${title}`}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--ff-radius-sm)] text-[var(--ff-color-muted-foreground)] hover:bg-[var(--ff-color-muted)] hover:text-[var(--ff-color-foreground)] cursor-pointer"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="px-6 py-5">{children}</div>

        {footer ? (
          <div className="flex items-center justify-end gap-3 border-t border-[var(--ff-color-border)] bg-[var(--ff-color-surface-elevated)] px-6 py-4 rounded-b-[var(--ff-radius-lg)]">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export interface ConfirmationDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
  readonly title: string;
  readonly description: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly tone?: 'default' | 'destructive';
  readonly loading?: boolean;
}

export function ConfirmationDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  loading = false,
}: ConfirmationDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === 'destructive' ? 'destructive' : 'primary'}
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <Typography variant="body-sm" muted>
        Review this action before continuing.
      </Typography>
    </Modal>
  );
}

export interface DropdownOption {
  readonly id: string;
  readonly label: string;
  readonly icon?: ReactNode;
  readonly destructive?: boolean;
  readonly disabled?: boolean;
}

export interface DropdownProps {
  readonly label: string;
  readonly items: readonly DropdownOption[];
  readonly onSelect: (id: string) => void;
  readonly align?: 'left' | 'right';
}

export function Dropdown({
  label,
  items,
  onSelect,
  align = 'left',
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    window.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative inline-block">
      <Button
        variant="outline"
        size="md"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((prev) => !prev)}
        rightIcon={<ChevronDown className="h-4 w-4" aria-hidden="true" />}
      >
        {label}
      </Button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          className={cn(
            'absolute z-40 mt-2 min-w-[200px] rounded-[var(--ff-radius-md)] border border-[var(--ff-color-border)] bg-[var(--ff-color-surface)] p-1.5',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                onSelect(item.id);
                setOpen(false);
              }}
              className={cn(
                'flex w-full items-center gap-2 rounded-[var(--ff-radius-sm)] px-3 py-2 text-left text-[13px] font-medium transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-45',
                item.destructive
                  ? 'text-[var(--ff-color-destructive)] hover:bg-[var(--ff-color-destructive-subtle)]'
                  : 'text-[var(--ff-color-foreground)] hover:bg-[var(--ff-color-muted)]',
              )}
            >
              {item.icon ? (
                <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">
                  {item.icon}
                </span>
              ) : null}
              <span className="truncate">{item.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

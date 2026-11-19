import { AlertCircle, Check, CheckCircle2, ChevronDown, Search, X } from 'lucide-react';
import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from './cn.ts';

interface FieldChromeProps {
  readonly id: string;
  readonly label?: string;
  readonly hint?: string;
  readonly error?: string;
  readonly success?: string;
  readonly children: ReactNode;
}

function FieldChrome({
  id,
  label,
  hint,
  error,
  success,
  children,
}: FieldChromeProps) {
  const messageId = `${id}-message`;

  return (
    <div className="flex flex-col gap-1.5">
      {label ? (
        <label
          htmlFor={id}
          className="text-[length:var(--ff-text-label-size)] font-medium leading-[var(--ff-text-label-line)] text-[var(--ff-color-foreground)]"
        >
          {label}
        </label>
      ) : null}
      {children}
      {error ? (
        <p
          id={messageId}
          role="alert"
          className="flex items-center gap-1.5 text-[length:var(--ff-text-caption-size)] font-medium text-[var(--ff-color-destructive)]"
        >
          <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : success ? (
        <p
          id={messageId}
          className="flex items-center gap-1.5 text-[length:var(--ff-text-caption-size)] font-medium text-[var(--ff-color-success)]"
        >
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{success}</span>
        </p>
      ) : hint ? (
        <p
          id={messageId}
          className="text-[length:var(--ff-text-caption-size)] text-[var(--ff-color-muted-foreground)]"
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function inputBorderClasses(error?: string, success?: string): string {
  if (error) {
    return 'border-[var(--ff-color-destructive)] focus:border-[var(--ff-color-destructive)]';
  }
  if (success) {
    return 'border-[var(--ff-color-success)] focus:border-[var(--ff-color-success)]';
  }
  return 'border-[var(--ff-color-input)] hover:border-[var(--ff-color-muted-foreground)] focus:border-[var(--ff-color-primary)]';
}

const BASE_CONTROL_CLASSES =
  'w-full rounded-[var(--ff-radius-md)] border bg-[var(--ff-color-surface)] text-[14px] text-[var(--ff-color-foreground)] placeholder:text-[var(--ff-color-muted-foreground)] transition-colors duration-150 disabled:cursor-not-allowed disabled:bg-[var(--ff-color-muted)] disabled:opacity-60';

export interface TextInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  readonly label?: string;
  readonly hint?: string;
  readonly error?: string;
  readonly success?: string;
}

export function TextInput({
  id: providedId,
  label,
  hint,
  error,
  success,
  className,
  ...rest
}: TextInputProps) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  const hasMessage = Boolean(error || success || hint);

  return (
    <FieldChrome id={id} label={label} hint={hint} error={error} success={success}>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={hasMessage ? `${id}-message` : undefined}
        className={cn(
          BASE_CONTROL_CLASSES,
          'h-10 px-3',
          inputBorderClasses(error, success),
          className,
        )}
        {...rest}
      />
    </FieldChrome>
  );
}

export interface SearchInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  readonly label?: string;
  readonly hint?: string;
  readonly error?: string;
  readonly onClear?: () => void;
}

export function SearchInput({
  id: providedId,
  label,
  hint,
  error,
  value,
  onClear,
  className,
  ...rest
}: SearchInputProps) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  const hasValue = typeof value === 'string' && value.length > 0;

  return (
    <FieldChrome id={id} label={label} hint={hint} error={error}>
      <div className="relative flex items-center">
        <Search
          className="pointer-events-none absolute left-3 h-4 w-4 text-[var(--ff-color-muted-foreground)]"
          aria-hidden="true"
        />
        <input
          id={id}
          type="search"
          value={value}
          aria-invalid={error ? true : undefined}
          className={cn(
            BASE_CONTROL_CLASSES,
            'h-10 pl-9 pr-9 [&::-webkit-search-cancel-button]:appearance-none',
            inputBorderClasses(error),
            className,
          )}
          {...rest}
        />
        {hasValue && onClear ? (
          <button
            type="button"
            onClick={onClear}
            aria-label="Clear search"
            className="absolute right-2 flex h-6 w-6 items-center justify-center rounded-[var(--ff-radius-sm)] text-[var(--ff-color-muted-foreground)] hover:bg-[var(--ff-color-muted)] hover:text-[var(--ff-color-foreground)] cursor-pointer"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </FieldChrome>
  );
}

export interface TextareaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  readonly label?: string;
  readonly hint?: string;
  readonly error?: string;
  readonly success?: string;
}

export function Textarea({
  id: providedId,
  label,
  hint,
  error,
  success,
  rows = 4,
  className,
  ...rest
}: TextareaProps) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  const hasMessage = Boolean(error || success || hint);

  return (
    <FieldChrome id={id} label={label} hint={hint} error={error} success={success}>
      <textarea
        id={id}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={hasMessage ? `${id}-message` : undefined}
        className={cn(
          BASE_CONTROL_CLASSES,
          'min-h-[96px] px-3 py-2.5 resize-y',
          inputBorderClasses(error, success),
          className,
        )}
        {...rest}
      />
    </FieldChrome>
  );
}

export interface SelectOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  readonly label?: string;
  readonly hint?: string;
  readonly error?: string;
  readonly options: readonly SelectOption[];
}

export function Select({
  id: providedId,
  label,
  hint,
  error,
  options,
  className,
  ...rest
}: SelectProps) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  const hasMessage = Boolean(error || hint);

  return (
    <FieldChrome id={id} label={label} hint={hint} error={error}>
      <div className="relative">
        <select
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={hasMessage ? `${id}-message` : undefined}
          className={cn(
            BASE_CONTROL_CLASSES,
            'h-10 appearance-none pl-3 pr-9 cursor-pointer',
            inputBorderClasses(error),
            className,
          )}
          {...rest}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value} disabled={opt.disabled}>
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ff-color-muted-foreground)]"
          aria-hidden="true"
        />
      </div>
    </FieldChrome>
  );
}

export interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  readonly label: string;
  readonly description?: string;
}

export function Checkbox({
  id: providedId,
  label,
  description,
  checked,
  disabled,
  className,
  ...rest
}: CheckboxProps) {
  const generatedId = useId();
  const id = providedId ?? generatedId;

  return (
    <label
      htmlFor={id}
      className={cn(
        'inline-flex items-start gap-2.5 select-none',
        disabled ? 'cursor-not-allowed opacity-55' : 'cursor-pointer',
        className,
      )}
    >
      <span className="relative mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          className="peer h-4 w-4 appearance-none rounded-[var(--ff-radius-sm)] border border-[var(--ff-color-input)] bg-[var(--ff-color-surface)] transition-colors duration-150 checked:border-[var(--ff-color-primary)] checked:bg-[var(--ff-color-primary)] hover:border-[var(--ff-color-foreground)] disabled:cursor-not-allowed"
          {...rest}
        />
        <Check
          className="pointer-events-none absolute h-3 w-3 text-[var(--ff-color-primary-foreground)] opacity-0 transition-opacity duration-150 peer-checked:opacity-100"
          strokeWidth={2.5}
          aria-hidden="true"
        />
      </span>
      <span className="flex flex-col">
        <span className="text-[14px] font-medium leading-5 text-[var(--ff-color-foreground)]">
          {label}
        </span>
        {description ? (
          <span className="text-[12px] leading-4 text-[var(--ff-color-muted-foreground)]">
            {description}
          </span>
        ) : null}
      </span>
    </label>
  );
}

export interface SwitchProps {
  readonly id?: string;
  readonly label: string;
  readonly description?: string;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
}

export function Switch({
  id: providedId,
  label,
  description,
  checked,
  disabled = false,
  onCheckedChange,
}: SwitchProps) {
  const generatedId = useId();
  const id = providedId ?? generatedId;

  return (
    <div className="flex items-center justify-between gap-4">
      <label
        htmlFor={id}
        className={cn(
          'flex flex-col select-none',
          disabled ? 'cursor-not-allowed opacity-55' : 'cursor-pointer',
        )}
      >
        <span className="text-[14px] font-medium leading-5 text-[var(--ff-color-foreground)]">
          {label}
        </span>
        {description ? (
          <span className="text-[12px] leading-4 text-[var(--ff-color-muted-foreground)]">
            {description}
          </span>
        ) : null}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-150 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50',
          checked
            ? 'border-[var(--ff-color-primary)] bg-[var(--ff-color-primary)]'
            : 'border-[var(--ff-color-input)] bg-[var(--ff-color-muted)]',
        )}
      >
        <span
          className={cn(
            'pointer-events-none block h-4 w-4 rounded-full bg-[var(--ff-color-surface)] transition-transform duration-150',
            checked ? 'translate-x-5' : 'translate-x-1',
          )}
        />
      </button>
    </div>
  );
}

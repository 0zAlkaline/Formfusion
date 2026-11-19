import type { ElementType, HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn.ts';

export type TypographyVariant =
  | 'display-xl'
  | 'display-lg'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'body-lg'
  | 'body'
  | 'body-sm'
  | 'label'
  | 'caption';

const VARIANT_CLASSES: Record<TypographyVariant, string> = {
  'display-xl':
    'font-[family-name:var(--ff-font-display)] text-[length:var(--ff-text-display-xl-size)] leading-[var(--ff-text-display-xl-line)] tracking-[var(--ff-text-display-xl-track)] font-bold [text-wrap:balance]',
  'display-lg':
    'font-[family-name:var(--ff-font-display)] text-[length:var(--ff-text-display-lg-size)] leading-[var(--ff-text-display-lg-line)] tracking-[var(--ff-text-display-lg-track)] font-bold [text-wrap:balance]',
  h1: 'font-[family-name:var(--ff-font-display)] text-[length:var(--ff-text-h1-size)] leading-[var(--ff-text-h1-line)] tracking-[var(--ff-text-h1-track)] font-semibold [text-wrap:balance]',
  h2: 'font-[family-name:var(--ff-font-display)] text-[length:var(--ff-text-h2-size)] leading-[var(--ff-text-h2-line)] tracking-[var(--ff-text-h2-track)] font-semibold',
  h3: 'font-[family-name:var(--ff-font-display)] text-[length:var(--ff-text-h3-size)] leading-[var(--ff-text-h3-line)] tracking-[var(--ff-text-h3-track)] font-semibold',
  'body-lg':
    'font-[family-name:var(--ff-font-body)] text-[length:var(--ff-text-body-lg-size)] leading-[var(--ff-text-body-lg-line)] font-normal',
  body: 'font-[family-name:var(--ff-font-body)] text-[length:var(--ff-text-body-size)] leading-[var(--ff-text-body-line)] font-normal',
  'body-sm':
    'font-[family-name:var(--ff-font-body)] text-[length:var(--ff-text-body-sm-size)] leading-[var(--ff-text-body-sm-line)] font-normal',
  label:
    'font-[family-name:var(--ff-font-body)] text-[length:var(--ff-text-label-size)] leading-[var(--ff-text-label-line)] font-medium tracking-[0.005em]',
  caption:
    'font-[family-name:var(--ff-font-body)] text-[length:var(--ff-text-caption-size)] leading-[var(--ff-text-caption-line)] font-medium tracking-[0.01em]',
};

const DEFAULT_ELEMENT: Record<TypographyVariant, ElementType> = {
  'display-xl': 'h1',
  'display-lg': 'h1',
  h1: 'h1',
  h2: 'h2',
  h3: 'h3',
  'body-lg': 'p',
  body: 'p',
  'body-sm': 'p',
  label: 'span',
  caption: 'span',
};

export interface TypographyProps extends HTMLAttributes<HTMLElement> {
  readonly variant?: TypographyVariant;
  readonly as?: ElementType;
  readonly muted?: boolean;
  readonly children: ReactNode;
}

export function Typography({
  variant = 'body',
  as,
  muted = false,
  className,
  children,
  ...rest
}: TypographyProps) {
  const Component = as ?? DEFAULT_ELEMENT[variant];

  return (
    <Component
      className={cn(
        VARIANT_CLASSES[variant],
        muted
          ? 'text-[var(--ff-color-muted-foreground)]'
          : 'text-[var(--ff-color-foreground)]',
        className,
      )}
      {...rest}
    >
      {children}
    </Component>
  );
}

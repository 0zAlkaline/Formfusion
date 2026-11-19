import type { ReactNode } from 'react';
import { cn } from '../ui/cn.ts';

export type PageContainerWidth = 'standard' | 'wide' | 'full';

const CONTAINER_WIDTH_CLASSES: Record<PageContainerWidth, string> = {
  standard: 'max-w-[1200px]',
  wide: 'max-w-[var(--ff-layout-container-max)]',
  full: 'max-w-none',
};

export interface PageContainerProps {
  readonly maxWidth?: PageContainerWidth;
  readonly className?: string;
  readonly children: ReactNode;
}

export function PageContainer({
  maxWidth = 'wide',
  className,
  children,
}: PageContainerProps) {
  return (
    <div
      className={cn(
        'mx-auto w-full space-y-8 px-6 py-8 lg:px-8',
        CONTAINER_WIDTH_CLASSES[maxWidth],
        className,
      )}
    >
      {children}
    </div>
  );
}

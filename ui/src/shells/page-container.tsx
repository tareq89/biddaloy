/**
 * D15: the one width wrapper for a page body. Width only, no padding — the
 * page gutter stays on `<main>`. Final body; filled in by 31.2.5.
 */
import type * as React from 'react';

import { cn } from '../primitives/lib/utils';

export interface PageContainerProps {
  size?: 'wide' | 'narrow';
  children: React.ReactNode;
}

export function PageContainer({ size = 'wide', children }: PageContainerProps) {
  return (
    <div
      data-slot="page-container"
      className={cn(
        'mx-auto w-full space-y-6',
        size === 'narrow' ? 'max-w-3xl' : 'max-w-screen-xl',
      )}
    >
      {children}
    </div>
  );
}

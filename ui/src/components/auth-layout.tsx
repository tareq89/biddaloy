/**
 * D34, C22: the pre-authentication chrome (moved from client-admin's
 * `-auth-screen.tsx`, minus ThemeToggle). Stub — logo, product name and the
 * card are filled in by 31.2.12.
 */
import type * as React from 'react';

import { useDensity } from '../hooks/use-density';
import { RegionConfigProvider } from '../i18n';
import { cn } from '../primitives/lib/utils';

import { LocaleSwitcher } from './locale-switcher';

export interface AuthLayoutProps {
  children: React.ReactNode;
  /** `'wide'` = `max-w-2xl` card, only for the long public admission form (admission_slug). */
  size?: 'default' | 'wide';
}

export function AuthLayout({ children, size = 'default' }: AuthLayoutProps) {
  // Comfortable density: nobody is identified yet, so the accessible 44 px target is the safe
  // default. Set on `document.documentElement` so the portalled LocaleSwitcher inherits it.
  useDensity('comfortable');

  return (
    // No `value`: no active tenant before sign-in, so the provider's locale default applies.
    <RegionConfigProvider>
      <div className="flex min-h-screen flex-col bg-muted/20">
        <div className="flex justify-end p-4">
          <LocaleSwitcher />
        </div>
        <div className="flex flex-1 items-center justify-center p-8">
          <div className={cn('w-full', size === 'wide' ? 'max-w-2xl' : 'max-w-md')}>{children}</div>
        </div>
      </div>
    </RegionConfigProvider>
  );
}

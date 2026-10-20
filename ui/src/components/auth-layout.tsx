/**
 * D34, C22: the one guest-page frame — language switcher top right, logo + product name, one
 * centred card. The sign-in / OTP / set-password forms read `useInsideAuthLayout()` and drop
 * their own logo and card when they sit inside it. No ThemeToggle: guest pages follow the
 * system / stored theme.
 */
import * as React from 'react';

import { useDensity } from '../hooks/use-density';
import { RegionConfigProvider } from '../i18n';
import { cn } from '../primitives/lib/utils';

import { Wordmark } from './brand-mark';
import { LocaleSwitcher } from './locale-switcher';

export interface AuthLayoutProps {
  children: React.ReactNode;
  /** `'wide'` = `max-w-2xl` card, only for the long public admission form (admission_slug). */
  size?: 'default' | 'wide';
  /** Pad the language-switcher row so a `DemoRibbon` in the corner covers nothing. */
  reserveCorner?: boolean;
}

const AuthLayoutContext = React.createContext(false);

/** True inside `<AuthLayout>`: the guest forms then skip their own logo and card. */
export function useInsideAuthLayout(): boolean {
  return React.useContext(AuthLayoutContext);
}

export function AuthLayout({ children, size = 'default', reserveCorner }: AuthLayoutProps) {
  // Comfortable density: nobody is identified yet, so the accessible 44 px target is the safe
  // default. Set on `document.documentElement` so the portalled LocaleSwitcher inherits it.
  useDensity('comfortable');

  return (
    // No `value`: no active tenant before sign-in, so the provider's locale default applies.
    <RegionConfigProvider>
      <AuthLayoutContext.Provider value>
        <div className="flex min-h-dvh flex-col bg-background">
          <div
            className={cn(
              'flex justify-end p-4 print:hidden',
              // physical on purpose: the DemoRibbon is pinned top-right in RTL too
              // eslint-disable-next-line logical-properties/no-physical-direction-classes
              reserveCorner && 'pr-16 md:pr-24',
            )}
          >
            <LocaleSwitcher trigger="labelled" />
          </div>
          {/* No `id`: guest pages have no AppShell, and route focus falls back to the form's <h1>. */}
          <main className="flex flex-1 items-start justify-center px-4 pt-4 pb-16 md:items-center md:pt-0">
            <div className={cn('w-full', size === 'wide' ? 'max-w-2xl' : 'max-w-md')}>
              <div className="mb-6 flex flex-col items-center gap-2 print:hidden">
                <Wordmark size="md" />
              </div>
              <section className="rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5 print:border-0 print:p-0 print:shadow-none">
                {children}
              </section>
            </div>
          </main>
        </div>
      </AuthLayoutContext.Provider>
    </RegionConfigProvider>
  );
}

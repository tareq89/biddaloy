import { LocaleSwitcher, ThemeToggle } from '@biddaloy/ui/components';
import { useDensity } from '@biddaloy/ui/hooks';
import { RegionConfigProvider } from '@biddaloy/ui/i18n';
import type { ReactNode } from 'react';

/**
 * The pre-authentication chrome shared by every public auth surface —
 * `/login` and, since 12.2, `/activate`. Pulled out of `login.tsx` verbatim
 * (a pure move, see that route's own comment) so `activate.tsx` doesn't
 * have to duplicate the density/region/header wiring.
 */
export function AuthScreen({ children }: { children: ReactNode }) {
  // [8.13.8] Comfortable density (contract section 6). Auth screens sit with
  // `/portal` rather than with the staff routes because they are
  // PRE-authentication: at this point nobody knows whether the visitor is a
  // guardian on a 360 px phone or an administrator on a desktop, so the
  // accessible 44 px target is the safe default for the unknown user.
  //
  // Set on `document.documentElement`, not on the wrapper below, so the
  // portalled `LocaleSwitcher` menu inherits it too — see `useDensity`.
  useDensity('comfortable');

  return (
    // No `value` override: `useTenantRegionConfig()` needs an active
    // tenant, which doesn't exist yet at the point a visitor is signing
    // in — `RegionConfigProvider` already falls back to
    // `LOCALE_REGION_DEFAULTS[locale]` with no `value` passed, which is
    // exactly the right default here.
    <RegionConfigProvider>
      <div className="flex min-h-screen flex-col bg-muted/20">
        <div className="flex justify-end gap-2 p-4">
          <ThemeToggle />
          <LocaleSwitcher />
        </div>
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </div>
    </RegionConfigProvider>
  );
}

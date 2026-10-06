import { RouteErrorFallback } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import type { ErrorComponentProps } from '@tanstack/react-router';

import { reloadForUpdate } from './pwa/register';

/**
 * The router's `defaultErrorComponent` (`main.tsx`). In its own module so a
 * test can mount it over the real route tree; `main.tsx` renders on import.
 *
 * [8.12.2]: the boundary's "this page is from an older version" fork
 * reloads through the service-worker-aware `reloadForUpdate` (it lets a
 * waiting worker activate first) instead of `ui`'s app-agnostic plain
 * `location.reload()` default. A named component rather than an inline
 * arrow so the component identity is stable across renders.
 */
export function RouteErrorFallbackWithUpdate(props: ErrorComponentProps) {
  // [8.12.6]: the copy is passed translated. `@biddaloy/ui` stays
  // translation-agnostic and defaults its strings to English, which meant
  // this Bangla-default app rendered "You're offline" in English on the
  // one screen a user sees precisely when nothing else is working.
  //
  // [8.14.5]: `useTranslation('common')`, not the bare `useTranslation()`
  // this used to be — behaviourally identical (`common` is `i18n.ts`'s own
  // `defaultNS`), but `check-i18n-keys.mjs` resolves a file's default
  // namespace from the *first* `useTranslation(...)` call with a quoted
  // string argument; a bare call doesn't match that pattern at all.
  const { t } = useTranslation('common');
  return (
    <RouteErrorFallback
      {...props}
      onReloadForUpdate={reloadForUpdate}
      offlineTitle={t('offline.pageTitle')}
      offlineMessage={t('offline.pageExplanation')}
      updateTitle={t('update.pageTitle')}
      updateMessage={t('update.pageExplanation')}
      updateRetryLabel={t('update.reload')}
      suspendedTitle={t('suspended.pageTitle')}
      suspendedMessage={t('suspended.pageExplanation')}
      retryLabel={t('offline.retry')}
      // [13.5] Build-time, not the onboarding status's `support_url`: once the
      // trial has ended every school-scoped request 403s, so a status fetched
      // now would fail too, and a cold reload has nothing cached.
      supportUrl={import.meta.env.VITE_SUPPORT_URL ?? null}
    />
  );
}

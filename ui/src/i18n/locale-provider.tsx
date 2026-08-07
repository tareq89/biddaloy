import type { i18n as I18nInstance } from 'i18next';
import { Suspense, useEffect, type ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';

import { i18n as defaultI18n } from './i18n';
import { LOCALE_DIR } from './locale-storage';
import { useLocale } from './use-locale';

export interface I18nProviderProps {
  children: ReactNode;
  /** Shown while the active locale's namespace bundle is still loading —
   * see `i18n.ts`'s `react: { useSuspense: true }`. Defaults to `null`
   * (render nothing) rather than a spinner: this boundary sits at the top
   * of the tree and fires on first paint for every visit, so a default
   * that flashed UI of its own would be exactly the "flash before the
   * real thing" this exists to prevent. Pass a real fallback for a route
   * where blank-then-content would look broken. */
  fallback?: ReactNode;
  /** Overrides the shared singleton — for tests that need an isolated
   * instance (their own `createI18nInstance()`) rather than one whose
   * namespace cache carries state across every other test importing the
   * same singleton. The app itself never passes this. */
  i18n?: I18nInstance;
}

/** Keeps `<html lang>`/`<html dir>` in step with the active locale —
 * `[8.7.6]`'s "switching updates `<html lang>` immediately" requirement.
 * Rendered once, inside the tree `useLocale()` can already read from
 * (`I18nProvider`'s own `I18nextProvider`), rather than asking every app
 * shell to wire this itself. A plain component, not a side effect of
 * `useLocale()` — `useLocale()` can be called from more than one place in
 * a tree, and this must run exactly once regardless of how many call
 * sites there are. */
function DocumentLocaleSync() {
  const { locale } = useLocale();

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = LOCALE_DIR[locale];
  }, [locale]);

  return null;
}

/** The provider `renderWithProviders` and every app shell wrap children
 * in — supplies the configured i18next instance via context, the
 * Suspense boundary its lazy namespace loading depends on, and keeps the
 * document's `lang`/`dir` in sync with the active locale. Nest a second,
 * narrower `<Suspense>` inside a route that wants its own fallback instead
 * of falling through to this top-level one. */
export function I18nProvider({ children, fallback = null, i18n = defaultI18n }: I18nProviderProps) {
  return (
    <I18nextProvider i18n={i18n}>
      <Suspense fallback={fallback}>
        <DocumentLocaleSync />
        {children}
      </Suspense>
    </I18nextProvider>
  );
}

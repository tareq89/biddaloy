import type { i18n as I18nInstance } from 'i18next';
import { Suspense, type ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';

import { i18n as defaultI18n } from './i18n';

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

/** The provider `renderWithProviders` and every app shell wrap children
 * in — supplies the configured i18next instance via context and the
 * Suspense boundary its lazy namespace loading depends on. Nest a second,
 * narrower `<Suspense>` inside a route that wants its own fallback instead
 * of falling through to this top-level one. */
export function I18nProvider({ children, fallback = null, i18n = defaultI18n }: I18nProviderProps) {
  return (
    <I18nextProvider i18n={i18n}>
      <Suspense fallback={fallback}>{children}</Suspense>
    </I18nextProvider>
  );
}

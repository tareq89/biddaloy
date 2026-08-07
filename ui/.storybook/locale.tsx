/**
 * A minimal locale context for stories only — not part of the package's
 * public surface. Real i18next wiring lands in [8.7.1]; until then this
 * exists so the toolbar switcher below has something to demonstrate: a
 * story can read `useStorybookLocale()` and render locale-appropriate
 * sample copy, which is enough to prove Bangla's longer strings don't
 * break layout before any component has real translations to check
 * against. Delete this file once [8.7.1]'s real `LocaleProvider` exists —
 * `preview.tsx`'s decorator should use that instead.
 */
import { createContext, useContext, type ReactNode } from 'react';

export const STORYBOOK_LOCALES = {
  en: { label: 'English', dir: 'ltr' as const },
  bn: { label: 'বাংলা', dir: 'ltr' as const },
};

export type StorybookLocale = keyof typeof STORYBOOK_LOCALES;

const LocaleContext = createContext<StorybookLocale>('en');

export function useStorybookLocale(): StorybookLocale {
  return useContext(LocaleContext);
}

export function StorybookLocaleProvider({
  locale,
  children,
}: {
  locale: StorybookLocale;
  children: ReactNode;
}) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

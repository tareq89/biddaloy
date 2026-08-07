import i18next, { type i18n as I18nInstance } from 'i18next';
import resourcesToBackend from 'i18next-resources-to-backend';
import { initReactI18next } from 'react-i18next';

import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  getPersistedLocale,
  persistLocale,
} from './locale-storage';

/** Namespace always loaded up front — generic strings (actions, statuses)
 * every screen needs before it can render anything else. Everything past
 * this is a feature module's own namespace (`students`, and more as
 * screens grow real copy), loaded on demand the first time a component
 * calls `useTranslation('that-namespace')`. */
export const COMMON_NAMESPACE = 'common';

export function createI18nInstance(): I18nInstance {
  const instance = i18next.createInstance();

  // Built fresh per instance rather than hoisted to module scope: the
  // plugin object returned by `resourcesToBackend` binds itself to
  // whichever i18next instance's `services` it was last `.init()`-ed
  // against. A single shared `backend` const used by two instances (the
  // exported singleton below and, say, a test's own
  // `createI18nInstance()`) would have the second instance's init silently
  // repoint the first one's backend at the wrong `services`, breaking its
  // in-flight namespace loads — reproduced while writing this module's
  // own tests, where the singleton's creation was exactly that second
  // instance.
  //
  // Each dynamic `import()` is still a distinct, Vite-analyzable module
  // specifier, so the bundler code-splits one chunk per locale/namespace
  // pair — a feature module's translations don't ship in the initial
  // bundle just because the module itself is loaded. This is what keeps
  // namespaces "lazy-loaded per route" true rather than aspirational: a
  // route that never touches the `students` namespace never fetches its
  // JSON.
  const backend = resourcesToBackend(
    (language: string, namespace: string) => import(`./locales/${language}/${namespace}.json`),
  );

  // Not awaited — `react: { useSuspense: true }` below is what lets a
  // consumer render before this resolves: `useTranslation()` suspends
  // until init (and whatever namespace it requests) is ready, so nothing
  // needs to block on this promise here.
  void instance
    .use(backend)
    .use(initReactI18next)
    .init({
      lng: getPersistedLocale(),
      fallbackLng: DEFAULT_LOCALE,
      supportedLngs: SUPPORTED_LOCALES,
      ns: [COMMON_NAMESPACE],
      defaultNS: COMMON_NAMESPACE,
      // React already escapes interpolated values when rendering JSX;
      // i18next's own escaping on top of that double-encodes entities.
      interpolation: { escapeValue: false },
      // Lets a component reading a namespace that hasn't loaded yet
      // suspend instead of rendering raw keys — see I18nProvider, which
      // supplies the Suspense boundary this relies on.
      react: { useSuspense: true },
    });

  instance.on('languageChanged', (locale) => {
    if ((SUPPORTED_LOCALES as readonly string[]).includes(locale)) {
      persistLocale(locale as (typeof SUPPORTED_LOCALES)[number]);
    }
  });

  return instance;
}

/** One instance per app — every SPA importing `@beton-boi/ui/i18n` shares
 * it, same as `apiClient` in `src/api`. Tests that need an isolated
 * instance (a fresh language, no cross-test leakage) should call
 * `createI18nInstance()` directly instead of importing this singleton. */
export const i18n = createI18nInstance();

/** Resolves once `instance`'s `init()` has fully settled — language
 * resolved, initial `ns` loaded. Nothing in the app itself needs this
 * (`I18nProvider`'s Suspense boundary is what production code relies on),
 * but a test asserting on `instance.language` or reading a resource
 * synchronously needs a real readiness signal: `loadNamespaces()`
 * resolving is **not** one — it can settle before `init()`'s own language
 * bookkeeping finishes, since the two run as independent, unordered
 * promise chains once `init()` is fired without being awaited. */
export function whenReady(instance: I18nInstance): Promise<void> {
  if (instance.isInitialized) return Promise.resolve();
  return new Promise((resolve) => {
    instance.on('initialized', () => resolve());
  });
}

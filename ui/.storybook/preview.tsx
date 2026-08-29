import type { Preview } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { setupWorker } from 'msw/browser';
import { mswLoader } from 'msw-storybook-addon/csf3';
import { useEffect } from 'react';

import { i18n, I18nProvider, type Locale } from '../src/i18n';
import { handlers } from '../src/test/msw/handlers';
import '../src/styles/globals.css';

// Storybook-only locale metadata (display label, text direction) — not
// part of i18next config itself, which knows locale codes but not how a
// toolbar should label them.
const LOCALE_META: Record<Locale, { label: string; dir: 'ltr' | 'rtl' }> = {
  en: { label: 'English', dir: 'ltr' },
  bn: { label: 'বাংলা', dir: 'ltr' },
};

// Storybook-only density metadata, the same shape as `LOCALE_META` above and
// for the same reason: the design contract (section 6) knows the two mode
// names, but not how a toolbar should label them.
//
// `compact` maps to `undefined` rather than to `data-density="compact"`,
// because compact is the default BY ABSENCE — no attribute means no
// `--control-h`, which means every size class resolves its own fallback.
// Rendering a literal `data-density="compact"` would be a Storybook-only
// state that no route ever produces, so a story could look right in the
// toolbar while the real staff shell behaved differently.
const DENSITY_META = {
  compact: { label: 'Compact (staff)', attribute: undefined },
  comfortable: { label: 'Comfortable (/portal, auth)', attribute: 'comfortable' },
} as const;

type Density = keyof typeof DENSITY_META;

// [8.13.12]: theme toolbar metadata, same shape as `LOCALE_META`/
// `DENSITY_META` above. Why this mutates `document.documentElement` instead
// of a wrapper `<div>`, and how it interacts with `dark-decorator.tsx`'s
// own mount-order caveat: docs/architecture/09-design-direction.md §3.4.3.
const THEME_META = {
  light: { label: 'Light' },
  dark: { label: 'Dark' },
} as const;

type ThemeGlobal = keyof typeof THEME_META;

// CAVEAT, deliberate: the toolbar applies the attribute to the story WRAPPER,
// while the real app applies it to `document.documentElement` (see
// `hooks/use-density.ts` — Radix portals dialogs and menus into
// `document.body`, where a wrapper cannot reach them). So a story that opens
// a Dialog, Select, DropdownMenu, Popover or Tooltip will show that content
// at COMPACT sizes no matter what the toolbar says.
//
// The wrapper is kept anyway because it is what makes per-subtree stories
// possible at all — `button.stories.tsx` renders both modes side by side in
// one canvas, and `sign-in-form.stories.tsx` is `autodocs`, where a
// document-level mutation would leak into every sibling story on the page
// (the same trap `dark-decorator.tsx` documents). Portalled density is
// verified in a real browser by `e2e/responsive/target-size.spec.ts`
// instead, which is where it can actually be measured.

// Registers the MSW Service Worker in the Storybook iframe. `public/` isn't
// set up in this package (it isn't an app with its own dev server), so the
// worker script is served from Storybook's own static dir — see
// `staticDirs` in `main.ts` — at the default `/mockServiceWorker.js` URL.
// Passed to `mswLoader` below: msw-storybook-addon 3.x dropped
// `initialize()` in favour of a caller-supplied setup function.
const startWorker = async () => {
  const worker = setupWorker();
  await worker.start({ quiet: true, onUnhandledRequest: 'bypass' });
  return worker;
};

// One QueryClient per Storybook session (not per story): stories mount and
// unmount as the user navigates, and a fresh client per story would drop
// cached data on every navigation, which is realistic for automated tests
// but not for a human clicking through the sidebar.
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    // Every story gets the shared handler library from `test/msw/handlers`
    // by default — the same "happy path" baseline the Vitest suite uses —
    // so a story author only needs `parameters.msw.handlers` to override
    // the specific endpoint their story cares about.
    msw: { handlers },
    a11y: {
      // Violations fail the story's a11y panel entry but not the Storybook
      // build itself — 'todo' logs to the panel and the test-runner without
      // hard-failing `build-storybook`, which is what CI (8.8.5) will run.
      // A future ticket can tighten this to 'error' once every story is
      // clean; today `Placeholder` is the only real component.
      test: 'todo',
    },
  },
  loaders: [mswLoader(startWorker)],
  globalTypes: {
    locale: {
      description: 'Locale for text-expansion and layout checks',
      defaultValue: 'en',
      toolbar: {
        title: 'Locale',
        icon: 'globe',
        items: Object.entries(LOCALE_META).map(([value, { label }]) => ({
          value,
          title: label,
        })),
        dynamicTitle: true,
      },
    },
    density: {
      description: 'Density mode — staff routes are compact, /portal is comfortable',
      defaultValue: 'compact',
      toolbar: {
        title: 'Density',
        icon: 'component',
        items: Object.entries(DENSITY_META).map(([value, { label }]) => ({
          value,
          title: label,
        })),
        dynamicTitle: true,
      },
    },
    // [8.13.12]: unlike `locale`/`density`, this does not drive
    // `useTheme()`/`localStorage` — it drives `document.documentElement`
    // directly (see the `THEME_META` comment above), the same lever the
    // real toggle uses but without persisting anything, so leaving a story
    // does not leave a `biddaloy:theme` value behind in the browser's
    // `localStorage` for whichever story runs next.
    theme: {
      description: 'Light/dark theme — every story renders under this',
      defaultValue: 'light',
      toolbar: {
        title: 'Theme',
        icon: 'sun',
        items: Object.entries(THEME_META).map(([value, { label }]) => ({
          value,
          title: label,
        })),
        dynamicTitle: true,
      },
    },
  },
  decorators: [
    (Story, context) => {
      const locale = context.globals.locale as Locale;
      const { dir } = LOCALE_META[locale] ?? LOCALE_META.en;
      const density = context.globals.density as Density;
      // A story that renders both densities side by side (see
      // `button.stories.tsx`'s `Density`) opts out of the toolbar global
      // with `parameters.density: 'both'`. Without this, the toolbar's
      // wrapper would sit ABOVE such a story's own columns, and the column
      // that demonstrates compact-by-absence would silently inherit
      // `--control-h` from the wrapper and stop being compact.
      const densityAttribute =
        context.parameters.density === 'both'
          ? undefined
          : (DENSITY_META[density] ?? DENSITY_META.compact).attribute;

      // Drives the real i18next instance, not a Storybook-only stand-in —
      // a story's `useTranslation()` calls resolve against whatever the
      // toolbar picked. `<html lang>`/`dir` reflection is `I18nProvider`'s
      // own job now ([8.7.6]'s `DocumentLocaleSync`), not duplicated here.
      useEffect(() => {
        void i18n.changeLanguage(locale);
      }, [locale]);

      // [8.13.12]: sets `document.documentElement.dataset.theme` directly —
      // there is no wrapper-div option for dark tokens, see `THEME_META`'s
      // own comment above. Deliberately bypasses `useTheme()`/
      // `theme-provider.tsx` entirely rather than driving them from the
      // toolbar: that module reads `localStorage`/`prefers-color-scheme` on
      // every render, which is real per-browser state a toolbar selection
      // should not be able to overwrite from underneath a viewer who has
      // never opened this Storybook build before.
      //
      // `parameters.theme === 'fixed'` is this global's escape hatch, same
      // shape and same reason as `density`'s own `parameters.density ===
      // 'both'` above. Why it's needed — the mount-order race with
      // `dark-decorator.tsx`'s own effect, and which one wins without it —
      // is docs/architecture/09-design-direction.md §3.4.3, not here.
      const theme = (context.globals.theme as ThemeGlobal) ?? 'light';
      const themeFixed = context.parameters.theme === 'fixed';
      useEffect(() => {
        if (themeFixed) return;
        if (theme === 'dark') {
          document.documentElement.dataset.theme = 'dark';
        } else {
          delete document.documentElement.dataset.theme;
        }
      }, [theme, themeFixed]);

      return (
        <QueryClientProvider client={queryClient}>
          <I18nProvider>
            <div dir={dir} lang={locale} data-density={densityAttribute}>
              <Story />
            </div>
          </I18nProvider>
        </QueryClientProvider>
      );
    },
  ],
};

export default preview;

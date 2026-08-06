import type { Preview } from '@storybook/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { initialize, mswLoader } from 'msw-storybook-addon';
import { useEffect } from 'react';

import { handlers } from '../src/test/msw/handlers';
import '../src/styles/globals.css';

import { STORYBOOK_LOCALES, StorybookLocaleProvider, type StorybookLocale } from './locale';

// Registers the MSW Service Worker in the Storybook iframe. `public/` isn't
// set up in this package (it isn't an app with its own dev server), so the
// worker script is served from Storybook's own static dir — see
// `staticDirs` in `main.ts` — via `msw-storybook-addon`'s default
// `serviceWorker.url`, which resolves relative to that.
initialize({ onUnhandledRequest: 'bypass' });

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
  loaders: [mswLoader],
  globalTypes: {
    locale: {
      description: 'Locale for text-expansion and layout checks',
      defaultValue: 'en',
      toolbar: {
        title: 'Locale',
        icon: 'globe',
        items: Object.entries(STORYBOOK_LOCALES).map(([value, { label }]) => ({
          value,
          title: label,
        })),
        dynamicTitle: true,
      },
    },
  },
  decorators: [
    (Story, context) => {
      const locale = context.globals.locale as StorybookLocale;
      const { dir } = STORYBOOK_LOCALES[locale] ?? STORYBOOK_LOCALES.en;

      // Reflects onto <html> too, not just the React tree, so browser/OS
      // chrome (scrollbars, form control rendering) and the a11y addon's
      // own DOM scan — which reads the real document, not just what a
      // component receives as props — see the same locale the story does.
      useEffect(() => {
        document.documentElement.lang = locale;
        document.documentElement.dir = dir;
      }, [locale, dir]);

      return (
        <QueryClientProvider client={queryClient}>
          <StorybookLocaleProvider locale={locale}>
            <div dir={dir} lang={locale}>
              <Story />
            </div>
          </StorybookLocaleProvider>
        </QueryClientProvider>
      );
    },
  ],
};

export default preview;

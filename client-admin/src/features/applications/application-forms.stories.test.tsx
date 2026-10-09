/**
 * [52.4.3] Smoke test: client-admin stories aren't in any Storybook build, so
 * render every story of the forms file once. Fails on a thrown error or a
 * missing i18n key. Stories with a `play` (ValidationError) are not run — only
 * the first render is checked.
 */
import { i18n, useTranslation } from '@biddaloy/ui/i18n';
import { renderWithProviders, server } from '@biddaloy/ui/test';
import { composeStories } from '@storybook/react-vite';
import { waitFor } from '@testing-library/react';
import type { RequestHandler } from 'msw';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import * as storyModule from './application-forms.stories';

const stories = composeStories(storyModule as never) as Record<
  string,
  React.ComponentType & { parameters?: { msw?: { handlers?: RequestHandler[] } } }
>;

/**
 * Renders `ui` and returns the keys it looked up that exist in no loaded resource.
 * i18next only emits `missingKey` with `saveMissing` on, so it is switched on for the
 * render, with a no-op `missingKeyHandler` (without one, the backend connector writes the
 * key into the store as its own value, and it would never look missing again). A lookup
 * made before its namespace finished loading also fires, so each hit is re-checked once
 * everything settled: only keys still missing then are reported.
 */
async function missingKeysOf(ui: React.ReactElement): Promise<string[]> {
  const hits: { lng: string; ns: string; key: string }[] = [];
  const onMissing = (lngs: readonly string[], ns: string, key: string) =>
    hits.push({ lng: lngs[0] ?? i18n.language, ns, key });
  const { saveMissing, missingKeyHandler } = i18n.options;
  i18n.options.saveMissing = true;
  i18n.options.missingKeyHandler = () => undefined;
  i18n.on('missingKey', onMissing);
  try {
    const { container, queryClient, localeReady } = renderWithProviders(ui);
    await localeReady;
    await waitFor(() => expect(container.childElementCount).toBeGreaterThan(0));
    await waitFor(() => expect(queryClient.isFetching()).toBe(0)); // lookups settled
    return hits
      .filter(({ lng, ns, key }) => !i18n.exists(key, { lng, ns }))
      .map(({ ns, key }) => `${ns}:${key}`);
  } finally {
    i18n.off('missingKey', onMissing);
    i18n.options.saveMissing = saveMissing ?? false;
    i18n.options.missingKeyHandler = missingKeyHandler ?? false;
  }
}

describe('application forms stories', () => {
  it('the missing-key check catches a key that does not exist', async () => {
    // The key comes in as a prop so `check:i18n`'s static scan doesn't flag this deliberate miss.
    function Broken({ k }: { k: string }) {
      const { t } = useTranslation('applicationForms');
      return <p>{t(k)}</p>;
    }
    expect(await missingKeysOf(<Broken k="fields.doesNotExist" />)).toContain(
      'applicationForms:fields.doesNotExist',
    );
  });

  it.each(Object.entries(stories))('%s renders with no missing i18n key', async (_name, Story) => {
    server.use(...(Story.parameters?.msw?.handlers ?? []));
    expect(await missingKeysOf(<Story />)).toEqual([]);
  });
});

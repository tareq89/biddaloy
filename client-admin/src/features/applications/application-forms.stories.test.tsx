/**
 * [52.4.3] Smoke test: client-admin stories aren't in any Storybook build, so
 * render every story of the forms file once. Fails on a thrown error or a
 * missing i18n key. Stories with a `play` (ValidationError) are not run — only
 * the first render is checked.
 */
import { i18n } from '@biddaloy/ui/i18n';
import { renderWithProviders, server } from '@biddaloy/ui/test';
import { composeStories } from '@storybook/react-vite';
import { waitFor } from '@testing-library/react';
import type { RequestHandler } from 'msw';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import * as storyModule from './application-forms.stories';

const stories = composeStories(storyModule as never) as Record<
  string,
  React.ComponentType & { parameters?: { msw?: { handlers?: RequestHandler[] } } }
>;

describe('application forms stories', () => {
  it.each(Object.entries(stories))('%s renders', async (_name, Story) => {
    const missing: unknown[] = [];
    const onMissing = (...args: unknown[]) => missing.push(args);
    i18n.on('missingKey', onMissing);
    const warn = vi.spyOn(console, 'warn');
    server.use(...(Story.parameters?.msw?.handlers ?? []));
    try {
      const { container } = renderWithProviders(<Story />);
      await waitFor(() => expect(container.childElementCount).toBeGreaterThan(0));
      await new Promise((r) => setTimeout(r, 50)); // let lookup queries settle
      const warned = warn.mock.calls.filter((c) => String(c[0]).includes('missingKey'));
      expect(warned).toEqual([]);
      expect(missing).toEqual([]);
    } finally {
      i18n.off('missingKey', onMissing);
      warn.mockRestore();
    }
  });
});

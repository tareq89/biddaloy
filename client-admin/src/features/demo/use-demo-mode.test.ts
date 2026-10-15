import { i18n } from '@biddaloy/ui/i18n';
import { renderHookWithProviders } from '@biddaloy/ui/test';
import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useDemoMode } from './use-demo-mode';

describe('useDemoMode', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reads the body of a non-demo 404, so the request finishes and the page can go idle', async () => {
    const notDemo = new Response(JSON.stringify({ statusCode: 404 }), { status: 404 });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(notDemo);

    const { result, queryClient } = renderHookWithProviders(() => useDemoMode());

    await waitFor(() => expect(queryClient.getQueryState(['demo-roles'])?.status).toBe('success'));
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(result.current.enabled).toBe(false);
    // An unread body leaves the fetch open in Chromium: Playwright's `networkidle` never settles.
    expect(notDemo.bodyUsed).toBe(true);
  });

  it('a normal school (enabled: false) is not a demo and never loads the demo translations', async () => {
    const body = JSON.stringify({ enabled: false, password: '', cards: [] });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status: 200 }));
    const load = vi.spyOn(i18n, 'loadNamespaces');

    const { result, queryClient } = renderHookWithProviders(() => useDemoMode());

    await waitFor(() => expect(queryClient.getQueryState(['demo-roles'])?.status).toBe('success'));
    expect(result.current.enabled).toBe(false);
    expect(load.mock.calls.flat(2)).not.toContain('demo');
  });

  it('the demo loads its translations before it reports enabled', async () => {
    const body = JSON.stringify({ enabled: true, password: 'p', cards: [] });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status: 200 }));

    const { result } = renderHookWithProviders(() => useDemoMode());

    // A demo-only child calling useTranslation('demo') right now must not suspend the shell.
    await waitFor(() => expect(result.current.enabled).toBe(true));
    expect(i18n.hasLoadedNamespace('demo')).toBe(true);
  });
});

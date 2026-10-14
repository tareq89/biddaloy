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
});

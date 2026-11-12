import '@biddaloy/ui/test';

import { cleanupTestState, renderHookWithProviders, server } from '@biddaloy/ui/test';
import { act, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { appEnterUrl, useLoginAs } from './use-login-as';

const input = {
  schoolId: '11111111-1111-4111-8111-111111111111',
  role: 'ADMIN' as never,
  targetUserId: '22222222-2222-4222-8222-222222222201',
  reason: 'Support request',
  viewOnly: false,
};

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupTestState();
});

describe('appEnterUrl', () => {
  it('puts the code in the fragment, never a query', () => {
    const url = appEnterUrl('a b', { protocol: 'https:', host: 'cockpit.example.test' });
    expect(url).toBe('https://app.example.test/support/enter#code=a%20b');
  });
});

describe('useLoginAs', () => {
  it('goes idle -> opened and sets the blank tab location', async () => {
    server.use(
      http.post('*/platform/impersonation', () =>
        HttpResponse.json({ id: 's1', status: 'ACTIVE', code: 'c1', expiresAt: '2030-01-01' }),
      ),
    );
    const tab = { opener: 'x', close: vi.fn(), location: { href: '' } };
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    const { result } = renderHookWithProviders(() => useLoginAs('allowed'));
    expect(result.current.state.kind).toBe('idle');
    act(() => result.current.submit(input));
    await waitFor(() => expect(result.current.state.kind).toBe('opened'));
    expect(tab.opener).toBeNull();
    expect(tab.location.href).toContain('#code=c1');
  });

  it('goes to waiting and closes the blank tab', async () => {
    server.use(
      http.post('*/platform/impersonation', () =>
        HttpResponse.json({ id: 'r1', status: 'REQUESTED' }),
      ),
    );
    const tab = { opener: 'x', close: vi.fn(), location: { href: '' } };
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    const { result } = renderHookWithProviders(() => useLoginAs('ask'));
    act(() => result.current.submit(input));
    await waitFor(() =>
      expect(result.current.state).toEqual({ kind: 'waiting', requestId: 'r1', blocked: false }),
    );
    expect(tab.close).toHaveBeenCalled();
    act(() => result.current.cancel());
    expect(result.current.state.kind).toBe('idle');
  });
});

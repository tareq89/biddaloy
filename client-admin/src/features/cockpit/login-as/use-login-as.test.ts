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
    await act(async () => {
      await result.current.cancel();
    });
    expect(result.current.state.kind).toBe('idle');
  });
});

const waitingFor = (status: string) => {
  server.use(
    http.post('*/platform/impersonation', async ({ request }) => {
      const body = (await request.json()) as { ticketId?: string };
      return body.ticketId
        ? HttpResponse.json({ id: 'r1', status: 'ACTIVE', code: 'c2', expiresAt: '2030-01-01' })
        : HttpResponse.json({ id: 'r1', status: 'REQUESTED' });
    }),
    http.get('*/platform/impersonation', () => HttpResponse.json([{ id: 'r1', status }])),
  );
};

describe('useLoginAs waiting', () => {
  it('moves to approved, then opens the visit with the ticket id', async () => {
    const bodies: { ticketId?: string }[] = [];
    waitingFor('APPROVED');
    server.use(
      http.post('*/platform/impersonation', async ({ request }) => {
        const body = (await request.json()) as { ticketId?: string };
        bodies.push(body);
        return body.ticketId
          ? HttpResponse.json({ id: 'r1', status: 'ACTIVE', code: 'c2', expiresAt: '2030-01-01' })
          : HttpResponse.json({ id: 'r1', status: 'REQUESTED' });
      }),
    );
    const tab = { opener: 'x', close: vi.fn(), location: { href: '' } };
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    const { result } = renderHookWithProviders(() => useLoginAs('ask'));
    act(() => result.current.submit(input));
    await waitFor(() => expect(result.current.outcome).toBe('approved'));
    act(() => result.current.openApproved());
    await waitFor(() => expect(result.current.state.kind).toBe('opened'));
    expect(bodies[1]!.ticketId).toBe('r1');
    expect(tab.location.href).toContain('#code=c2');
  });

  it('a denied request is over: Back needs no DELETE', async () => {
    waitingFor('DENIED');
    let deletes = 0;
    server.use(
      http.delete('*/platform/impersonation/:id', () => {
        deletes += 1;
        return new HttpResponse(null, { status: 404 });
      }),
    );
    vi.spyOn(window, 'open').mockReturnValue(null);
    const { result } = renderHookWithProviders(() => useLoginAs('ask'));
    act(() => result.current.submit(input));
    await waitFor(() => expect(result.current.outcome).toBe('over'));
    await act(async () => {
      await result.current.cancel();
    });
    expect(result.current.state.kind).toBe('idle');
    expect(deletes).toBe(0);
  });

  it('keeps the request and says so when Cancel fails, then lets Cancel retry', async () => {
    waitingFor('REQUESTED');
    let fail = true;
    server.use(
      http.delete('*/platform/impersonation/:id', () =>
        fail ? HttpResponse.json({}, { status: 500 }) : new HttpResponse(null, { status: 204 }),
      ),
    );
    vi.spyOn(window, 'open').mockReturnValue(null);
    const { result } = renderHookWithProviders(() => useLoginAs('ask'));
    act(() => result.current.submit(input));
    await waitFor(() => expect(result.current.state.kind).toBe('waiting'));
    let ended = true;
    await act(async () => {
      ended = await result.current.cancel();
    });
    expect(ended).toBe(false);
    expect(result.current.state).toMatchObject({
      kind: 'waiting',
      requestId: 'r1',
      cancelFailed: true,
    });
    fail = false;
    await act(async () => {
      ended = await result.current.cancel();
    });
    expect(ended).toBe(true);
    expect(result.current.state.kind).toBe('idle');
  });
});

describe('useLoginAs dismissed while starting', () => {
  it('closes the reserved tab, never navigates, and ends the session the late reply made', async () => {
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    let ended = '';
    server.use(
      http.post('*/platform/impersonation', async () => {
        await gate;
        return HttpResponse.json({
          id: 's9',
          status: 'ACTIVE',
          code: 'late',
          expiresAt: '2030-01-01',
        });
      }),
      http.delete('*/platform/impersonation/:id', ({ params }) => {
        ended = String(params.id);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const tab = { opener: 'x', close: vi.fn(), location: { href: '' } };
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    const { result } = renderHookWithProviders(() => useLoginAs('allowed'));
    act(() => result.current.submit(input));
    act(() => result.current.reset());
    expect(tab.close).toHaveBeenCalledTimes(1);
    release();
    await waitFor(() => expect(ended).toBe('s9'));
    expect(tab.location.href).toBe('');
    expect(open).toHaveBeenCalledTimes(1);
    expect(result.current.state.kind).toBe('idle');
  });
});

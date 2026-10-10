/**
 * [67.2.01] Attention hooks — params on the wire, invalidation after
 * hide/snooze, no invalidation after seen, shell-safe failure.
 */
import { AlertCategory } from '@biddaloy/shared';
import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { alertItemFactory, attentionSummaryFactory } from '../../test/factories';
import { server } from '../../test/msw/server';
import { renderHookWithProviders } from '../../test/render-hook-with-providers';
import { cleanupTestState } from '../../test/render-with-providers';

import {
  useHideAttentionItem,
  useMarkAttentionSeen,
  useSnoozeAttentionItem,
} from './use-attention-mutations';
import {
  useAttentionItems,
  useAttentionSummary,
  usePlatformAttentionHealth,
} from './use-attention-queries';

const TENANT = { tenantId: 'tenant-1' };

afterEach(async () => {
  await cleanupTestState();
});

function countSummary() {
  const state = { calls: 0, params: null as URLSearchParams | null };
  server.use(
    http.get('*/attention/summary', ({ request }) => {
      state.calls += 1;
      state.params = new URL(request.url).searchParams;
      return HttpResponse.json(attentionSummaryFactory());
    }),
  );
  return state;
}

describe('useAttentionSummary', () => {
  it('sends the active role and the UI locale', async () => {
    const seen = countSummary();
    const { result } = renderHookWithProviders(() => useAttentionSummary(), {
      role: 'TEACHER',
      tenantId: 'tenant-1',
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seen.params?.get('role')).toBe('TEACHER');
    expect(['bn', 'en']).toContain(seen.params?.get('locale'));
  });

  it('is disabled while no role is active', () => {
    const seen = countSummary();
    const { result } = renderHookWithProviders(() => useAttentionSummary(), TENANT);
    expect(result.current.fetchStatus).toBe('idle');
    expect(seen.calls).toBe(0);
  });

  it('keeps data undefined and isError true on a 500, without throwing', async () => {
    server.use(http.get('*/attention/summary', () => new HttpResponse(null, { status: 500 })));
    const { result } = renderHookWithProviders(() => useAttentionSummary(), {
      role: 'TEACHER',
      tenantId: 'tenant-1',
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});

describe('useAttentionItems', () => {
  it('sends every filter as a query param and returns the page', async () => {
    let params: URLSearchParams | null = null;
    const item = alertItemFactory({ recipientId: 'r1' });
    server.use(
      http.get('*/attention/items', ({ request }) => {
        params = new URL(request.url).searchParams;
        return HttpResponse.json({ items: [item], total: 1 });
      }),
    );
    const { result } = renderHookWithProviders(
      () =>
        useAttentionItems({
          tab: 'history',
          category: AlertCategory.ATTENDANCE,
          sectionId: 's1',
          studentId: 'st1',
          page: 2,
          pageSize: 20,
          locale: 'bn',
        }),
      TENANT,
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(Object.fromEntries(params ?? [])).toEqual({
      tab: 'history',
      category: 'ATTENDANCE',
      sectionId: 's1',
      studentId: 'st1',
      page: '2',
      pageSize: '20',
      locale: 'bn',
    });
    expect(result.current.data).toEqual({ items: [item], total: 1 });
  });
});

describe('mutations', () => {
  it('hide POSTs to the item and refetches the summary', async () => {
    const seen = countSummary();
    let hit = '';
    server.use(
      http.post('*/attention/items/:id/hide', ({ params }) => {
        hit = String(params.id);
        return HttpResponse.json(alertItemFactory());
      }),
    );
    const { result } = renderHookWithProviders(
      () => ({ summary: useAttentionSummary(), hide: useHideAttentionItem() }),
      { role: 'TEACHER', tenantId: 'tenant-1' },
    );
    await waitFor(() => expect(seen.calls).toBe(1));
    await result.current.hide.mutateAsync('r1');
    expect(hit).toBe('r1');
    await waitFor(() => expect(seen.calls).toBe(2));
  });

  it('snooze sends exactly { choice, date? }', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post('*/attention/items/:id/snooze', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(alertItemFactory());
      }),
    );
    const { result } = renderHookWithProviders(() => useSnoozeAttentionItem(), TENANT);
    await result.current.mutateAsync({ recipientId: 'r1', choice: 'DATE', date: '2026-10-12' });
    await result.current.mutateAsync({ recipientId: 'r1', choice: 'TWO_HOURS' });
    expect(bodies).toEqual([{ choice: 'DATE', date: '2026-10-12' }, { choice: 'TWO_HOURS' }]);
  });

  it('seen sends { recipientIds } and does not refetch the summary', async () => {
    const seen = countSummary();
    const bodies: unknown[] = [];
    server.use(
      http.post('*/attention/items/seen', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ updated: 2 });
      }),
    );
    const { result } = renderHookWithProviders(
      () => ({ summary: useAttentionSummary(), seen: useMarkAttentionSeen() }),
      { role: 'TEACHER', tenantId: 'tenant-1' },
    );
    await waitFor(() => expect(seen.calls).toBe(1));
    await result.current.seen.mutateAsync(['a', 'b']);
    expect(bodies).toEqual([{ recipientIds: ['a', 'b'] }]);
    expect(seen.calls).toBe(1);
  });
});

describe('usePlatformAttentionHealth', () => {
  it('returns the all-null default health', async () => {
    const { result } = renderHookWithProviders(() => usePlatformAttentionHealth(), TENANT);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.failingRules).toEqual([]);
  });
});

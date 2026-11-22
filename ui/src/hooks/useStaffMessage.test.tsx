import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '../test/msw/server';
import { apiErrorBody } from '../test/msw/support';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import { useSendStaffMessage, useStaffMessagePreview } from './useStaffMessage';

const input = {
  audience: { teaching: true },
  message: 'School is closed tomorrow.',
  medium: 'SMS' as const,
};

describe('useStaffMessagePreview', () => {
  it('posts to the preview route and returns the numbers', async () => {
    server.use(
      http.post('/api/v1/communications/staff/preview', () =>
        HttpResponse.json(
          {
            people: 3,
            with_phone: 2,
            skipped: [{ user_id: 'u3', name: 'Rina', reason: 'no_phone' }],
            segments_each: 1,
            credits_needed: 2,
            balance: 10,
            shortfall: 0,
            whatsapp_template: { name: '', language: '', params: [] },
          },
          { status: 201 },
        ),
      ),
    );
    const { result } = renderHookWithProviders(() => useStaffMessagePreview(), {
      tenantId: 'tenant-1',
    });
    result.current.mutate(input);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.with_phone).toBe(2);
    expect(result.current.data?.skipped[0]?.name).toBe('Rina');
  });
});

describe('useSendStaffMessage', () => {
  it('sends an Idempotency-Key header', async () => {
    let key: string | null = null;
    server.use(
      http.post('/api/v1/communications/staff', ({ request }) => {
        key = request.headers.get('Idempotency-Key');
        return HttpResponse.json(
          { batch_id: 'b1', total_recipients: 2, queued: 2, failed: 0, skipped: [] },
          { status: 201 },
        );
      }),
    );
    const { result } = renderHookWithProviders(() => useSendStaffMessage(), {
      tenantId: 'tenant-1',
    });
    result.current.mutate(input);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(key).toBeTruthy();
    expect(result.current.data?.queued).toBe(2);
  });

  it('does not retry a failed send', async () => {
    let calls = 0;
    server.use(
      http.post('/api/v1/communications/staff', () => {
        calls += 1;
        return HttpResponse.json(apiErrorBody(500, 'boom', '/api/v1/communications/staff'), {
          status: 500,
        });
      }),
    );
    const { result } = renderHookWithProviders(() => useSendStaffMessage(), {
      tenantId: 'tenant-1',
    });
    result.current.mutate(input);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(calls).toBe(1);
  });
});

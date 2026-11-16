import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '../test/msw/server';
import { apiErrorBody } from '../test/msw/support';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import { useConfirmFeeProof, usePublish } from './admission-pipeline';

describe('admission pipeline mutations', () => {
  it('a failed mutation is sent once (no retry)', async () => {
    let calls = 0;
    server.use(
      http.post('/api/v1/admission/fee-proofs/p1/confirm', () => {
        calls += 1;
        return HttpResponse.json(apiErrorBody(500, 'boom', '/x'), { status: 500 });
      }),
    );
    const { result } = renderHookWithProviders(() => useConfirmFeeProof(), { tenantId: 't1' });
    result.current.mutate('p1');
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(calls).toBe(1);
  });

  it('publish sends one Idempotency-Key per action, the same one on a re-send', async () => {
    const keys: (string | null)[] = [];
    server.use(
      http.post('/api/v1/admission/intakes/r1/publish', ({ request }) => {
        keys.push(request.headers.get('Idempotency-Key'));
        return HttpResponse.json(apiErrorBody(500, 'boom', '/x'), { status: 500 });
      }),
    );
    const { result } = renderHookWithProviders(() => usePublish('r1'), { tenantId: 't1' });
    const input = { what: 'MERIT' as const, ref_id: 'l1', send_sms: true };
    result.current.mutate(input);
    await waitFor(() => expect(result.current.isError).toBe(true));
    result.current.mutate(input);
    await waitFor(() => expect(keys).toHaveLength(2));
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
  });
});

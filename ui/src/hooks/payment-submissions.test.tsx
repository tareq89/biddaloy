/**
 * [3.x/#3973] `payment-submissions.ts` — Rule 25: every mutation is `retry: false` and sends an
 * `Idempotency-Key`; list and detail read the staff and portal routes.
 */
import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';
import { cleanupTestState } from '../test/render-with-providers';

import {
  useConfirmPaymentProof,
  useMyPaymentProofs,
  usePaymentSubmission,
  usePaymentSubmissions,
  useRejectPaymentProof,
  useReopenPaymentProof,
  useSubmitPaymentProof,
  useWithdrawPaymentProof,
} from './payment-submissions';

afterEach(async () => {
  sessionStorage.clear();
  await cleanupTestState();
});

const opts = { tenantId: 'tenant-1' };

describe('queries', () => {
  it('portal list passes studentId', async () => {
    let q: URLSearchParams | undefined;
    server.use(
      http.get('/api/v1/portal/payment-proofs', ({ request }) => {
        q = new URL(request.url).searchParams;
        return HttpResponse.json([{ id: 'p1' }]);
      }),
    );
    const { result } = renderHookWithProviders(() => useMyPaymentProofs('s1'), opts);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: 'p1' }]);
    expect(q?.get('studentId')).toBe('s1');
  });

  it('staff list passes status and source; detail reads the id', async () => {
    let q: URLSearchParams | undefined;
    server.use(
      http.get('/api/v1/payment-submissions', ({ request }) => {
        q = new URL(request.url).searchParams;
        return HttpResponse.json({ items: [], nextCursor: null });
      }),
      http.get('/api/v1/payment-submissions/p1', () => HttpResponse.json({ id: 'p1' })),
    );
    const list = renderHookWithProviders(
      () => usePaymentSubmissions({ status: 'PENDING' as never, source: 'PROOF' as never }),
      opts,
    );
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
    expect(q?.get('status')).toBe('PENDING');
    expect(q?.get('source')).toBe('PROOF');

    const one = renderHookWithProviders(() => usePaymentSubmission('p1'), opts);
    await waitFor(() => expect(one.result.current.isSuccess).toBe(true));
    expect(one.result.current.data?.id).toBe('p1');
  });
});

/** Records the header of one POST and answers 200 with `{ id: 'p1' }`. */
function capture(path: string) {
  const seen: { key: string | null; body: unknown }[] = [];
  server.use(
    http.post(path, async ({ request }) => {
      seen.push({
        key: request.headers.get('Idempotency-Key'),
        body: request.headers.get('content-type')?.includes('json')
          ? await request.json()
          : (request.headers.get('content-type') ?? null),
      });
      return HttpResponse.json({ id: 'p1' });
    }),
  );
  return seen;
}

describe('mutations: Idempotency-Key and no retry', () => {
  it('submit sends multipart with a key and retry false', async () => {
    const seen = capture('/api/v1/portal/payment-proofs');
    const { result } = renderHookWithProviders(() => useSubmitPaymentProof(), opts);
    result.current.mutate({
      billIds: ['b1'],
      method: 'BKASH' as never,
      amount: 500,
      paidOn: '2026-11-14',
      reference: 'TRX1',
      files: [new File(['x'], 'p.png', { type: 'image/png' })],
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seen[0]?.key).toMatch(/^[0-9a-f-]{36}$/);
    expect(String(seen[0]?.body)).toContain('multipart/form-data');
    expect(result.current.failureCount).toBe(0);
  });

  it('after a network failure, a same-name same-size file with other bytes gets a new key', async () => {
    const keys: (string | null)[] = [];
    let first = true;
    server.use(
      http.post('/api/v1/portal/payment-proofs', ({ request }) => {
        keys.push(request.headers.get('Idempotency-Key'));
        if (first) {
          first = false;
          return HttpResponse.error(); // no response at all
        }
        return HttpResponse.json({ id: 'p1' });
      }),
    );
    const { result } = renderHookWithProviders(() => useSubmitPaymentProof(), opts);
    const input = (bytes: string) => ({
      billIds: ['b1'],
      method: 'BKASH' as never,
      amount: 500,
      paidOn: '2026-11-14',
      reference: 'TRX1',
      files: [new File([bytes], 'proof.png', { type: 'image/png' })],
    });
    result.current.mutate(input('aaaa'));
    await waitFor(() => expect(result.current.isError).toBe(true));
    result.current.mutate(input('bbbb')); // same name, same size, different bytes
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('a failed submit is not retried', async () => {
    let calls = 0;
    server.use(
      http.post('/api/v1/portal/payment-proofs', () => {
        calls += 1;
        return HttpResponse.json({ message: 'no' }, { status: 503 });
      }),
    );
    const { result } = renderHookWithProviders(() => useSubmitPaymentProof(), opts);
    result.current.mutate({
      billIds: ['b1'],
      method: 'CASH' as never,
      amount: 1,
      paidOn: '2026-11-14',
      reference: 'T',
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(calls).toBe(1);
  });

  it.each([
    ['withdraw', '/api/v1/portal/payment-proofs/p1/withdraw', useWithdrawPaymentProof, 'p1'],
    ['confirm', '/api/v1/payment-submissions/p1/confirm', useConfirmPaymentProof, 'p1'],
  ])('%s sends a key', async (_n, path, hook, arg) => {
    const seen = capture(path);
    const { result } = renderHookWithProviders(() => hook(), opts);
    (result.current as { mutate: (a: string) => void }).mutate(arg);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seen[0]?.key).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('reject sends reason, note and a key', async () => {
    const seen = capture('/api/v1/payment-submissions/p1/reject');
    const { result } = renderHookWithProviders(() => useRejectPaymentProof(), opts);
    result.current.mutate({ id: 'p1', reason: 'IMAGE_UNCLEAR' as never });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seen[0]?.key).toBeTruthy();
    expect(seen[0]?.body).toEqual({ reason: 'IMAGE_UNCLEAR' });
  });

  it('reopen sends the note and a key', async () => {
    const seen = capture('/api/v1/payment-submissions/p1/reopen');
    const { result } = renderHookWithProviders(() => useReopenPaymentProof(), opts);
    result.current.mutate({ id: 'p1', note: 'checked bKash again' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seen[0]?.key).toBeTruthy();
    expect(seen[0]?.body).toEqual({ note: 'checked bKash again' });
  });

  it('a second confirm of another proof gets a different key', async () => {
    const seen = capture('/api/v1/payment-submissions/p1/confirm');
    server.use(
      http.post('/api/v1/payment-submissions/p2/confirm', ({ request }) => {
        seen.push({ key: request.headers.get('Idempotency-Key'), body: null });
        return HttpResponse.json({ id: 'p2' });
      }),
    );
    const { result } = renderHookWithProviders(() => useConfirmPaymentProof(), opts);
    result.current.mutate('p1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    result.current.mutate('p2');
    await waitFor(() => expect(seen).toHaveLength(2));
    expect(seen[0]?.key).not.toBe(seen[1]?.key);
  });
});

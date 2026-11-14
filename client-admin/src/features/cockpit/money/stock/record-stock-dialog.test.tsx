import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RecordStockDialog } from './record-stock-dialog';

const view = (onOpenChange = vi.fn()) =>
  renderWithProviders(<RecordStockDialog open onOpenChange={onOpenChange} />, {
    locale: 'en',
    role: 'SUPER_ADMIN',
    tenantId: 'platform',
  });

afterEach(async () => {
  await cleanupTestState();
});

async function fill(user: ReturnType<typeof userEvent.setup>, sms: string, cost = '18000') {
  await user.type(await screen.findByLabelText('Number of SMS'), sms);
  await user.type(screen.getByLabelText('Cost (Tk)'), cost);
}

describe('RecordStockDialog', () => {
  it('sends one request with an Idempotency-Key, taka cost, then refreshes the SMS report', async () => {
    const seen: { body: Record<string, unknown>; key: string | null }[] = [];
    server.use(
      http.post('*/platform/sms-stock', async ({ request }) => {
        seen.push({
          body: (await request.json()) as Record<string, unknown>,
          key: request.headers.get('Idempotency-Key'),
        });
        return HttpResponse.json({}, { status: 201 });
      }),
    );
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    const { container, queryClient } = view(onOpenChange);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    await fill(user, '100000');
    await expect(container).toHaveNoViolations();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.key).toBeTruthy();
    expect(seen[0]!.body).toMatchObject({ smsCount: 100000, costTaka: 18000 });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['platform-money-sms'] });
  });

  it.each(['0', '-5'])('blocks %s SMS before any request', async (sms) => {
    let hit = false;
    server.use(http.post('*/platform/sms-stock', () => ((hit = true), HttpResponse.json({}))));
    const user = userEvent.setup();
    view();
    await fill(user, sms);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Enter a whole number above 0.')).toBeTruthy();
    expect(hit).toBe(false);
  });

  it('sends the balance the company shows when it was filled', async () => {
    let balance: unknown;
    server.use(
      http.post('*/platform/sms-stock/balance', async ({ request }) => {
        balance = await request.json();
        return HttpResponse.json({ ok: true });
      }),
    );
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    view(onOpenChange);
    await fill(user, '500');
    await user.type(await screen.findByLabelText('SMS the company shows now (optional)'), '900');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(balance).toEqual({ smsBalance: 900 }));
  });
});

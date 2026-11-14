import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { StockEntriesList } from './stock-entries-list';

const entry = {
  id: '11111111-1111-4111-8111-111111111111',
  boughtOn: '2029-12-01',
  smsCount: 50000,
  costPaisa: '2500000',
  note: null,
  createdAt: '2029-12-01T00:00:00.000Z',
};

const view = (entries = [entry]) =>
  renderWithProviders(<StockEntriesList entries={entries} />, {
    locale: 'en',
    role: 'SUPER_ADMIN',
    tenantId: 'platform',
  });

afterEach(async () => {
  await cleanupTestState();
});

describe('StockEntriesList', () => {
  it('shows the empty state with no entries', async () => {
    view([]);
    expect(await screen.findByText('Nothing recorded yet')).toBeTruthy();
  });

  it('asks a reason, then the code, then deletes with both', async () => {
    const calls: { token: string | null; body: unknown }[] = [];
    server.use(
      http.delete('*/platform/sms-stock/:id', async ({ request }) => {
        const token = request.headers.get('X-Approval-Token');
        calls.push({ token, body: await request.json() });
        if (token) return new HttpResponse(null, { status: 204 });
        return HttpResponse.json(
          {
            statusCode: 403,
            message: 'x',
            timestamp: '',
            path: '/',
            requestId: 'r',
            details: { code: 'APPROVAL_REQUIRED' },
          },
          { status: 403 },
        );
      }),
    );
    const user = userEvent.setup();
    view();
    await user.click((await screen.findAllByRole('button', { name: 'Delete' }))[0]!);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Write at least 5 characters.')).toBeTruthy();
    expect(calls).toHaveLength(0);
    await user.type(screen.getByLabelText('Reason'), 'Typed twice by mistake');
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.type(await screen.findByLabelText('Authenticator code'), '123456');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]!.token).toBe('owner-token');
    expect(calls[1]!.body).toEqual({ reason: 'Typed twice by mistake' });
  });
});

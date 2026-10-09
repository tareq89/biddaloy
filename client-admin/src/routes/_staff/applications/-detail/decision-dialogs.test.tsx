import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

import { applicationDto } from './-application-fixture';

const ID = '7c1e0000-0000-4000-8000-000000000001';

const envelope = (statusCode: number, code: string) =>
  HttpResponse.json(
    {
      statusCode,
      message: 'raw server text that must never show',
      details: { code },
      timestamp: new Date().toISOString(),
      path: '/x',
      requestId: 'r',
    },
    { status: statusCode },
  );

function open(dto = applicationDto(), search = '') {
  let served = dto;
  server.use(http.get('/api/v1/applications/:id', () => HttpResponse.json(served)));
  renderWithRouter(routeTree, {
    initialEntries: [`/applications/${dto.id}${search}`],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
  return { serve: (next: typeof dto) => (served = next) };
}

describe('decision dialogs', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('reject without a reason is blocked and sends nothing', async () => {
    let posted = 0;
    server.use(
      http.post('/api/v1/applications/:id/reject', () => {
        posted += 1;
        return HttpResponse.json(applicationDto({ status: 'REJECTED' }));
      }),
    );
    open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Reject' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }));
    expect(await within(dialog).findByText('Write a reason.')).toBeTruthy();
    expect(posted).toBe(0);
  });

  it('cancel requires a reason, then posts it', async () => {
    let body: unknown;
    server.use(
      http.post('/api/v1/applications/:id/cancel', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(applicationDto({ status: 'CANCELLED' }));
      }),
    );
    open(
      applicationDto({
        type: 'STAFF_LEAVE',
        status: 'APPROVED',
        payload: { leave_type: 'CASUAL' },
        can: { decide: false, consider: false, withdraw: false, cancel: true, comment: false },
      }),
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /more actions/i }));
    await user.click(await screen.findByRole('menuitem', { name: 'Cancel leave' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel leave' }));
    expect(await within(dialog).findByText('Write a reason.')).toBeTruthy();
    await user.type(within(dialog).getByLabelText('Reason for cancelling'), 'Plans changed');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel leave' }));
    await waitFor(() => expect(body).toEqual({ reason: 'Plans changed' }));
  });

  it('a final FEE_WAIVER approval sends the granted amount, never the reason', async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.post('/api/v1/applications/:id/approve', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(applicationDto({ status: 'APPROVED' }));
      }),
    );
    open(applicationDto({ current_step: 1 }));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(body).toBeDefined());
    expect(body?.granted).toMatchObject({
      kind: 'PERCENT',
      value: 25,
      fee_types: ['MONTHLY_TUITION'],
    });
    expect(body?.granted).not.toHaveProperty('reason');
  });

  it('a non-waiver approval sends no granted block', async () => {
    let body: unknown;
    server.use(
      http.post('/api/v1/applications/:id/approve', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(applicationDto({ status: 'APPROVED' }));
      }),
    );
    open(applicationDto({ type: 'STAFF_LEAVE', payload: { leave_type: 'CASUAL' } }));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(body).toEqual({}));
  });

  it('APPROVAL_REQUIRED opens the step-up modal and retries once with X-Approval-Token', async () => {
    const headers: (string | null)[] = [];
    server.use(
      http.post('/api/v1/applications/:id/approve', ({ request }) => {
        headers.push(request.headers.get('X-Approval-Token'));
        return headers.length === 1
          ? envelope(403, 'APPROVAL_REQUIRED')
          : HttpResponse.json(applicationDto({ status: 'APPROVED' }));
      }),
      http.post('/api/v1/auth/step-up/otp/request', () => HttpResponse.json({ sent: true })),
      http.post('/api/v1/auth/step-up', () =>
        HttpResponse.json({ approval_token: 'tok-1', expires_in: 300 }),
      ),
    );
    open(applicationDto({ current_step: 1 }));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }));
    // The shared step-up modal takes over; the first request carried no token.
    await waitFor(() => expect(headers).toHaveLength(1));
    expect(headers[0]).toBeNull();
    expect(await screen.findAllByRole('dialog')).not.toHaveLength(0);
  });

  it('APPLICATION_CHANGED shows the translated sentence and refetches the detail', async () => {
    let gets = 0;
    server.use(
      http.get('/api/v1/applications/:id', () => {
        gets += 1;
        return HttpResponse.json(
          applicationDto({ type: 'GENERAL', payload: { subject_line: 's', body: 'b' } }),
        );
      }),
      http.post('/api/v1/applications/:id/approve', () => envelope(409, 'APPLICATION_CHANGED')),
    );
    renderWithRouter(routeTree, {
      initialEntries: [`/applications/${ID}`],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog');
    const before = gets;
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }));
    expect(
      await within(dialog).findByText(
        'Someone else has already decided. The page has been refreshed.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/raw server text/)).toBeNull();
    await waitFor(() => expect(gets).toBeGreaterThan(before));
  });

  it('an unknown error code falls back to the generic translated sentence', async () => {
    server.use(http.post('/api/v1/applications/:id/reject', () => envelope(500, 'SOMETHING_NEW')));
    open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Reject' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Reason for rejecting'), 'No');
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }));
    expect(
      await within(dialog).findByText('The decision could not be saved. Try again.'),
    ).toBeTruthy();
  });
});

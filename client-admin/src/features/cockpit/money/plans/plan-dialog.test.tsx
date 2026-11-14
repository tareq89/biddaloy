import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PlanDialog } from './plan-dialog';

const opts = { locale: 'en', role: 'SUPER_ADMIN', tenantId: 'platform' } as const;

afterEach(async () => {
  await cleanupTestState();
});

const approvalRequired = () =>
  HttpResponse.json(
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

const plan = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Standard',
  unit_price_paisa: 1000,
  active: true,
  is_default: true,
};

describe('PlanDialog', () => {
  it('new: asks for the code, then sends one create with an Idempotency-Key and whole paisa', async () => {
    const seen: { token: string | null; key: string | null; body: unknown }[] = [];
    server.use(
      http.post('*/platform/plans', async ({ request }) => {
        const token = request.headers.get('X-Approval-Token');
        seen.push({
          token,
          key: request.headers.get('Idempotency-Key'),
          body: await request.json(),
        });
        return token ? HttpResponse.json({}, { status: 201 }) : approvalRequired();
      }),
    );
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    const { container } = renderWithProviders(
      <PlanDialog open onOpenChange={onOpenChange} />,
      opts,
    );
    await user.type(await screen.findByLabelText('Name'), 'Premium');
    await user.type(screen.getByLabelText('Per seat, per month (Tk)'), '25');
    expect(screen.getByText('A new price applies to the next order only.')).toBeTruthy();
    await expect(container).toHaveNoViolations();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.type(await screen.findByLabelText('Authenticator code'), '123456');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(seen).toHaveLength(2);
    expect(seen.filter((c) => c.token)).toHaveLength(1);
    expect(seen[1]!.key).toBeTruthy();
    expect(seen[1]!.body).toEqual({ name: 'Premium', unit_price_paisa: 2500 });
  });

  it.each([
    ['Premium', '0', /^Enter a price above 0/],
    ['Premium', '1000001', /^Enter a price above 0/],
    ['P', '25', 'Enter a name of 2 to 60 characters.'],
    ['P'.repeat(61), '25', 'Enter a name of 2 to 60 characters.'],
  ])('blocks name %s price %s before any request', async (name, price, sentence) => {
    let hit = false;
    server.use(http.post('*/platform/plans', () => ((hit = true), HttpResponse.json({}))));
    const user = userEvent.setup();
    renderWithProviders(<PlanDialog open onOpenChange={vi.fn()} />, opts);
    await user.type(await screen.findByLabelText('Name'), name);
    await user.type(screen.getByLabelText('Per seat, per month (Tk)'), price);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(sentence)).toBeTruthy();
    expect(hit).toBe(false);
  });

  it('shows one fixed sentence when the save fails, never the server text', async () => {
    server.use(
      http.post('*/platform/plans', () =>
        HttpResponse.json({ statusCode: 400, message: 'secret detail' }, { status: 400 }),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(<PlanDialog open onOpenChange={vi.fn()} />, opts);
    await user.type(await screen.findByLabelText('Name'), 'Premium');
    await user.type(screen.getByLabelText('Per seat, per month (Tk)'), '25');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Could not save. Try again.')).toBeTruthy();
    expect(screen.queryByText(/secret detail/)).toBeNull();
  });

  it('edit: prefills, then sends exactly one PATCH with the new price in paisa', async () => {
    const seen: { token: string | null; body: unknown }[] = [];
    server.use(
      http.patch('*/platform/plans/:id', async ({ request }) => {
        const token = request.headers.get('X-Approval-Token');
        seen.push({ token, body: await request.json() });
        return token ? HttpResponse.json({}) : approvalRequired();
      }),
    );
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<PlanDialog open onOpenChange={onOpenChange} plan={plan} />, opts);
    expect(await screen.findByDisplayValue('Standard')).toBeTruthy();
    const price = screen.getByLabelText('Per seat, per month (Tk)');
    await user.clear(price);
    await user.type(price, '12');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.type(await screen.findByLabelText('Authenticator code'), '123456');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(seen.filter((c) => c.token)).toHaveLength(1);
    expect(seen.at(-1)!.body).toEqual({ name: 'Standard', unit_price_paisa: 1200 });
  });
});

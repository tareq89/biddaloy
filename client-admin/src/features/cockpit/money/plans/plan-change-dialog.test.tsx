import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PlanChangeDialog } from './plan-change-dialog';

const opts = { locale: 'en', role: 'SUPER_ADMIN', tenantId: 'platform' } as const;
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const plans = [
  { id: ID(1), name: 'Standard', unit_price_paisa: 1000, active: true, is_default: true },
  { id: ID(2), name: 'Premium', unit_price_paisa: 2500, active: true, is_default: false },
  { id: ID(3), name: 'Old plan', unit_price_paisa: 500, active: false, is_default: false },
];

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

const mount = (onOpenChange = vi.fn()) => {
  server.use(http.get('*/platform/plans', () => HttpResponse.json(plans)));
  return renderWithProviders(
    <PlanChangeDialog
      schoolId={ID(9)}
      schoolName="Green Valley School"
      currentPlanId={ID(1)}
      open
      onOpenChange={onOpenChange}
    />,
    opts,
  );
};

describe('PlanChangeDialog', () => {
  it('lists active plans only, with the next-order line', async () => {
    const user = userEvent.setup();
    const { container } = mount();
    expect(await screen.findByText('Change plan for Green Valley School')).toBeTruthy();
    expect(screen.getByText('This changes the price of the next order only.')).toBeTruthy();
    await expect(container).toHaveNoViolations();
    await user.click(screen.getByLabelText('New plan'));
    expect(await screen.findByRole('option', { name: /Premium/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /Old plan/ })).toBeNull();
  });

  it.each(['', 'abc', 'x'.repeat(301)])('needs a 5-300 character reason (%#)', async (reason) => {
    let hit = false;
    server.use(
      http.post('*/platform/billing/schools/:id/plan', () => ((hit = true), HttpResponse.json({}))),
    );
    const user = userEvent.setup();
    mount();
    if (reason) await user.type(await screen.findByLabelText('Reason'), reason);
    await user.click(await screen.findByRole('button', { name: 'Change plan' }));
    expect(await screen.findByText('Write a reason of 5 to 300 characters.')).toBeTruthy();
    expect(hit).toBe(false);
  });

  it('sends one change with the code step, plan id and reason', async () => {
    const seen: { token: string | null; body: unknown }[] = [];
    server.use(
      http.post('*/platform/billing/schools/:id/plan', async ({ request }) => {
        const token = request.headers.get('X-Approval-Token');
        seen.push({ token, body: await request.json() });
        return token ? HttpResponse.json({}) : approvalRequired();
      }),
    );
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    mount(onOpenChange);
    await user.click(await screen.findByLabelText('New plan'));
    await user.click(await screen.findByRole('option', { name: /Premium/ }));
    await user.type(screen.getByLabelText('Reason'), 'School asked for more seats');
    await user.click(screen.getByRole('button', { name: 'Change plan' }));
    await user.type(await screen.findByLabelText('Authenticator code'), '123456');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(seen.filter((c) => c.token)).toHaveLength(1);
    expect(seen.at(-1)!.body).toEqual({ plan_id: ID(2), reason: 'School asked for more seats' });
  });

  it('shows one fixed sentence on failure, never the server text', async () => {
    server.use(
      http.post('*/platform/billing/schools/:id/plan', () =>
        HttpResponse.json({ statusCode: 400, message: 'secret detail' }, { status: 400 }),
      ),
    );
    const user = userEvent.setup();
    mount();
    await user.type(await screen.findByLabelText('Reason'), 'School asked');
    await user.click(screen.getByRole('button', { name: 'Change plan' }));
    expect(await screen.findByText('Could not change the plan. Try again.')).toBeTruthy();
    expect(screen.queryByText(/secret detail/)).toBeNull();
  });
});

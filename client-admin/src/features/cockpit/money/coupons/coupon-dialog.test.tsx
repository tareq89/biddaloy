import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CouponDialog } from './coupon-dialog';

const opts = { locale: 'en', role: 'SUPER_ADMIN', tenantId: 'platform' } as const;

afterEach(async () => {
  await cleanupTestState();
});

const err = (status: number, code: string, extra: object = {}) =>
  HttpResponse.json(
    {
      statusCode: status,
      message: 'secret detail',
      timestamp: '',
      path: '/',
      requestId: 'r',
      details: { code, ...extra },
    },
    { status },
  );
const approvalRequired = () => err(403, 'APPROVAL_REQUIRED');

const coupon = {
  id: '11111111-1111-4111-8111-111111111111',
  code: 'WELCOME10',
  discount_kind: 'PERCENT' as const,
  percent: 10,
  fixed_paisa: null,
  max_months: 3,
  max_discount_paisa: null,
  min_order_paisa: null,
  scope: 'ALL' as const,
  max_uses: 5,
  uses_count: 2,
  per_school_max: 1,
  starts_at: '2029-01-01T00:00:00.000Z',
  ends_at: '2030-12-31T00:00:00.000Z',
  active: true,
  created_at: '2029-01-01T00:00:00.000Z',
};

const setup = (props: Partial<React.ComponentProps<typeof CouponDialog>> = {}) => {
  const onOpenChange = vi.fn();
  const onOpenApprovals = vi.fn();
  const user = userEvent.setup();
  const view = renderWithProviders(
    <CouponDialog open onOpenChange={onOpenChange} onOpenApprovals={onOpenApprovals} {...props} />,
    opts,
  );
  return { ...view, user, onOpenChange, onOpenApprovals };
};

async function fill(
  user: ReturnType<typeof userEvent.setup>,
  v: { code?: string; percent?: string; ends?: string },
) {
  await user.type(await screen.findByLabelText('Coupon code'), v.code ?? 'spring50');
  await user.type(screen.getByLabelText('Discount (%)'), v.percent ?? '50');
  await user.type(screen.getByLabelText('End date'), v.ends ?? '2030-12-31');
}

const askCode = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(await screen.findByLabelText('Authenticator code'), '123456');
  await user.keyboard('{Enter}');
};

describe('CouponDialog', () => {
  it('upper-cases the code, then sends one create for two chosen schools with a key', async () => {
    const seen: { token: string | null; key: string | null; body: unknown }[] = [];
    server.use(
      http.post('*/platform/coupons', async ({ request }) => {
        const token = request.headers.get('X-Approval-Token');
        seen.push({
          token,
          key: request.headers.get('Idempotency-Key'),
          body: await request.json(),
        });
        return token ? HttpResponse.json({}, { status: 201 }) : approvalRequired();
      }),
    );
    const { user, onOpenChange, container } = setup();
    await fill(user, {});
    expect(screen.getByLabelText<HTMLInputElement>('Coupon code').value).toBe('SPRING50');
    await user.click(screen.getByRole('radio', { name: 'Chosen schools' }));
    const picker = screen.getByRole('combobox', { name: 'Schools' });
    await user.click(picker);
    await user.click(await screen.findByRole('option', { name: /Rose Valley School/ }));
    await user.click(await screen.findByRole('option', { name: /Green Hill School/ }));
    await expect(container).toHaveNoViolations();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await askCode(user);
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(seen).toHaveLength(2);
    expect(seen[1]!.key).toBeTruthy();
    expect(seen[1]!.body).toMatchObject({
      code: 'SPRING50',
      discount_kind: 'PERCENT',
      percent: 50,
      scope: 'SCHOOLS',
      per_school_max: 1,
    });
    expect((seen[1]!.body as { schools: string[] }).schools).toHaveLength(2);
  });

  it('sends fixed money as whole paisa', async () => {
    let body: unknown;
    server.use(
      http.post('*/platform/coupons', async ({ request }) => {
        const token = request.headers.get('X-Approval-Token');
        if (!token) return approvalRequired();
        body = await request.json();
        return HttpResponse.json({}, { status: 201 });
      }),
    );
    const { user } = setup();
    await user.type(await screen.findByLabelText('Coupon code'), 'FIXED100');
    await user.click(screen.getByRole('radio', { name: 'Fixed amount' }));
    await user.type(screen.getByLabelText('Discount each month (Tk)'), '150');
    await user.type(screen.getByLabelText('End date'), '2030-12-31');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await askCode(user);
    await waitFor(() => expect(body).toBeTruthy());
    expect(body).toMatchObject({ discount_kind: 'FIXED', fixed_paisa: 15000 });
  });

  it.each([
    ['ab', '50', 'Enter a code of 4 to 20 characters: only A-Z, 0-9 and -.'],
    ['BAD CODE!', '50', 'Enter a code of 4 to 20 characters: only A-Z, 0-9 and -.'],
    ['A'.repeat(21), '50', 'Enter a code of 4 to 20 characters: only A-Z, 0-9 and -.'],
    ['SPRING50', '101', 'Enter a number from 1 to 100.'],
    ['SPRING50', '0', 'Enter a number from 1 to 100.'],
  ])('blocks code %s percent %s before any request', async (code, percent, sentence) => {
    let hit = false;
    server.use(http.post('*/platform/coupons*', () => ((hit = true), HttpResponse.json({}))));
    const { user } = setup();
    await fill(user, { code, percent });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(sentence)).toBeTruthy();
    expect(hit).toBe(false);
  });

  it('blocks an end date that is not after the start, out-of-range months and uses', async () => {
    let hit = false;
    server.use(http.post('*/platform/coupons*', () => ((hit = true), HttpResponse.json({}))));
    const { user } = setup();
    await fill(user, { ends: '2001-01-01' });
    await user.type(screen.getByLabelText('First how many months'), '25');
    await user.type(screen.getByLabelText('Total uses'), '1000001');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('The end date must be after the start date.')).toBeTruthy();
    expect(screen.getAllByText('Enter a whole number, 1 or more.')).toHaveLength(2);
    expect(hit).toBe(false);
  });

  it('chosen schools with none picked is blocked', async () => {
    const { user } = setup();
    await fill(user, {});
    await user.click(screen.getByRole('radio', { name: 'Chosen schools' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Choose at least one school.')).toBeTruthy();
  });

  it('100 percent: warns, asks the other owner, and shows the waiting card with the approvals link', async () => {
    const calls: (string | null)[] = [];
    server.use(
      http.post('*/platform/coupons/free', ({ request }) => {
        const token = request.headers.get('X-Approval-Token');
        calls.push(request.headers.get('X-Platform-Approval'));
        return token ? err(403, 'APPROVAL_REQUESTED', { requestId: 'req-1' }) : approvalRequired();
      }),
    );
    const { user, onOpenApprovals, onOpenChange } = setup();
    await fill(user, { percent: '100' });
    expect(screen.getByText(/A 100% discount makes the seats free/)).toBeTruthy();
    expect(screen.queryByLabelText('Largest discount (Tk)')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Ask the other owner' }));
    await askCode(user);
    expect(await screen.findByText('The other owner must approve')).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    await user.click(screen.getByRole('button', { name: 'See the approvals list' }));
    expect(onOpenApprovals).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('button', { name: 'Ask the other owner' }).hasAttribute('disabled'),
    ).toBe(true);
  });

  it('100 percent: after the other owner agrees, check again re-sends with the approval id and saves', async () => {
    const seen: (string | null)[] = [];
    server.use(
      http.post('*/platform/coupons/free', ({ request }) => {
        const approval = request.headers.get('X-Platform-Approval');
        seen.push(approval);
        if (!request.headers.get('X-Approval-Token')) return approvalRequired();
        return approval
          ? HttpResponse.json({}, { status: 201 })
          : err(403, 'APPROVAL_REQUESTED', { requestId: 'req-1' });
      }),
    );
    const { user, onOpenChange } = setup();
    await fill(user, { percent: '100' });
    await user.click(screen.getByRole('button', { name: 'Ask the other owner' }));
    await askCode(user);
    await user.click(await screen.findByRole('button', { name: 'Check if they agreed' }));
    await askCode(user);
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(seen).toContain('req-1');
  });

  it('100 percent with no second owner: says it cannot be made now and does not close', async () => {
    server.use(
      http.post('*/platform/coupons/free', ({ request }) =>
        request.headers.get('X-Approval-Token') ? err(409, 'NO_SECOND_OWNER') : approvalRequired(),
      ),
    );
    const { user, onOpenChange } = setup();
    await fill(user, { percent: '100' });
    await user.click(screen.getByRole('button', { name: 'Ask the other owner' }));
    await askCode(user);
    expect(await screen.findByText('It cannot be made now')).toBeTruthy();
    expect(screen.getByText(/needs a second owner/)).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('shows one fixed sentence when the save fails, never the server text', async () => {
    server.use(
      http.post('*/platform/coupons', () =>
        HttpResponse.json({ statusCode: 400, message: 'secret detail' }, { status: 400 }),
      ),
    );
    const { user } = setup();
    await fill(user, {});
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Could not save. Try again.')).toBeTruthy();
    expect(screen.queryByText(/secret detail/)).toBeNull();
  });

  it('edit: locks the fixed fields, prefills, and sends exactly one PATCH with only the editable ones', async () => {
    const seen: { token: string | null; body: unknown }[] = [];
    server.use(
      http.patch('*/platform/coupons/:id', async ({ request }) => {
        const token = request.headers.get('X-Approval-Token');
        seen.push({ token, body: await request.json() });
        return token ? HttpResponse.json({}) : approvalRequired();
      }),
    );
    const { user, onOpenChange } = setup({ coupon });
    expect(await screen.findByDisplayValue('WELCOME10')).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>('Coupon code').disabled).toBe(true);
    expect(screen.getByLabelText<HTMLInputElement>('Discount (%)').disabled).toBe(true);
    expect(screen.getByLabelText<HTMLInputElement>('End date').disabled).toBe(false);
    const uses = screen.getByLabelText('Total uses');
    await user.clear(uses);
    await user.type(uses, '9');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await askCode(user);
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(seen.filter((c) => c.token)).toHaveLength(1);
    expect(seen.at(-1)!.body).toEqual({ ends_at: '2030-12-31T23:59:59.000Z', max_uses: 9 });
  });

  it('while waiting the fields are locked and the resend body is the original; Start over unlocks', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post('*/platform/coupons/free', async ({ request }) => {
        if (!request.headers.get('X-Approval-Token')) return approvalRequired();
        bodies.push(await request.json());
        return bodies.length === 1
          ? err(403, 'APPROVAL_REQUESTED', { requestId: 'req-1' })
          : HttpResponse.json({}, { status: 201 });
      }),
    );
    const { user, onOpenChange } = setup();
    await fill(user, { code: 'FREE100', percent: '100' });
    await user.click(screen.getByRole('button', { name: 'Ask the other owner' }));
    await askCode(user);
    await screen.findByText('The other owner must approve');
    expect(screen.getByLabelText('Coupon code').matches(':disabled')).toBe(true);
    expect(screen.getByLabelText('End date').matches(':disabled')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Check if they agreed' }));
    await askCode(user);
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(bodies[1]).toEqual(bodies[0]);
  });

  it('Start over clears the waiting card and unlocks the fields', async () => {
    server.use(
      http.post('*/platform/coupons/free', ({ request }) =>
        request.headers.get('X-Approval-Token')
          ? err(403, 'APPROVAL_REQUESTED', { requestId: 'req-1' })
          : approvalRequired(),
      ),
    );
    const { user } = setup();
    await fill(user, { percent: '100' });
    await user.click(screen.getByRole('button', { name: 'Ask the other owner' }));
    await askCode(user);
    await user.click(await screen.findByRole('button', { name: 'Start over' }));
    expect(screen.queryByText('The other owner must approve')).toBeNull();
    expect(screen.getByLabelText('Coupon code').matches(':disabled')).toBe(false);
  });
});

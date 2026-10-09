import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LeaveRequestDialog } from './-leave-request-dialog';

afterEach(async () => {
  await cleanupTestState();
});

// The picker opens on the current month, so pick days of *this* month (never a fixed date).
function dayOfThisMonth(day: number): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

async function pickDate(user: ReturnType<typeof userEvent.setup>, label: string, day: number) {
  await user.click(screen.getByLabelText(label));
  await user.click(document.querySelector(`[data-date="${dayOfThisMonth(day)}"]`) as HTMLElement);
}

function rejection(status: number, message: string, details?: Record<string, unknown>) {
  return http.post('/api/v1/leave/requests', () =>
    HttpResponse.json(
      {
        statusCode: status,
        message,
        ...(details ? { details } : {}),
        timestamp: new Date().toISOString(),
        path: '/api/v1/leave/requests',
        requestId: 'req-1',
      },
      { status },
    ),
  );
}

async function renderAndFill(onOpenChange = vi.fn()) {
  const user = userEvent.setup();
  const { localeReady } = renderWithProviders(
    <LeaveRequestDialog open onOpenChange={onOpenChange} staffProfileId="profile-1" />,
    { locale: 'en', tenantId: 'tenant-1' },
  );
  await localeReady;
  await screen.findByLabelText('Start date');
  await pickDate(user, 'Start date', 10);
  await pickDate(user, 'End date', 12);
  return { user, onOpenChange };
}

describe('LeaveRequestDialog', () => {
  it('shows the translated balance sentence, not the server text, when the balance is exceeded', async () => {
    server.use(
      rejection(422, 'Requesting 3 day(s) would exceed the remaining balance of 1', {
        code: 'LEAVE_BALANCE_EXCEEDED',
      }),
    );
    const { user, onOpenChange } = await renderAndFill();

    await user.click(screen.getByRole('button', { name: 'Submit request' }));

    expect(
      await screen.findByText(
        'Not enough days of this leave type left. Pick fewer days or another type.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/would exceed the remaining balance/)).toBeNull();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('shows the generic translated sentence, not the server text, on a 500', async () => {
    server.use(rejection(500, 'duplicate key value violates unique constraint'));
    const { user } = await renderAndFill();

    await user.click(screen.getByRole('button', { name: 'Submit request' }));

    expect(await screen.findByText("Couldn't submit the leave request.")).toBeTruthy();
    expect(screen.queryByText(/duplicate key/)).toBeNull();
  });

  it('sends ISO dates picked through the date pickers and closes on success', async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.post('/api/v1/leave/requests', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          id: 'leave-1',
          staff_profile_id: 'profile-1',
          leave_type: 'CASUAL',
          start_date: dayOfThisMonth(10),
          end_date: dayOfThisMonth(12),
          days: 3,
          status: 'PENDING',
          reason: null,
          approved_by: null,
          decided_at: null,
        });
      }),
    );
    const { user, onOpenChange } = await renderAndFill();

    await user.click(screen.getByRole('button', { name: 'Submit request' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(body).toMatchObject({
      staff_profile_id: 'profile-1',
      leave_type: 'CASUAL',
      start_date: dayOfThisMonth(10),
      end_date: dayOfThisMonth(12),
    });
  });

  it('asks for both dates before sending anything', async () => {
    const user = userEvent.setup();
    const { localeReady } = renderWithProviders(
      <LeaveRequestDialog open onOpenChange={vi.fn()} staffProfileId="profile-1" />,
      { locale: 'en', tenantId: 'tenant-1' },
    );
    await localeReady;

    await user.click(await screen.findByRole('button', { name: 'Submit request' }));

    expect(await screen.findByText('End date must be on or after the start date.')).toBeTruthy();
  });

  it('asks before discarding typed input on Cancel, and keeps the form if you keep editing', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const { localeReady } = renderWithProviders(
      <LeaveRequestDialog open onOpenChange={onOpenChange} staffProfileId="profile-1" />,
      { locale: 'en', tenantId: 'tenant-1' },
    );
    await localeReady;

    await user.type(await screen.findByLabelText('Reason'), 'Family matter');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(await screen.findByText('Discard this request?')).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByLabelText<HTMLTextAreaElement>('Reason').value).toBe('Family matter');
    expect(onOpenChange).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(await screen.findByRole('button', { name: 'Discard' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes straight away on Cancel when nothing was typed', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const { localeReady } = renderWithProviders(
      <LeaveRequestDialog open onOpenChange={onOpenChange} staffProfileId="profile-1" />,
      { locale: 'en', tenantId: 'tenant-1' },
    );
    await localeReady;

    await user.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByText('Discard this request?')).toBeNull();
  });
});

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LeaveRequestDialog } from './-leave-request-dialog';

afterEach(async () => {
  await cleanupTestState();
});

describe('LeaveRequestDialog', () => {
  it('requesting more than the balance shows the server rejection inline', async () => {
    server.use(
      http.post('/api/v1/leave/requests', () =>
        HttpResponse.json(
          {
            statusCode: 400,
            message: 'This request would exceed the remaining CASUAL balance for 2026.',
            timestamp: new Date().toISOString(),
            path: '/api/v1/leave/requests',
            requestId: 'req-1',
          },
          { status: 400 },
        ),
      ),
    );
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    const { localeReady } = renderWithProviders(
      <LeaveRequestDialog open onOpenChange={onOpenChange} staffProfileId="profile-1" />,
      { locale: 'en', tenantId: 'tenant-1' },
    );
    await localeReady;

    await user.type(await screen.findByLabelText('Start date'), '2026-10-01');
    await user.type(screen.getByLabelText('End date'), '2026-10-05');
    await user.click(screen.getByRole('button', { name: 'Submit request' }));

    expect(
      await screen.findByText('This request would exceed the remaining CASUAL balance for 2026.'),
    ).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('a valid request submits and closes the dialog', async () => {
    server.use(
      http.post('/api/v1/leave/requests', () =>
        HttpResponse.json({
          id: 'leave-1',
          staff_profile_id: 'profile-1',
          leave_type: 'CASUAL',
          start_date: '2026-10-01',
          end_date: '2026-10-02',
          days: 2,
          status: 'PENDING',
          reason: null,
          approved_by: null,
          decided_at: null,
        }),
      ),
    );
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    const { localeReady } = renderWithProviders(
      <LeaveRequestDialog open onOpenChange={onOpenChange} staffProfileId="profile-1" />,
      { locale: 'en', tenantId: 'tenant-1' },
    );
    await localeReady;

    await user.type(await screen.findByLabelText('Start date'), '2026-10-01');
    await user.type(screen.getByLabelText('End date'), '2026-10-02');
    await user.click(screen.getByRole('button', { name: 'Submit request' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});

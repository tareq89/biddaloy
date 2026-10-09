import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { pickDate } from '../../../../test/pick-date';

import { PromoteStaffDialog } from './-promote-staff-dialog';

afterEach(async () => {
  await cleanupTestState();
});

function mockDesignations() {
  server.use(
    http.get('/api/v1/designations', () =>
      HttpResponse.json([
        { id: 'd-1', title_en: 'Accountant', title_bn: null, is_teaching: false },
      ]),
    ),
  );
}

describe('PromoteStaffDialog', () => {
  it('requires a designation before submitting', async () => {
    mockDesignations();
    const user = userEvent.setup();
    const { localeReady } = renderWithProviders(
      <PromoteStaffDialog open onOpenChange={vi.fn()} userId="user-1" />,
      { locale: 'en', tenantId: 'tenant-1', role: 'ADMIN' },
    );
    await localeReady;

    await user.click(await screen.findByRole('button', { name: 'Promote' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Please select a designation.');
  });

  it('requires an effective date before submitting', async () => {
    mockDesignations();
    const user = userEvent.setup();
    const { localeReady } = renderWithProviders(
      <PromoteStaffDialog open onOpenChange={vi.fn()} userId="user-1" />,
      { locale: 'en', tenantId: 'tenant-1', role: 'ADMIN' },
    );
    await localeReady;

    await user.click(screen.getByRole('combobox', { name: 'New designation' }));
    await user.click(await screen.findByRole('option', { name: 'Accountant' }));
    await user.click(screen.getByRole('button', { name: 'Promote' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Please select an effective date.');
  });

  it('promotes and closes the dialog on success', async () => {
    mockDesignations();
    let body: unknown;
    server.use(
      http.post('/api/v1/staff-hr-records/user-1/promote', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(
          { id: 'hist-2', user_id: 'user-1', designation_id: 'd-1' },
          { status: 201 },
        );
      }),
    );
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    const { localeReady } = renderWithProviders(
      <PromoteStaffDialog open onOpenChange={onOpenChange} userId="user-1" />,
      { locale: 'en', tenantId: 'tenant-1', role: 'ADMIN' },
    );
    await localeReady;

    await user.click(screen.getByRole('combobox', { name: 'New designation' }));
    await user.click(await screen.findByRole('option', { name: 'Accountant' }));
    await pickDate(user, 'Effective date', '2026-06-01');
    await user.click(screen.getByRole('button', { name: 'Promote' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(body).toEqual({ designation_id: 'd-1', effective_date: '2026-06-01' });
  });

  it('shows a conflict-specific message on a 409', async () => {
    mockDesignations();
    server.use(
      http.post('/api/v1/staff-hr-records/user-1/promote', () =>
        HttpResponse.json(
          { statusCode: 409, message: 'in progress', requestId: 'req-1' },
          { status: 409 },
        ),
      ),
    );
    const user = userEvent.setup();
    const { localeReady } = renderWithProviders(
      <PromoteStaffDialog open onOpenChange={vi.fn()} userId="user-1" />,
      { locale: 'en', tenantId: 'tenant-1', role: 'ADMIN' },
    );
    await localeReady;

    await user.click(screen.getByRole('combobox', { name: 'New designation' }));
    await user.click(await screen.findByRole('option', { name: 'Accountant' }));
    await pickDate(user, 'Effective date', '2026-06-01');
    await user.click(screen.getByRole('button', { name: 'Promote' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      'This staff member already has a designation change on or after that date.',
    );
  });
});

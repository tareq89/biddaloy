import { toast } from '@biddaloy/ui/components';
import {
  cleanupTestState,
  renderWithProviders,
  server,
  userEvent,
  userResponseFactory,
} from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import en from '../../../../../ui/src/i18n/locales/en/staff.json';

import { EditUserDialog } from './-edit-user-dialog';

/** [75.1] A shared person's contact change is held for their approval; the dialog says so. */
describe('EditUserDialog', () => {
  afterEach(cleanupTestState);

  const user = userResponseFactory({
    id: 'user-1',
    full_name: 'Abdul Karim',
    email: 'karim@example.com',
  });

  async function save(response: Record<string, unknown>) {
    server.use(http.patch('/api/v1/users/user-1', () => HttpResponse.json(response)));
    const onOpenChange = vi.fn();
    const toastSpy = vi.spyOn(toast, 'info').mockImplementation(() => '');
    const { localeReady } = renderWithProviders(
      <EditUserDialog open onOpenChange={onOpenChange} user={user} />,
      { locale: 'en', tenantId: 'tenant-1', role: 'ADMIN' },
    );
    await localeReady;
    await userEvent.click(await screen.findByRole('button', { name: en.editUser.save }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    return toastSpy;
  }

  it('shows the pending toast when the server holds the contact change', async () => {
    const toastSpy = await save({ ...user, pending_contact_change: 'phone' });

    expect(toastSpy).toHaveBeenCalledWith(en.editUser.pendingContactChange);
    toastSpy.mockRestore();
  });

  it('shows no toast and closes on a normal save', async () => {
    const toastSpy = await save({ ...user });

    expect(toastSpy).not.toHaveBeenCalled();
    toastSpy.mockRestore();
  });
});

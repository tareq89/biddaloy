import '@biddaloy/ui/test';

import {
  cleanupTestState,
  errorHandler,
  renderWithProviders,
  server,
  schoolsHandlers,
  slowHandler,
} from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { SchoolProfileSection } from './school-profile-section';

describe('SchoolProfileSection', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders the filled profile fields once loaded', async () => {
    renderWithProviders(<SchoolProfileSection />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: 'school-1',
    });

    const nameInput = await screen.findByLabelText<HTMLInputElement>('Name');
    expect(nameInput.value).toBe('Ananta School');
  });

  it('renders "No logo" when the school has none', async () => {
    renderWithProviders(<SchoolProfileSection />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: 'school-1',
    });

    await screen.findByLabelText('Name');
    expect(screen.getByLabelText('No logo')).toBeTruthy();
  });

  it('shows a saving state while the update is in flight', async () => {
    server.use(
      slowHandler(
        'patch',
        '/api/v1/schools/me/profile',
        async ({ request }) => HttpResponse.json(await request.json()),
        200,
      ),
    );

    const { user } = renderWithProviders(<SchoolProfileSection />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: 'school-1',
    });

    const nameInput = await screen.findByLabelText<HTMLInputElement>('Name');
    await user.clear(nameInput);
    await user.type(nameInput, 'New School Name');
    const saveButton = screen.getByRole('button', { name: 'Save' });
    await user.click(saveButton);

    // Button enters a loading state while the (artificially slowed)
    // request is still in flight — checked on the same element reference,
    // since `loading` appends a sr-only "Loading" node that changes the
    // accessible name a fresh `getByRole('button', { name: 'Save' })`
    // query would match against.
    await waitFor(() => {
      expect(saveButton.getAttribute('data-loading')).not.toBe(null);
    });

    await waitFor(() => {
      expect(screen.getByText('Saved')).toBeTruthy();
    });
  });

  it('saves an edit and reflects it back', async () => {
    const { user } = renderWithProviders(<SchoolProfileSection />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: 'school-1',
    });

    const nameInput = await screen.findByLabelText<HTMLInputElement>('Name');
    await user.clear(nameInput);
    await user.type(nameInput, 'Renamed School');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(screen.getByText('Saved')).toBeTruthy();
    });
  });

  it('renders read-only values for a non-ADMIN role, with no save button', async () => {
    renderWithProviders(<SchoolProfileSection />, {
      locale: 'en',
      role: 'TEACHER',
      tenantId: 'school-1',
    });

    await screen.findByText('Ananta School');
    expect(screen.queryByLabelText('Name')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('surfaces an upload error inline under the upload control', async () => {
    server.use(errorHandler('post', '/api/v1/schools/me/logo', 400));

    const { user } = renderWithProviders(<SchoolProfileSection />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: 'school-1',
    });

    await screen.findByLabelText('Name');
    const fileInput = screen.getByLabelText('Upload logo');
    const file = new File(['bytes'], 'logo.png', { type: 'image/png' });
    await user.upload(fileInput, file);

    await waitFor(() => {
      expect(
        screen.getByText(/Couldn't upload that image/i, { selector: '[role="alert"]' }),
      ).toBeTruthy();
    });
  });

  it('rejects an oversized file client-side without calling the server', async () => {
    const { user } = renderWithProviders(<SchoolProfileSection />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: 'school-1',
    });

    await screen.findByLabelText('Name');
    const fileInput = screen.getByLabelText('Upload logo');
    const oversized = new File([new Uint8Array(512 * 1024 + 1)], 'logo.png', {
      type: 'image/png',
    });
    await user.upload(fileInput, oversized);

    await waitFor(() => {
      expect(screen.getByText(/larger than 512KB/i)).toBeTruthy();
    });
  });

  it('shows the logo preview and a remove control when a logo is present', async () => {
    server.use(schoolsHandlers.uploadLogo);
    const { user } = renderWithProviders(<SchoolProfileSection />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: 'school-1',
    });

    await screen.findByLabelText('Name');
    const fileInput = screen.getByLabelText('Upload logo');
    const file = new File(['bytes'], 'logo.png', { type: 'image/png' });
    await user.upload(fileInput, file);

    const removeButton = await screen.findByRole('button', { name: 'Remove logo' });
    await user.click(removeButton);
    expect(screen.getByText('Remove the school logo?')).toBeTruthy();

    const dialog = screen.getByText('Remove the school logo?').closest('div')!;
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));

    await waitFor(() => {
      expect(screen.getByLabelText('No logo')).toBeTruthy();
    });
  });

  it('blocks a new upload while a removal is still in flight', async () => {
    server.use(
      schoolsHandlers.uploadLogo,
      slowHandler(
        'delete',
        '/api/v1/schools/me/logo',
        () => new HttpResponse(null, { status: 204 }),
        300,
      ),
    );
    const { user } = renderWithProviders(<SchoolProfileSection />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: 'school-1',
    });

    await screen.findByLabelText('Name');
    await user.upload(
      screen.getByLabelText('Upload logo'),
      new File(['bytes'], 'logo.png', { type: 'image/png' }),
    );
    await user.click(await screen.findByRole('button', { name: 'Remove logo' }));
    const dialog = screen.getByText('Remove the school logo?').closest('div')!;
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));

    // Both the picker button and its hidden input are disabled until the
    // DELETE settles — the two mutations target the same logo.
    const chooseButton = screen.getByRole('button', { name: 'Upload logo' });
    expect(chooseButton.hasAttribute('disabled')).toBe(true);
    expect(screen.getByLabelText<HTMLInputElement>('Upload logo').disabled).toBe(true);

    // The slow DELETE above returns a bare 204 (it doesn't update the
    // stateful MSW handlers' logo), so the observable "settled" signal here
    // is the picker re-enabling, not the preview clearing.
    await waitFor(() => {
      expect(chooseButton.hasAttribute('disabled')).toBe(false);
    });
  });
});

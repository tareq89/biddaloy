import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { cleanupTestState, renderWithProviders } from '../test/render-with-providers';

import { ProfileForm } from './profile-form';

afterEach(async () => {
  await cleanupTestState();
});

const defaultValues = { full_name: 'Karim Rahman' };

// [12.7] email/phone are gone from this form entirely — see this file's
// own header for why. Its remaining job is just full_name.
describe('ProfileForm', () => {
  it('submits the edited full_name', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<ProfileForm defaultValues={defaultValues} onSubmit={onSubmit} />, {
      locale: 'en',
    });

    const fullName = await screen.findByLabelText('Full name');
    await user.clear(fullName);
    await user.type(fullName, 'Karim Renamed');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ full_name: 'Karim Renamed' }));
  });

  it('blocks submit with an empty full_name', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<ProfileForm defaultValues={defaultValues} onSubmit={onSubmit} />, {
      locale: 'en',
    });

    const fullName = await screen.findByLabelText('Full name');
    await user.clear(fullName);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(screen.getByText('Full name is required')).toBeTruthy());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('renders a server-side full_name error inline', async () => {
    renderWithProviders(
      <ProfileForm
        defaultValues={defaultValues}
        onSubmit={vi.fn()}
        serverError={{ fieldErrors: { full_name: 'Full name must be 100 characters or fewer' } }}
      />,
      { locale: 'en' },
    );

    expect(await screen.findByText('Full name must be 100 characters or fewer')).toBeTruthy();
  });

  it('renders a top-level server error banner', async () => {
    renderWithProviders(
      <ProfileForm
        defaultValues={defaultValues}
        onSubmit={vi.fn()}
        serverError={{ message: 'Could not save your changes. Please try again.' }}
      />,
      { locale: 'en' },
    );

    expect(await screen.findByText('Could not save your changes. Please try again.')).toBeTruthy();
  });
});

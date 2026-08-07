import '@beton-boi/ui/test';

import { cleanupTestState, renderWithProviders } from '@beton-boi/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { SchoolSettingsPage } from './SchoolSettingsPage';

describe('SchoolSettingsPage', () => {
  afterEach(() => {
    cleanupTestState();
  });

  it('shows a school picker for a SUPER_ADMIN, with no school selected by default', async () => {
    renderWithProviders(<SchoolSettingsPage />, {
      locale: 'en',
      role: 'SUPER_ADMIN',
      tenantId: 'tenant-1',
    });

    expect(await screen.findByLabelText('School')).toBeTruthy();
    // No school picked yet — the "which school" banner (the issue's own
    // "unmistakable on screen at all times" criterion) has nothing to
    // show until one is, so it stays absent rather than showing a
    // misleadingly empty/blank state.
    expect(screen.queryByRole('status', { name: /Configuring settings for/ })).toBeNull();
  });

  it('picking a school shows the "configuring" banner and every section', async () => {
    const { user } = renderWithProviders(<SchoolSettingsPage />, {
      locale: 'en',
      role: 'SUPER_ADMIN',
      tenantId: 'tenant-1',
    });

    const picker = await screen.findByLabelText('School');
    await waitFor(() => expect(screen.getByText('Ananta School')).toBeTruthy());
    await user.selectOptions(picker, 'Ananta School');

    await waitFor(() => {
      expect(screen.getByText(/Configuring settings for/)).toBeTruthy();
    });
    expect(await screen.findByText('WhatsApp')).toBeTruthy();
    expect(screen.getByText('Messenger')).toBeTruthy();
    expect(screen.getByText('Email')).toBeTruthy();
    expect(screen.getByText('SMS')).toBeTruthy();
  });

  it('an ADMIN sees no picker at all — their own school loads directly', async () => {
    renderWithProviders(<SchoolSettingsPage />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: 'tenant-1',
    });

    expect(screen.queryByLabelText('School')).toBeNull();
    await waitFor(() => {
      expect(screen.getByText(/Configuring settings for/)).toBeTruthy();
    });
  });

  it('has no accessibility violations with every section rendered', async () => {
    const { container } = renderWithProviders(<SchoolSettingsPage />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: 'tenant-1',
    });

    await waitFor(() => {
      expect(screen.getByText('SMS')).toBeTruthy();
    });
    await expect(container).toHaveNoViolations();
  });
});

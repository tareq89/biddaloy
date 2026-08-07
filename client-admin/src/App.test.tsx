import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import App from './App';

describe('App', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('hides the settings screen entirely from a role without SETTINGS_MANAGE', async () => {
    renderWithProviders(<App />, { role: 'STUDENT', tenantId: 'tenant-1', locale: 'en' });

    await waitFor(() => {
      expect(screen.getByText("You don't have access to this page.")).toBeTruthy();
    });
  });

  it('has no accessibility violations on the access-denied screen', async () => {
    const { container } = renderWithProviders(<App />, {
      role: 'STUDENT',
      tenantId: 'tenant-1',
      locale: 'en',
    });

    await waitFor(() => screen.getByText("You don't have access to this page."));
    await expect(container).toHaveNoViolations();
  });

  it('renders the settings screen for an ADMIN, who holds SETTINGS_MANAGE', async () => {
    renderWithProviders(<App />, { role: 'ADMIN', tenantId: 'tenant-1', locale: 'en' });

    await waitFor(() => {
      expect(screen.getByText('School settings')).toBeTruthy();
    });
    // ADMIN has no school picker — they only ever configure their own tenant.
    expect(screen.queryByLabelText('School')).toBeNull();
  });
});

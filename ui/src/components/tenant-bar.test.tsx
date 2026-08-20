import { UserRole } from '@biddaloy/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { getActiveTenant } from '../api/auth-state';
import { cleanupTestState, renderWithProviders } from '../test/render-with-providers';

import { TenantBar } from './tenant-bar';

afterEach(async () => {
  await cleanupTestState();
});

/** Same shape as `session.test.ts`'s own `fakeJwt` — `decodeAccessTokenMemberships`
 * never checks a signature (see that module's own comment), so a fake
 * `header.payload.signature` with just a `memberships` claim is enough. */
function fakeJwt(memberships: unknown): string {
  const payload = btoa(JSON.stringify({ memberships }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `header.${payload}.signature`;
}

const singleSchool = [{ tenantId: 'tenant-1', role: UserRole.ADMIN, name: 'Greenview School' }];
const twoSchools = [
  { tenantId: 'tenant-1', role: UserRole.ADMIN, name: 'Greenview School' },
  { tenantId: 'tenant-2', role: UserRole.TEACHER, name: 'Rose Valley School' },
];

describe('TenantBar', () => {
  it('renders nothing before an active tenant is set', () => {
    renderWithProviders(<TenantBar />, { accessToken: fakeJwt(twoSchools), locale: 'en' });

    expect(screen.queryByText('Greenview School')).toBeNull();
  });

  it('shows the active school name as persistent text, with no role or switcher for a single membership', async () => {
    renderWithProviders(<TenantBar />, {
      accessToken: fakeJwt(singleSchool),
      tenantId: 'tenant-1',
      locale: 'en',
    });

    expect(await screen.findByText('Greenview School')).toBeTruthy();
    expect(screen.queryByText('Admin')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Switch school' })).toBeNull();
  });

  it('shows the active role and a switch-school menu for multiple memberships', async () => {
    renderWithProviders(<TenantBar />, {
      accessToken: fakeJwt(twoSchools),
      tenantId: 'tenant-1',
      locale: 'en',
    });

    expect(await screen.findByText('Greenview School')).toBeTruthy();
    expect(screen.getByText('Admin')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Switch school' })).toBeTruthy();
  });

  it('is axe clean, including the portaled menu and confirm dialog', async () => {
    const { baseElement, user } = renderWithProviders(<TenantBar />, {
      accessToken: fakeJwt(twoSchools),
      tenantId: 'tenant-1',
      locale: 'en',
    });
    await screen.findByText('Greenview School');

    // Portaled to `document.body` — see `dialog.test.tsx`/`menu.test.tsx`'s
    // own comment on why `baseElement`, not `container`, is what needs to
    // be axe clean.
    await expect(baseElement).toHaveNoViolations();

    await user.click(screen.getByRole('button', { name: 'Switch school' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Rose Valley School' }));
    await screen.findByRole('dialog');

    await expect(baseElement).toHaveNoViolations();
  });

  it('confirming a switch calls switchActiveTenant, updates the chip, and clears the cache', async () => {
    const { queryClient, user } = renderWithProviders(<TenantBar />, {
      accessToken: fakeJwt(twoSchools),
      tenantId: 'tenant-1',
      locale: 'en',
    });
    queryClient.setQueryData(['stale-probe'], { ok: true });
    await screen.findByText('Greenview School');

    await user.click(screen.getByRole('button', { name: 'Switch school' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Rose Valley School' }));
    const dialog = await screen.findByRole('dialog');
    // The dialog's own confirm button shares its accessible name ("Switch
    // school") with the always-visible menu trigger — `within(dialog)`
    // disambiguates, same as any other same-label-different-container case.
    await user.click(within(dialog).getByRole('button', { name: 'Switch school' }));

    await waitFor(() => expect(getActiveTenant()).toBe('tenant-2'));
    expect(await screen.findByText('Rose Valley School')).toBeTruthy();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it('cancelling the confirm dialog leaves the active tenant unchanged', async () => {
    const { user } = renderWithProviders(<TenantBar />, {
      accessToken: fakeJwt(twoSchools),
      tenantId: 'tenant-1',
      locale: 'en',
    });
    await screen.findByText('Greenview School');

    await user.click(screen.getByRole('button', { name: 'Switch school' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Rose Valley School' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(getActiveTenant()).toBe('tenant-1');
    expect(screen.getByText('Greenview School')).toBeTruthy();
  });
});

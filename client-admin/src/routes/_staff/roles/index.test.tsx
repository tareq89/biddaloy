import { STAFF_ROLES, UserRole } from '@biddaloy/shared';
import { cleanupTestState, renderWithRouter } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

afterEach(async () => {
  await cleanupTestState();
});

describe('/roles', () => {
  it('renders one card per assignable staff role, in D23 order, under a Roles & access heading', async () => {
    renderWithRouter(routeTree, {
      initialEntries: ['/roles'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    expect(await screen.findByRole('heading', { level: 1, name: 'Roles & access' })).toBeTruthy();
    // Every staff role except SUPER_ADMIN (platform-only, #731) gets a card,
    // so a role added to STAFF_ROLES later cannot silently miss the page.
    for (const role of STAFF_ROLES.filter((r) => r !== UserRole.SUPER_ADMIN)) {
      expect(await screen.findByTestId(`role-card-${role}`)).toBeTruthy();
    }
    expect(screen.queryByTestId(`role-card-${UserRole.SUPER_ADMIN}`)).toBeNull();
    const order = screen
      .getAllByTestId(/^role-card-/)
      .map((el) => el.getAttribute('data-testid')!.replace('role-card-', ''));
    // D23 (ROLE_PRIORITY) order, highest first.
    expect(order).toEqual([
      UserRole.ADMIN,
      UserRole.ACCOUNTANT,
      UserRole.EXECUTIVE,
      UserRole.TEACHER,
      UserRole.EXAM_CONTROLLER,
      UserRole.OFFICE_STAFF,
      UserRole.COMMITTEE,
    ]);
    expect(screen.getByRole('heading', { name: 'Academic coordinator' })).toBeTruthy();
  });

  it('refuses a role without USER_READ', async () => {
    renderWithRouter(routeTree, {
      initialEntries: ['/roles'],
      tenantId: 'tenant-1',
      role: 'COMMITTEE',
      locale: 'en',
    });

    // Wait for the RequirePermission denied state itself, so the assertion
    // below cannot run before the loader would have rendered the cards.
    expect(await screen.findByText("You don't have access to this page.")).toBeTruthy();
    expect(screen.queryByTestId('role-card-ADMIN')).toBeNull();
  });
});

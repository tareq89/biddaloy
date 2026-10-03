import { STAFF_ROLES } from '@biddaloy/shared';
import { cleanupTestState, renderWithRouter } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

afterEach(async () => {
  await cleanupTestState();
});

describe('/roles', () => {
  it('renders one card per staff role under a Roles & access heading', async () => {
    renderWithRouter(routeTree, {
      initialEntries: ['/roles'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    expect(await screen.findByRole('heading', { level: 1, name: 'Roles & access' })).toBeTruthy();
    for (const role of STAFF_ROLES) {
      expect(await screen.findByTestId(`role-card-${role}`)).toBeTruthy();
    }
    expect(screen.getByRole('heading', { name: 'Academic coordinator' })).toBeTruthy();
  });

  it('refuses a role without USER_READ', async () => {
    renderWithRouter(routeTree, {
      initialEntries: ['/roles'],
      tenantId: 'tenant-1',
      role: 'COMMITTEE',
      locale: 'en',
    });

    await screen.findByRole('main');
    expect(screen.queryByTestId('role-card-ADMIN')).toBeNull();
  });
});

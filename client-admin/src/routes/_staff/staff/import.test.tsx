import { UserRole } from '@biddaloy/shared';
import { cleanupTestState, renderWithRouter } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

describe('/staff/import', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('mounts the staff import for an ADMIN', async () => {
    renderWithRouter(routeTree, {
      initialEntries: ['/staff/import'],
      tenantId: 'tenant-1',
      role: UserRole.ADMIN,
      locale: 'en',
    });

    expect(await screen.findByRole('heading', { name: 'Import staff from Excel' })).toBeTruthy();
  });
});

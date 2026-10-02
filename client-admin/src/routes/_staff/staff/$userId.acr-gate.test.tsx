import { Permission } from '@biddaloy/shared';
import { cleanupTestState, renderWithRouter, server, userResponseFactory } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

// No real role has USER_READ without ACR_READ, so the gate is exercised by
// denying just ACR_READ.
vi.mock('@biddaloy/ui/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@biddaloy/ui/hooks')>();
  return {
    ...actual,
    useHasPermission: (p: Permission) => p !== Permission.ACR_READ && actual.useHasPermission(p),
  };
});

afterEach(async () => {
  await cleanupTestState();
});

describe('staff detail ACR/Incidents tabs', () => {
  it('are hidden without ACR_READ', async () => {
    const user = userResponseFactory({ id: 'user-1', role: 'TEACHER' });
    server.use(
      http.get('/api/v1/users/:id', () => HttpResponse.json(user)),
      http.get('/api/v1/teachers', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 1, totalPages: 0 }),
      ),
    );
    renderWithRouter(routeTree, {
      initialEntries: ['/staff/user-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
    await screen.findByRole('tab', { name: 'Profile' });
    expect(screen.queryByRole('tab', { name: 'ACR' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Incidents' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Performance' })).toBeNull();
  });
});

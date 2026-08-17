import { authHandlers, cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../routeTree.gen';

describe('/login', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders the stub heading and explanation', async () => {
    server.use(authHandlers.refreshFailure);

    renderWithRouter(routeTree, { initialEntries: ['/login'], tenantId: 'tenant-1', locale: 'en' });

    await waitFor(() => expect(screen.getByText('Log in')).toBeTruthy());
    expect(screen.getByText('The login form has not been built yet.')).toBeTruthy();
  });

  it('has no accessibility violations', async () => {
    server.use(authHandlers.refreshFailure);

    const { container } = renderWithRouter(routeTree, {
      initialEntries: ['/login'],
      tenantId: 'tenant-1',
      locale: 'en',
    });

    await waitFor(() => screen.getByText('Log in'));
    await expect(container).toHaveNoViolations();
  });

  it('a `redirect` search param outside the app is dropped, not carried through', async () => {
    server.use(authHandlers.refreshFailure);

    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/login?redirect=//evil.com'],
      tenantId: 'tenant-1',
      locale: 'en',
    });

    await waitFor(() => expect(screen.getByText('Log in')).toBeTruthy());
    expect(router.state.location.search).toEqual({});
  });
});

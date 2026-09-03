/**
 * [8.14.13]'s fees hub — real route tree, same reasoning `dues.test.tsx`'s
 * own header comment gives for itself. `/fees` is now a permission-gated
 * set of cards rather than the old `/settings`-redirect `EmptyState`, so
 * this covers "no dead end" for every card and confirms the route-level
 * `FEE_STRUCTURE_READ` gate (not a page-level empty state) is what keeps a
 * role without it off the page.
 */
import { cleanupTestState, renderWithRouter } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

describe('/fees', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders a card linking to every fee-related destination for a role that holds all four permissions', async () => {
    renderWithRouter(routeTree, {
      initialEntries: ['/fees'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Fees' })).toBeTruthy());

    expect(screen.getByRole('link', { name: /Dues queue/ }).getAttribute('href')).toBe(
      '/fees/dues',
    );
    expect(screen.getByRole('link', { name: /Generate invoices/ }).getAttribute('href')).toBe(
      '/fees/generate',
    );
    expect(screen.getByRole('link', { name: /Fee structures/ }).getAttribute('href')).toBe(
      '/fee-structures',
    );
    expect(
      screen.getByRole('link', { name: /Browse every invoice issued so far/ }).getAttribute('href'),
    ).toBe('/invoices');
  });

  it('renders the Bangla hub copy for the bn locale', async () => {
    renderWithRouter(routeTree, {
      initialEntries: ['/fees'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'bn',
    });

    await waitFor(() => expect(screen.getByRole('heading', { name: 'ফি' })).toBeTruthy());
    expect(screen.getByRole('link', { name: /বকেয়া তালিকা/ }).getAttribute('href')).toBe(
      '/fees/dues',
    );
  });

  it('denies access at the route level for a role without FEE_STRUCTURE_READ, never rendering the old /settings redirect', async () => {
    renderWithRouter(routeTree, {
      initialEntries: ['/fees'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Fees' })).toBeNull());
    expect(screen.queryByRole('link', { name: /Go to settings/ })).toBeNull();
  });
});

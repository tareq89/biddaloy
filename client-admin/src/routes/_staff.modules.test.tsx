import { UserRole } from '@biddaloy/shared';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../routeTree.gen';

/**
 * [77.3.1] `_staff.tsx` hides an off module from the sidebar (D16) and shows
 * the refusal page on its URL (D32). The server refuses the same URL either way.
 */
function profile(school: object) {
  server.use(
    http.get('/api/v1/schools/me/profile', () =>
      HttpResponse.json({ modules: { platform: {}, school }, labels: {} }),
    ),
  );
}

const REFUSAL = 'This part is not turned on for your institution';

describe('_staff module gate [77.3.1]', () => {
  afterEach(async () => {
    window.localStorage.clear();
    await cleanupTestState();
  });

  it('ADMIN at an off module URL sees the refusal with a Turn on link', async () => {
    profile({ fines: { on: false } });
    renderWithRouter(routeTree, {
      initialEntries: ['/fees/fines'],
      tenantId: 'tenant-1',
      role: UserRole.ADMIN,
      locale: 'en',
    });

    expect(await screen.findByText(REFUSAL)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Turn on' }).getAttribute('href')).toBe(
      '/settings?section=modulesWords',
    );
  });

  it('TEACHER with homework role-off gets "Ask your admin" and no link', async () => {
    profile({ homework: { offForRoles: [UserRole.TEACHER] } });
    renderWithRouter(routeTree, {
      initialEntries: ['/academics/homework'],
      tenantId: 'tenant-1',
      role: UserRole.TEACHER,
      locale: 'en',
    });

    expect(await screen.findByText(REFUSAL)).toBeTruthy();
    expect(screen.getByText('Ask your admin')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Turn on' })).toBeNull();
  });

  it('ADMIN is never role-off: homework still opens', async () => {
    profile({ homework: { offForRoles: [UserRole.TEACHER] } });
    renderWithRouter(routeTree, {
      initialEntries: ['/academics/homework'],
      tenantId: 'tenant-1',
      role: UserRole.ADMIN,
      locale: 'en',
    });

    await screen.findAllByRole('link', { name: 'Homework' });
    expect(screen.queryByText(REFUSAL)).toBeNull();
  });

  it('a core route never shows the refusal, and an off module leaves the sidebar', async () => {
    profile({ fines: { on: false } });
    window.localStorage.setItem('nav-group-collapsed-v2:finance', 'false'); // groups start collapsed
    renderWithRouter(routeTree, {
      initialEntries: ['/students'],
      tenantId: 'tenant-1',
      role: UserRole.ADMIN,
      locale: 'en',
    });

    // Fines (off) is gone; Student dues (fees on) is still listed.
    await waitFor(() =>
      expect(screen.getAllByRole('link', { name: 'Student dues' })).not.toHaveLength(0),
    );
    expect(screen.queryByRole('link', { name: 'Fines' })).toBeNull();
    expect(screen.queryByText(REFUSAL)).toBeNull();
  });
});

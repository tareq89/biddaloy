/**
 * [13.5] The trial-ended screen as the real app wires it: the router's
 * `defaultErrorComponent` over the real route tree, so an unwired prop fails here.
 */
import { cleanupTestState, renderWithRouter } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RouteErrorFallbackWithUpdate } from './route-error-fallback';
import { routeTree } from './routeTree.gen';

vi.mock('./pwa/register', () => ({ reloadForUpdate: vi.fn() }));
// The dashboard's one data-driven piece, made to fail the way every
// school-scoped request does once the trial has ended.
vi.mock('./components/upcoming-calendar-card', () => ({
  UpcomingCalendarCard: () => {
    throw Object.assign(new Error('This school has been suspended'), {
      statusCode: 403,
      details: { code: 'TENANT_SUSPENDED', reason: 'TRIAL_EXPIRED' },
    });
  },
}));

function fakeJwt(memberships: unknown): string {
  const payload = btoa(JSON.stringify({ memberships }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `header.${payload}.signature`;
}

const twoSchools = [
  { tenantId: 'tenant-1', role: 'ADMIN', name: 'Greenview School' },
  { tenantId: 'tenant-2', role: 'TEACHER', name: 'Rose Valley School' },
];

function renderExpiredDashboard() {
  return renderWithRouter(routeTree, {
    initialEntries: ['/dashboard'],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    accessToken: fakeJwt(twoSchools),
    locale: 'en',
    defaultErrorComponent: RouteErrorFallbackWithUpdate,
  });
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await cleanupTestState();
});

describe('trial-ended screen in the app', () => {
  it('links "Contact us" to VITE_SUPPORT_URL', async () => {
    vi.stubEnv('VITE_SUPPORT_URL', 'https://example.com/help');
    renderExpiredDashboard();

    expect(await screen.findByRole('heading', { name: 'Your trial has ended' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Contact us' }).getAttribute('href')).toBe(
      'https://example.com/help',
    );
  });
});

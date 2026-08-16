import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LINK_KEYS, expectKeyboardOperable } from '../test/a11y';
import { renderWithRouter } from '../test/render-with-router';

import { AppShell } from './app-shell';

const navItems = [
  { to: '/', label: 'Dashboard' },
  { to: '/students', label: 'Students' },
  { to: '/settings', label: 'Settings' },
];

function buildRouteTree() {
  const rootRoute = createRootRoute();
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => (
      <AppShell navItems={navItems} brand="Biddaloy">
        <p>Dashboard content</p>
      </AppShell>
    ),
  });
  const studentsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/students',
    component: () => (
      <AppShell navItems={navItems} brand="Biddaloy">
        <p>Students content</p>
      </AppShell>
    ),
  });
  return rootRoute.addChildren([indexRoute, studentsRoute]);
}

describe('AppShell', () => {
  it('renders every nav item as a link, and the active-route content', async () => {
    renderWithRouter(buildRouteTree(), { initialEntries: ['/students'] });

    expect(await screen.findByRole('link', { name: 'Dashboard' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Students' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Settings' })).toBeTruthy();
    expect(screen.getByText('Students content')).toBeTruthy();
  });

  it('marks the current route link with aria-current="page"', async () => {
    renderWithRouter(buildRouteTree(), { initialEntries: ['/students'] });

    const activeLink = await screen.findByRole('link', { name: 'Students' });
    expect(activeLink.getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Dashboard' }).getAttribute('aria-current')).toBeNull();
  });

  it('every nav link is reachable and activatable by keyboard', async () => {
    renderWithRouter(buildRouteTree(), { initialEntries: ['/students'] });

    const link = await screen.findByRole('link', { name: 'Dashboard' });
    await expectKeyboardOperable(link, { keys: LINK_KEYS });
  });

  it('is axe clean', async () => {
    const { container } = renderWithRouter(buildRouteTree(), { initialEntries: ['/students'] });
    await screen.findByText('Students content');
    await expect(container).toHaveNoViolations();
  });
});

import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderWithRouter } from '../test/render-with-router';

import { useDetailShellTab } from './use-detail-shell-tab';

const TABS = ['overview', 'payments', 'documents'] as const;

function Probe() {
  const [activeTab, setTab] = useDetailShellTab(TABS);
  return (
    <div>
      <p>active: {activeTab}</p>
      <button onClick={() => setTab('payments')}>Go to payments</button>
      <button onClick={() => setTab('nonexistent')}>Go to an unknown tab</button>
    </div>
  );
}

function buildRouteTree() {
  const rootRoute = createRootRoute();
  const studentRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/students/1',
    component: Probe,
  });
  return rootRoute.addChildren([studentRoute]);
}

// TanStack Router's initial route match resolves asynchronously — see
// `use-list-url-state.test.tsx`'s own comment for why every test here
// awaits the first thing it looks for.
describe('useDetailShellTab', () => {
  it('falls back to the first tab when ?tab= is absent', async () => {
    renderWithRouter(buildRouteTree(), { initialEntries: ['/students/1'] });
    expect(await screen.findByText('active: overview')).toBeTruthy();
  });

  it('reads a valid ?tab= from the URL', async () => {
    renderWithRouter(buildRouteTree(), { initialEntries: ['/students/1?tab=payments'] });
    expect(await screen.findByText('active: payments')).toBeTruthy();
  });

  it('falls back to the first tab for an unknown ?tab= value rather than rendering nothing', async () => {
    renderWithRouter(buildRouteTree(), { initialEntries: ['/students/1?tab=nonexistent'] });
    expect(await screen.findByText('active: overview')).toBeTruthy();
  });

  it('setTab writes ?tab= into the URL and survives a refresh (re-mount at the same URL)', async () => {
    const user = userEvent.setup();
    const { router, unmount } = renderWithRouter(buildRouteTree(), {
      initialEntries: ['/students/1'],
    });
    await user.click(await screen.findByRole('button', { name: 'Go to payments' }));
    expect(router.state.location.searchStr).toContain('tab=payments');

    const urlAfterUpdate = router.state.location.href;
    unmount();
    renderWithRouter(buildRouteTree(), { initialEntries: [urlAfterUpdate] });
    expect(await screen.findByText('active: payments')).toBeTruthy();
  });

  it('setTab ignores a tab id that is not in tabIds, rather than writing a stale value into the URL', async () => {
    const user = userEvent.setup();
    const { router } = renderWithRouter(buildRouteTree(), {
      initialEntries: ['/students/1?tab=payments'],
    });

    await user.click(await screen.findByRole('button', { name: 'Go to an unknown tab' }));

    expect(router.state.location.searchStr).toContain('tab=payments');
    expect(router.state.location.searchStr).not.toContain('nonexistent');
    expect(screen.getByText('active: payments')).toBeTruthy();
  });
});

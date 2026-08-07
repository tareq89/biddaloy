import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RouteObject } from 'react-router';
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

const routes: RouteObject[] = [{ path: '/students/1', element: <Probe /> }];

describe('useDetailShellTab', () => {
  it('falls back to the first tab when ?tab= is absent', () => {
    renderWithRouter(routes, { initialEntries: ['/students/1'] });
    expect(screen.getByText('active: overview')).toBeTruthy();
  });

  it('reads a valid ?tab= from the URL', () => {
    renderWithRouter(routes, { initialEntries: ['/students/1?tab=payments'] });
    expect(screen.getByText('active: payments')).toBeTruthy();
  });

  it('falls back to the first tab for an unknown ?tab= value rather than rendering nothing', () => {
    renderWithRouter(routes, { initialEntries: ['/students/1?tab=nonexistent'] });
    expect(screen.getByText('active: overview')).toBeTruthy();
  });

  it('setTab writes ?tab= into the URL and survives a refresh (re-mount at the same URL)', async () => {
    const user = userEvent.setup();
    const { router, unmount } = renderWithRouter(routes, { initialEntries: ['/students/1'] });
    await user.click(screen.getByRole('button', { name: 'Go to payments' }));
    expect(router.state.location.search).toContain('tab=payments');

    unmount();
    renderWithRouter(routes, { initialEntries: [`/students/1${router.state.location.search}`] });
    expect(screen.getByText('active: payments')).toBeTruthy();
  });

  it('setTab ignores a tab id that is not in tabIds, rather than writing a stale value into the URL', async () => {
    const user = userEvent.setup();
    const { router } = renderWithRouter(routes, { initialEntries: ['/students/1?tab=payments'] });

    await user.click(screen.getByRole('button', { name: 'Go to an unknown tab' }));

    expect(router.state.location.search).toContain('tab=payments');
    expect(router.state.location.search).not.toContain('nonexistent');
    expect(screen.getByText('active: payments')).toBeTruthy();
  });
});

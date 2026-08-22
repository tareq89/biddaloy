import { createRootRoute, createRoute, Link, Outlet } from '@tanstack/react-router';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { RouteAnnouncer } from '../components/route-announcer';
import { renderWithRouter } from '../test/render-with-router';

import { useRouteFocus } from './use-route-focus';

/**
 * Local route tree, same reasoning as `../routes/router-integration.test.tsx`'s
 * own — a hook whose whole job is reacting to real router navigation
 * needs a real route tree to navigate, not a synthetic prop change.
 */
const MAIN_ID = 'test-main-content';

function RootLayout() {
  const announcement = useRouteFocus({ mainId: MAIN_ID, appName: 'TestApp' });
  return (
    <div>
      <RouteAnnouncer message={announcement} />
      <main id={MAIN_ID} tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}

function ListPage() {
  return (
    <div>
      <h1>List</h1>
      <Link to="/detail" data-focus-anchor="row-1">
        Row one
      </Link>
    </div>
  );
}

function DetailPage() {
  return <h1>Detail</h1>;
}

function BlankPage() {
  return <p>No heading on this route</p>;
}

function OtherListPage() {
  return <h1>List</h1>;
}

const rootRoute = createRootRoute({ component: RootLayout });
const listRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/list',
  component: ListPage,
});
const otherListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/other-list',
  component: OtherListPage,
});
const detailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/detail',
  component: DetailPage,
});
const blankRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/blank',
  component: BlankPage,
});
const routeTree = rootRoute.addChildren([listRoute, otherListRoute, detailRoute, blankRoute]);

describe('useRouteFocus', () => {
  it("sets document.title from the route's <h1> on initial mount, without stealing focus", async () => {
    renderWithRouter(routeTree, { initialEntries: ['/list'], tenantId: 'tenant-1' });

    await waitFor(() => expect(document.title).toBe('List · TestApp'));
    expect(document.activeElement).toBe(document.body);
  });

  it("moves focus to the new route's <h1>, updates the title, and announces it, on navigation", async () => {
    const user = userEvent.setup();
    const { container } = renderWithRouter(routeTree, {
      initialEntries: ['/list'],
      tenantId: 'tenant-1',
    });

    await waitFor(() => screen.getByRole('heading', { name: 'List' }));
    await user.click(screen.getByRole('link', { name: 'Row one' }));

    await waitFor(() => expect(document.title).toBe('Detail · TestApp'));
    const heading = await screen.findByRole('heading', { name: 'Detail' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(container.querySelector('[data-slot="route-announcer"]')?.textContent).toBe('Detail');
  });

  it('falls back to focusing the main landmark when the new route has no <h1>', async () => {
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/list'],
      tenantId: 'tenant-1',
    });
    await waitFor(() => screen.getByRole('heading', { name: 'List' }));

    act(() => {
      void router.navigate({ to: '/blank' });
    });

    await waitFor(() => screen.getByText('No heading on this route'));
    await waitFor(() => expect((document.activeElement as HTMLElement | null)?.id).toBe(MAIN_ID));
  });

  it('restores focus to the clicked data-focus-anchor element on BACK navigation, not the heading', async () => {
    const user = userEvent.setup();
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/list'],
      tenantId: 'tenant-1',
    });
    await waitFor(() => screen.getByRole('heading', { name: 'List' }));

    await user.click(screen.getByRole('link', { name: 'Row one' }));
    await waitFor(() => screen.getByRole('heading', { name: 'Detail' }));

    act(() => {
      router.history.back();
    });

    const row = await screen.findByRole('link', { name: 'Row one' });
    await waitFor(() => expect(document.activeElement).toBe(row));
  });

  it("re-announces the route change even when the new route's <h1> repeats the previous route's text", async () => {
    const { container, router } = renderWithRouter(routeTree, {
      initialEntries: ['/list'],
      tenantId: 'tenant-1',
    });
    await waitFor(() => screen.getByRole('heading', { name: 'List' }));
    const announcer = () => container.querySelector('[data-slot="route-announcer"]');

    // First hop to a same-heading route just to get the announcement into
    // its 'List' state via a real (non-cold-load) route change, matching
    // what the second hop below needs to reproduce: a route change whose
    // new heading equals the *already-announced* text, not just the
    // initial (never-announced) state.
    act(() => {
      void router.navigate({ to: '/other-list' });
    });
    await waitFor(() => screen.getByRole('heading', { name: 'List' }));
    await waitFor(() => expect(announcer()?.textContent).toBe('List'));

    // `/list`'s <h1> is the same text as `/other-list`'s — a naive
    // `setAnnouncement(headingText)` would be a no-op React update here,
    // leaving the live region's `textContent` unchanged and silently
    // dropping the announcement. A screen reader only announces a
    // *mutation*, so the fix must actually change `textContent` (e.g.
    // clear it) somewhere in the transition — record every mutation to
    // prove that happens, not just that the text ends up back at 'List'.
    const textMutations: (string | null)[] = [];
    const observer = new MutationObserver(() => {
      textMutations.push(announcer()?.textContent ?? null);
    });
    observer.observe(container, { childList: true, subtree: true, characterData: true });

    act(() => {
      void router.navigate({ to: '/list' });
    });

    await waitFor(() => screen.getByRole('link', { name: 'Row one' }));
    await waitFor(() => expect(announcer()?.textContent).toBe('List'));
    observer.disconnect();

    expect(textMutations).toContain('');
  });
});

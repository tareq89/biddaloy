import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { renderWithRouter } from '../test/render-with-router';

import { useListUrlState } from './use-list-url-state';

function Probe({ defaults }: { defaults?: { page?: number; limit?: number } }) {
  const [state, update] = useListUrlState(defaults);
  return (
    <div>
      <p>page: {state.page}</p>
      <p>limit: {state.limit}</p>
      <p>order: {state.order}</p>
      <p>sort: {state.sort ?? 'none'}</p>
      <button onClick={() => update({ limit: 25 })}>Set limit</button>
      <button onClick={() => update({ order: 'desc' })}>Sort descending</button>
      <button onClick={() => update({ filters: { page: '999', order: 'desc', class_id: 'c-1' } })}>
        Set filters including a reserved key
      </button>
      <button onClick={() => update({ sort: null, order: null })}>Clear sort</button>
    </div>
  );
}

function buildRouteTree(component: () => ReactElement) {
  const rootRoute = createRootRoute();
  const studentsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/students',
    component,
  });
  return rootRoute.addChildren([studentsRoute]);
}

const routeTree = buildRouteTree(() => <Probe />);

// TanStack Router's initial route match resolves asynchronously — unlike
// react-router's `createMemoryRouter`, which matches synchronously on
// construction — so every test below awaits the first thing it looks for
// (`findByText`/`findByRole`) rather than asserting synchronously right
// after `renderWithRouter()`. Once that first await settles, the route
// has matched and later same-render assertions can use the synchronous
// `getBy*` queries as usual.
describe('useListUrlState', () => {
  it('falls back to limit 10 when no default and no URL value are given', async () => {
    renderWithRouter(routeTree, { initialEntries: ['/students'] });

    expect(await screen.findByText('limit: 10')).toBeTruthy();
  });

  it('defaults order to asc when absent from the URL', async () => {
    renderWithRouter(routeTree, { initialEntries: ['/students'] });
    expect(await screen.findByText('order: asc')).toBeTruthy();
  });

  it('reads order=desc from the URL, and treats anything else as asc', async () => {
    renderWithRouter(routeTree, { initialEntries: ['/students?order=desc'] });
    expect(await screen.findByText('order: desc')).toBeTruthy();

    renderWithRouter(routeTree, { initialEntries: ['/students?order=garbage'] });
    expect((await screen.findAllByText('order: asc')).length).toBeGreaterThan(0);
  });

  it('update({ order }) writes order into the URL', async () => {
    const user = userEvent.setup();
    const { router } = renderWithRouter(routeTree, { initialEntries: ['/students'] });
    await user.click(await screen.findByRole('button', { name: 'Sort descending' }));
    expect(router.state.location.searchStr).toContain('order=desc');
  });

  it('honours a caller-supplied default limit', async () => {
    renderWithRouter(
      buildRouteTree(() => <Probe defaults={{ limit: 25 }} />),
      { initialEntries: ['/students'] },
    );

    expect(await screen.findByText('limit: 25')).toBeTruthy();
  });

  it('update({ limit }) writes limit into the URL and preserves the params already there', async () => {
    // Seeded with page/sort/filter already set — asserting only rendered
    // state (as an earlier version of this test did) could pass even if
    // `update()` wrote to local component state instead of the URL. This
    // asserts against the actual URL via `router.state.location.searchStr`.
    const user = userEvent.setup();
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/students?page=3&sort=full_name&class_id=c-9'],
    });

    await user.click(await screen.findByRole('button', { name: 'Set limit' }));

    expect(router.state.location.searchStr).toContain('limit=25');
    expect(router.state.location.searchStr).toContain('page=3');
    expect(router.state.location.searchStr).toContain('sort=full_name');
    expect(router.state.location.searchStr).toContain('class_id=c-9');
  });

  it('a reserved key inside patch.filters cannot overwrite the real page/limit/sort params', async () => {
    const user = userEvent.setup();
    const { router } = renderWithRouter(routeTree, { initialEntries: ['/students?page=3'] });

    await user.click(
      await screen.findByRole('button', { name: 'Set filters including a reserved key' }),
    );

    // The 'page'/'order' keys inside filters must not have won over the
    // real params — only the non-reserved 'class_id' filter should apply.
    expect(router.state.location.searchStr).toContain('page=3');
    expect(router.state.location.searchStr).not.toContain('page=999');
    expect(router.state.location.searchStr).not.toContain('order=desc');
    expect(router.state.location.searchStr).toContain('class_id=c-1');
  });

  it('update({ sort: null, order: null }) removes both params instead of leaving them empty', async () => {
    const user = userEvent.setup();
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/students?sort=full_name&order=desc'],
    });

    await user.click(await screen.findByRole('button', { name: 'Clear sort' }));

    expect(router.state.location.searchStr).not.toContain('sort=');
    expect(router.state.location.searchStr).not.toContain('order=');
    expect(await screen.findByText('sort: none')).toBeTruthy();
    expect(screen.getByText('order: asc')).toBeTruthy();
  });
});

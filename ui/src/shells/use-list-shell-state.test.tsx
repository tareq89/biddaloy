import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderWithRouter } from '../test/render-with-router';

import { useListShellState } from './use-list-shell-state';

function Probe() {
  const [state, actions] = useListShellState({ limit: 20 });
  return (
    <div>
      <p>page: {state.page}</p>
      <p>limit: {state.limit}</p>
      <p>
        sort:{' '}
        {state.sorting ? `${state.sorting.id}:${state.sorting.desc ? 'desc' : 'asc'}` : 'none'}
      </p>
      <p>class_id: {state.filters.class_id ?? 'none'}</p>
      <p>
        selected: {state.selectedIds.size === 0 ? 'none' : Array.from(state.selectedIds).join(',')}
      </p>
      <button onClick={() => actions.setPage(5)}>Go to page 5</button>
      <button onClick={() => actions.setSorting({ id: 'due_date', desc: true })}>
        Sort by due date
      </button>
      <button onClick={() => actions.setSorting(null)}>Clear sorting</button>
      <button onClick={() => actions.setFilters({ class_id: 'class-9' })}>Filter class-9</button>
      <button onClick={() => actions.setSelectedIds(new Set(['s1', 's2']))}>
        Select two students
      </button>
      <button onClick={() => actions.setSelectedIds(new Set())}>Clear selection</button>
      <button onClick={() => actions.setLimit(20)}>Set limit 20</button>
    </div>
  );
}

function buildRouteTree() {
  const rootRoute = createRootRoute();
  const studentsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/students',
    component: Probe,
  });
  return rootRoute.addChildren([studentsRoute]);
}

// TanStack Router's initial route match resolves asynchronously — see
// `use-list-url-state.test.tsx`'s own comment for why every test here
// awaits the first thing it looks for.
describe('useListShellState', () => {
  it('reads sort/order from the URL as a DataTableSort', async () => {
    renderWithRouter(buildRouteTree(), { initialEntries: ['/students?sort=due_date&order=desc'] });
    expect(await screen.findByText('sort: due_date:desc')).toBeTruthy();
  });

  it('has no sorting when neither sort nor order is in the URL', async () => {
    renderWithRouter(buildRouteTree(), { initialEntries: ['/students'] });
    expect(await screen.findByText('sort: none')).toBeTruthy();
  });

  it('setSorting writes both sort and order into the URL, and resets to page 1', async () => {
    const user = userEvent.setup();
    const { router } = renderWithRouter(buildRouteTree(), { initialEntries: ['/students?page=3'] });
    await user.click(await screen.findByRole('button', { name: 'Sort by due date' }));
    expect(router.state.location.searchStr).toContain('sort=due_date');
    expect(router.state.location.searchStr).toContain('order=desc');
    expect(router.state.location.searchStr).toContain('page=1');
  });

  it('setSorting(null) clears sort and order from the URL rather than being a no-op', async () => {
    const user = userEvent.setup();
    const { router } = renderWithRouter(buildRouteTree(), {
      initialEntries: ['/students?sort=due_date&order=desc'],
    });
    expect(await screen.findByText('sort: due_date:desc')).toBeTruthy();

    await user.click(await screen.findByRole('button', { name: 'Clear sorting' }));

    await screen.findByText('sort: none');
    expect(router.state.location.searchStr).not.toContain('sort=');
    expect(router.state.location.searchStr).not.toContain('order=');
  });

  it('setFilters resets page to 1 — the acceptance criterion', async () => {
    const user = userEvent.setup();
    const { router } = renderWithRouter(buildRouteTree(), { initialEntries: ['/students?page=4'] });
    await user.click(await screen.findByRole('button', { name: 'Filter class-9' }));
    await screen.findByText('class_id: class-9');
    expect(router.state.location.searchStr).toContain('page=1');
  });

  it('reads selection from the URL and setSelectedIds writes it back', async () => {
    const user = userEvent.setup();
    renderWithRouter(buildRouteTree(), { initialEntries: ['/students'] });
    expect(await screen.findByText('selected: none')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Select two students' }));
    await screen.findByText('selected: s1,s2');
  });

  it('setSelectedIds(new Set()) clears the selection back to none', async () => {
    const user = userEvent.setup();
    renderWithRouter(buildRouteTree(), { initialEntries: ['/students?selected=s1,s2'] });
    expect(await screen.findByText('selected: s1,s2')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Clear selection' }));

    await screen.findByText('selected: none');
  });

  it('a filter change preserves the current selection rather than clearing it', async () => {
    const user = userEvent.setup();
    renderWithRouter(buildRouteTree(), { initialEntries: ['/students'] });

    await user.click(await screen.findByRole('button', { name: 'Select two students' }));
    await screen.findByText('selected: s1,s2');

    await user.click(screen.getByRole('button', { name: 'Filter class-9' }));
    await screen.findByText('class_id: class-9');
    expect(screen.getByText('selected: s1,s2')).toBeTruthy();
  });

  it('setPage writes page without touching filters or sort', async () => {
    const user = userEvent.setup();
    const { router } = renderWithRouter(buildRouteTree(), {
      initialEntries: ['/students?class_id=class-9&sort=due_date&order=asc'],
    });
    await user.click(await screen.findByRole('button', { name: 'Go to page 5' }));
    expect(router.state.location.searchStr).toContain('page=5');
    expect(router.state.location.searchStr).toContain('class_id=class-9');
    expect(router.state.location.searchStr).toContain('sort=due_date');
  });

  it('setLimit writes limit and resets page to 1', async () => {
    const user = userEvent.setup();
    const { router } = renderWithRouter(buildRouteTree(), {
      initialEntries: ['/students?page=3'],
    });
    await screen.findByText('page: 3');

    await user.click(screen.getByRole('button', { name: 'Set limit 20' }));

    await screen.findByText('limit: 20');
    expect(router.state.location.searchStr).toContain('limit=20');
    expect(router.state.location.searchStr).toContain('page=1');
  });

  it('setLimit does not disturb existing filters', async () => {
    const user = userEvent.setup();
    const { router } = renderWithRouter(buildRouteTree(), {
      initialEntries: ['/students?class_id=class-9'],
    });
    await user.click(await screen.findByRole('button', { name: 'Set limit 20' }));

    await screen.findByText('limit: 20');
    expect(router.state.location.searchStr).toContain('class_id=class-9');
  });

  it('setLimit while on page 5 lands the user back on page 1', async () => {
    const user = userEvent.setup();
    renderWithRouter(buildRouteTree(), { initialEntries: ['/students?page=5'] });
    await screen.findByText('page: 5');

    await user.click(screen.getByRole('button', { name: 'Set limit 20' }));

    await screen.findByText('page: 1');
  });
});

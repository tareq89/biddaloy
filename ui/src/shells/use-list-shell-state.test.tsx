import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type RouteObject } from 'react-router';
import { describe, expect, it } from 'vitest';

import { renderWithRouter } from '../test/render-with-router';

import { useListShellState } from './use-list-shell-state';

function Probe() {
  const [state, actions] = useListShellState({ limit: 20 });
  return (
    <div>
      <p>page: {state.page}</p>
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
      <button onClick={() => actions.setFilters({ class_id: 'class-9' })}>Filter class-9</button>
      <button onClick={() => actions.setSelectedIds(new Set(['s1', 's2']))}>
        Select two students
      </button>
    </div>
  );
}

const routes: RouteObject[] = [{ path: '/students', element: <Probe /> }];

describe('useListShellState', () => {
  it('reads sort/order from the URL as a DataTableSort', () => {
    renderWithRouter(routes, { initialEntries: ['/students?sort=due_date&order=desc'] });
    expect(screen.getByText('sort: due_date:desc')).toBeTruthy();
  });

  it('has no sorting when neither sort nor order is in the URL', () => {
    renderWithRouter(routes, { initialEntries: ['/students'] });
    expect(screen.getByText('sort: none')).toBeTruthy();
  });

  it('setSorting writes both sort and order into the URL, and resets to page 1', async () => {
    const user = userEvent.setup();
    const { router } = renderWithRouter(routes, { initialEntries: ['/students?page=3'] });
    await user.click(screen.getByRole('button', { name: 'Sort by due date' }));
    expect(router.state.location.search).toContain('sort=due_date');
    expect(router.state.location.search).toContain('order=desc');
    expect(router.state.location.search).toContain('page=1');
  });

  it('setFilters resets page to 1 — the acceptance criterion', async () => {
    const user = userEvent.setup();
    const { router } = renderWithRouter(routes, { initialEntries: ['/students?page=4'] });
    await user.click(screen.getByRole('button', { name: 'Filter class-9' }));
    await screen.findByText('class_id: class-9');
    expect(router.state.location.search).toContain('page=1');
  });

  it('reads selection from the URL and setSelectedIds writes it back', async () => {
    const user = userEvent.setup();
    renderWithRouter(routes, { initialEntries: ['/students'] });
    expect(screen.getByText('selected: none')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Select two students' }));
    await screen.findByText('selected: s1,s2');
  });

  it('a filter change preserves the current selection rather than clearing it', async () => {
    const user = userEvent.setup();
    renderWithRouter(routes, { initialEntries: ['/students'] });

    await user.click(screen.getByRole('button', { name: 'Select two students' }));
    await screen.findByText('selected: s1,s2');

    await user.click(screen.getByRole('button', { name: 'Filter class-9' }));
    await screen.findByText('class_id: class-9');
    expect(screen.getByText('selected: s1,s2')).toBeTruthy();
  });

  it('setPage writes page without touching filters or sort', async () => {
    const user = userEvent.setup();
    const { router } = renderWithRouter(routes, {
      initialEntries: ['/students?class_id=class-9&sort=due_date&order=asc'],
    });
    await user.click(screen.getByRole('button', { name: 'Go to page 5' }));
    expect(router.state.location.search).toContain('page=5');
    expect(router.state.location.search).toContain('class_id=class-9');
    expect(router.state.location.search).toContain('sort=due_date');
  });
});

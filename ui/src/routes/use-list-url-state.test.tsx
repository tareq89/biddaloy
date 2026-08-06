import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RouteObject } from 'react-router';
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
      <button onClick={() => update({ limit: 25 })}>Set limit</button>
      <button onClick={() => update({ order: 'desc' })}>Sort descending</button>
      <button onClick={() => update({ filters: { page: '999', order: 'desc', class_id: 'c-1' } })}>
        Set filters including a reserved key
      </button>
    </div>
  );
}

const routes: RouteObject[] = [{ path: '/students', element: <Probe /> }];

describe('useListUrlState', () => {
  it('falls back to limit 10 when no default and no URL value are given', () => {
    renderWithRouter(routes, { initialEntries: ['/students'] });

    expect(screen.getByText('limit: 10')).toBeTruthy();
  });

  it('defaults order to asc when absent from the URL', () => {
    renderWithRouter(routes, { initialEntries: ['/students'] });
    expect(screen.getByText('order: asc')).toBeTruthy();
  });

  it('reads order=desc from the URL, and treats anything else as asc', () => {
    renderWithRouter(routes, { initialEntries: ['/students?order=desc'] });
    expect(screen.getByText('order: desc')).toBeTruthy();

    renderWithRouter(routes, { initialEntries: ['/students?order=garbage'] });
    expect(screen.getAllByText('order: asc').length).toBeGreaterThan(0);
  });

  it('update({ order }) writes order into the URL', async () => {
    const user = userEvent.setup();
    const { router } = renderWithRouter(routes, { initialEntries: ['/students'] });
    await user.click(screen.getByRole('button', { name: 'Sort descending' }));
    expect(router.state.location.search).toContain('order=desc');
  });

  it('honours a caller-supplied default limit', () => {
    renderWithRouter([{ path: '/students', element: <Probe defaults={{ limit: 25 }} /> }], {
      initialEntries: ['/students'],
    });

    expect(screen.getByText('limit: 25')).toBeTruthy();
  });

  it('update({ limit }) writes limit into the URL and preserves the params already there', async () => {
    // Seeded with page/sort/filter already set — asserting only rendered
    // state (as an earlier version of this test did) could pass even if
    // `update()` wrote to local component state instead of the URL. This
    // asserts against the actual URL via `router.state.location.search`.
    const user = userEvent.setup();
    const { router } = renderWithRouter(routes, {
      initialEntries: ['/students?page=3&sort=full_name&class_id=c-9'],
    });

    await user.click(screen.getByRole('button', { name: 'Set limit' }));

    expect(router.state.location.search).toContain('limit=25');
    expect(router.state.location.search).toContain('page=3');
    expect(router.state.location.search).toContain('sort=full_name');
    expect(router.state.location.search).toContain('class_id=c-9');
  });

  it('a reserved key inside patch.filters cannot overwrite the real page/limit/sort params', async () => {
    const user = userEvent.setup();
    const { router } = renderWithRouter(routes, { initialEntries: ['/students?page=3'] });

    await user.click(screen.getByRole('button', { name: 'Set filters including a reserved key' }));

    // The 'page'/'order' keys inside filters must not have won over the
    // real params — only the non-reserved 'class_id' filter should apply.
    expect(router.state.location.search).toContain('page=3');
    expect(router.state.location.search).not.toContain('page=999');
    expect(router.state.location.search).not.toContain('order=desc');
    expect(router.state.location.search).toContain('class_id=c-1');
  });
});

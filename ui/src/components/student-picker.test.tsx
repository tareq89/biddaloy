import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { LINK_KEYS, expectKeyboardOperable } from '../test/a11y';
import { renderWithRouter } from '../test/render-with-router';

import { StudentPicker } from './student-picker';

const items = [
  { id: 'student-1', name: 'Fatima Rahman', meta: 'Class 8 B · Roll 14' },
  { id: 'student-2', name: 'Imran Rahman', meta: 'Class 3 A · Roll 7' },
  { id: 'student-3', name: 'Ayesha Rahman', meta: 'Class 5 C · Roll 2' },
];

function buildRouteTree(pickerItems: typeof items) {
  const rootRoute = createRootRoute();
  const feesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/portal/fees',
    validateSearch: (search: Record<string, unknown>) => ({
      student: typeof search.student === 'string' ? search.student : undefined,
    }),
    component: function FeesFrame() {
      const { student } = feesRoute.useSearch();
      return (
        <>
          <p>{`Showing ${student ?? 'student-1'}`}</p>
          <StudentPicker
            label="Choose a student"
            items={pickerItems}
            selectedId={student ?? 'student-1'}
            to="/portal/fees"
          />
        </>
      );
    },
  });
  return rootRoute.addChildren([feesRoute]);
}

describe('StudentPicker', () => {
  it('renders a named nav landmark with one link per student, name and meta together', async () => {
    renderWithRouter(buildRouteTree(items), { initialEntries: ['/portal/fees'], role: 'PARENT' });

    const nav = await screen.findByRole('navigation', { name: 'Choose a student' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((el) => el.textContent),
    ).toEqual([
      'Fatima RahmanClass 8 B · Roll 14',
      'Imran RahmanClass 3 A · Roll 7',
      'Ayesha RahmanClass 5 C · Roll 2',
    ]);
  });

  it('marks only the selected chip with aria-current="page"', async () => {
    renderWithRouter(buildRouteTree(items), {
      initialEntries: ['/portal/fees?student=student-2'],
      role: 'PARENT',
    });

    const nav = await screen.findByRole('navigation', { name: 'Choose a student' });
    const current = within(nav)
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page');
    expect(current.map((link) => link.textContent)).toEqual(['Imran RahmanClass 3 A · Roll 7']);
    // The active state is not carried by colour alone: `aria-current`
    // above is what a screen reader gets, the border/background tint is the
    // sighted counterpart.
    expect(current[0]?.className).toContain('border-primary');
  });

  it('navigates to the chosen student by writing ?student=', async () => {
    const { router } = renderWithRouter(buildRouteTree(items), {
      initialEntries: ['/portal/fees'],
      role: 'PARENT',
    });

    const nav = await screen.findByRole('navigation', { name: 'Choose a student' });
    await userEvent.click(within(nav).getByRole('link', { name: /Imran Rahman/ }));

    expect(await screen.findByText('Showing student-2')).toBeTruthy();
    expect(router.state.location.search).toEqual({ student: 'student-2' });
  });

  it('renders nothing at all for a guardian with exactly one child', async () => {
    renderWithRouter(buildRouteTree(items.slice(0, 1)), {
      initialEntries: ['/portal/fees'],
      role: 'PARENT',
    });

    await screen.findByText('Showing student-1');
    expect(screen.queryByRole('navigation', { name: 'Choose a student' })).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('gives every chip a touch target of at least 44px', async () => {
    renderWithRouter(buildRouteTree(items), { initialEntries: ['/portal/fees'], role: 'PARENT' });

    const nav = await screen.findByRole('navigation', { name: 'Choose a student' });
    for (const link of within(nav).getAllByRole('link')) {
      // `min-h-11` is 44px.
      expect(link.className).toContain('min-h-11');
    }
  });

  it('every chip is reachable and activatable by keyboard', async () => {
    renderWithRouter(buildRouteTree(items), { initialEntries: ['/portal/fees'], role: 'PARENT' });

    const link = await screen.findByRole('link', { name: /Imran Rahman/ });
    await expectKeyboardOperable(link, { keys: LINK_KEYS });
  });

  it('is axe clean', async () => {
    const { container } = renderWithRouter(buildRouteTree(items), {
      initialEntries: ['/portal/fees'],
      role: 'PARENT',
    });

    await screen.findByText('Showing student-1');
    await expect(container).toHaveNoViolations();
  });
});

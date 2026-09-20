import { createRootRoute } from '@tanstack/react-router';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithRouter } from '../test/render-with-router';

import { Breadcrumbs, type BreadcrumbItem } from './breadcrumbs';

function buildRouteTree(items: readonly BreadcrumbItem[]) {
  const rootRoute = createRootRoute({
    component: () => <Breadcrumbs items={items} aria-label="Breadcrumb" />,
  });
  return rootRoute;
}

describe('Breadcrumbs', () => {
  it('marks only the last item as the current page and links every earlier one', async () => {
    const items = [
      { label: 'Students', to: '/students' },
      { label: 'Sections', to: '/students/sections' },
      { label: 'Class 8A' },
    ];
    renderWithRouter(buildRouteTree(items), { initialEntries: ['/'] });

    const nav = await screen.findByRole('navigation', { name: 'Breadcrumb' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((el) => el.textContent)).toEqual(['Students', 'Sections']);

    const current = within(nav).getByText('Class 8A');
    expect(current.tagName).not.toBe('A');
    expect(current.getAttribute('aria-current')).toBe('page');
  });

  it('marks every separator as decorative', async () => {
    const items = [
      { label: 'Students', to: '/students' },
      { label: 'Class 8A' },
    ];
    renderWithRouter(buildRouteTree(items), { initialEntries: ['/'] });

    const nav = await screen.findByRole('navigation', { name: 'Breadcrumb' });
    const separators = within(nav).getAllByText('/');
    expect(separators.length).toBeGreaterThan(0);
    for (const separator of separators) {
      expect(separator.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('renders a single item with no separator', async () => {
    const items = [{ label: 'Class 8A' }];
    renderWithRouter(buildRouteTree(items), { initialEntries: ['/'] });

    const nav = await screen.findByRole('navigation', { name: 'Breadcrumb' });
    expect(within(nav).queryByText('/')).toBeNull();
    expect(within(nav).getByText('Class 8A').getAttribute('aria-current')).toBe('page');
  });

  it('renders nothing — not an empty nav — for an empty items array', () => {
    renderWithRouter(buildRouteTree([]), { initialEntries: ['/'] });

    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).toBeNull();
  });
});

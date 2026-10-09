import { createRootRoute } from '@tanstack/react-router';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithRouter } from '../test/render-with-router';

import { RowActions, RowActionsLayoutContext, type RowAction } from './row-actions';

/** Links need a router, so everything renders inside a root route. */
async function renderActions(actions: RowAction[], layout: 'icons' | 'labelled' = 'icons') {
  const root = createRootRoute({
    component: () => (
      <RowActionsLayoutContext.Provider value={layout}>
        <RowActions actions={actions} />
      </RowActionsLayoutContext.Provider>
    ),
  });
  const view = renderWithRouter(root, { locale: 'en' });
  await act(async () => {
    await view.localeReady;
  });
  await waitFor(() => expect(view.container.querySelector('a, button')).not.toBeNull());
  return view;
}

const fiveActions = (): RowAction[] => [
  { intent: 'view', label: 'View', onClick: vi.fn() },
  { intent: 'edit', label: 'Edit', onClick: vi.fn() },
  { intent: 'delete', label: 'Delete', onClick: vi.fn() },
  { intent: 'print', label: 'Print', onClick: vi.fn() },
  { intent: 'download', label: 'Download', onClick: vi.fn() },
];

describe('RowActions', () => {
  it('renders one button per action and no More button for 3 or fewer', async () => {
    await renderActions([
      { intent: 'view', label: 'View' },
      { intent: 'edit', label: 'Edit' },
    ]);
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
  });

  it('leaves out actions with allowed: false', async () => {
    await renderActions([
      { intent: 'view', label: 'View' },
      { intent: 'edit', label: 'Edit', allowed: false },
    ]);
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  it('keeps 3 icons, puts the rest in More, delete last after a separator', async () => {
    const user = userEvent.setup();
    await renderActions(fiveActions());
    expect(screen.getAllByRole('button')).toHaveLength(4);
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(['Download', 'Delete']);
    expect(screen.getByRole('separator')).toBeTruthy();
  });

  it('colours by intent', async () => {
    await renderActions([
      { intent: 'edit', label: 'Edit' },
      { intent: 'delete', label: 'Delete' },
      { intent: 'pay', label: 'Pay' },
    ]);
    expect(screen.getByRole('button', { name: 'Edit' }).className).toContain('text-primary');
    expect(screen.getByRole('button', { name: 'Delete' }).className).toContain('text-destructive');
    expect(screen.getByRole('button', { name: 'Pay' }).className).toContain('text-status-paid-fg');
  });

  it('renders `to` as a link carrying data-focus-anchor, in both layouts', async () => {
    const actions: RowAction[] = [
      { intent: 'view', label: 'View', to: '/students/1', 'data-focus-anchor': 'row-1' },
    ];
    const first = await renderActions(actions);
    expect(await screen.findByRole('link', { name: 'View' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View' }).getAttribute('data-focus-anchor')).toBe(
      'row-1',
    );
    first.unmount();
    await renderActions(actions, 'labelled');
    const link = await screen.findByRole('link', { name: 'View' });
    expect(link.getAttribute('data-focus-anchor')).toBe('row-1');
  });

  it('shows visible labels and no tooltip in the labelled layout', async () => {
    const user = userEvent.setup();
    await renderActions([{ intent: 'edit', label: 'Edit' }], 'labelled');
    expect(screen.getByText('Edit')).toBeTruthy();
    await user.hover(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('shows the label as a tooltip on keyboard focus', async () => {
    const user = userEvent.setup();
    await renderActions([{ intent: 'edit', label: 'Edit' }]);
    await user.tab();
    expect(await screen.findByRole('tooltip')).toBeTruthy();
  });

  it('is axe clean', async () => {
    const { container } = await renderActions(fiveActions());
    await expect(container).toHaveNoViolations();
  });
});

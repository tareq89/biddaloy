import { createRootRoute } from '@tanstack/react-router';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../test';
import { renderWithRouter } from '../test/render-with-router';

import { PageHeader, type PageAction, type PageActionPriority } from './page-header';

async function renderInEnglish(ui: React.ReactElement) {
  const view = renderWithProviders(ui, { locale: 'en' });
  await act(async () => {
    await view.localeReady;
  });
  return view;
}

const act1 = (
  id: string,
  priority: PageActionPriority,
  extra?: Omit<Partial<PageAction>, 'to' | 'onClick'>,
): PageAction => ({
  id,
  label: id,
  priority,
  onClick: vi.fn(),
  ...extra,
});

describe('PageHeader', () => {
  it('renders the title as h1 and the subtitle when given', async () => {
    await renderInEnglish(<PageHeader title="Students" subtitle="All enrolled" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Students' })).toBeTruthy();
    expect(screen.getByText('All enrolled')).toBeTruthy();
  });

  it('keeps primary + 2 secondary inline and puts the 3rd secondary in More', async () => {
    const user = userEvent.setup();
    await renderInEnglish(
      <PageHeader
        title="T"
        actions={[
          act1('p', 'primary'),
          act1('s1', 'secondary'),
          act1('s2', 'secondary'),
          act1('s3', 'secondary'),
        ]}
      />,
    );
    for (const name of ['p', 's1', 's2']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    expect(screen.queryByRole('button', { name: 's3' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.getByRole('menuitem', { name: 's3' })).toBeTruthy();
  });

  it('hides non-primary inline buttons on phone and lets the primary fill the row', async () => {
    await renderInEnglish(
      <PageHeader title="T" actions={[act1('p', 'primary'), act1('s1', 'secondary')]} />,
    );
    const s1 = screen.getByRole('button', { name: 's1' });
    expect(s1.className).toContain('hidden');
    expect(s1.className).toContain('md:inline-flex');
    expect(screen.getByRole('button', { name: 'p' }).className).toContain('flex-1');
  });

  it('shows a phone-only More trigger listing the secondary when the desktop menu is empty', async () => {
    const user = userEvent.setup();
    await renderInEnglish(
      <PageHeader title="T" actions={[act1('p', 'primary'), act1('s1', 'secondary')]} />,
    );
    const more = screen.getByRole('button', { name: 'More actions' });
    expect(more.className).toContain('md:hidden');
    await user.click(more);
    expect(screen.getByRole('menuitem', { name: 's1' })).toBeTruthy();
  });

  it('removes disallowed actions and renders nothing without actions', async () => {
    const { container } = await renderInEnglish(
      <PageHeader title="T" actions={[act1('x', 'primary', { allowed: false })]} />,
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.querySelector('header > div.flex')).toBeNull();
  });

  it('keeps a lone destructive inline, but moves it after a separator when a tertiary exists', async () => {
    const user = userEvent.setup();
    const { unmount } = await renderInEnglish(
      <PageHeader title="T" actions={[act1('del', 'destructive')]} />,
    );
    expect(screen.getByRole('button', { name: 'del' })).toBeTruthy();
    unmount();

    await renderInEnglish(
      <PageHeader title="T" actions={[act1('del', 'destructive'), act1('t', 'tertiary')]} />,
    );
    expect(screen.queryByRole('button', { name: 'del' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    const items = screen.getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(['t', 'del']);
    expect(screen.getByRole('separator')).toBeTruthy();
  });

  it('keeps disabled and busy actions visible', async () => {
    await renderInEnglish(
      <PageHeader
        title="T"
        actions={[
          act1('save', 'primary', { disabled: true }),
          act1('go', 'secondary', { busy: true }),
        ]}
      />,
    );
    expect(screen.getByRole('button', { name: 'save' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: /^go/ }).getAttribute('aria-busy')).toBe('true');
  });

  it('renders a `to` action as a real link, inline and in the More menu', async () => {
    const user = userEvent.setup();
    const actions: PageAction[] = [
      { id: 'add', label: 'Add student', priority: 'primary', to: '/students/new' },
      { id: 'import', label: 'Import', priority: 'tertiary', to: '/students/import' },
    ];
    const rootRoute = createRootRoute({
      component: () => <PageHeader title="Students" actions={actions} />,
    });
    renderWithRouter(rootRoute, { locale: 'en' });

    const add = await screen.findByRole('link', { name: 'Add student' });
    expect(add.getAttribute('href')).toBe('/students/new');
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    const item = await screen.findByRole('menuitem', { name: 'Import' });
    expect(item.getAttribute('href')).toBe('/students/import');
  });

  it('is axe clean', async () => {
    const { container } = await renderInEnglish(
      <PageHeader
        title="T"
        subtitle="sub"
        actions={[act1('p', 'primary'), act1('s1', 'secondary'), act1('t', 'tertiary')]}
      />,
    );
    await expect(container).toHaveNoViolations();
  });
});

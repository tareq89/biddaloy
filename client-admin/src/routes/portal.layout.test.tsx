import { cleanupTestState, renderWithRouter } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../routeTree.gen';

/** [31.3.2] The portal shell wiring, exercised through the real route tree as a PARENT. */
describe('portal layout shell', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  function render(path: string) {
    return renderWithRouter(routeTree, {
      initialEntries: [path],
      tenantId: 'tenant-1',
      role: 'PARENT',
      locale: 'en',
    });
  }

  it('lists 11 sidebar links, each with a different icon, including Surveys', async () => {
    render('/portal/fees');
    const nav = (await screen.findAllByRole('navigation', { name: /main|menu|navigation/i }))[0]!;
    const links = within(nav).getAllByRole('link');
    expect(links).toHaveLength(11);
    expect(links.some((l) => l.getAttribute('href') === '/portal/surveys')).toBe(true);
    const icons = links.map((l) =>
      Array.from(l.querySelector('svg')?.classList ?? []).find((c) => c.startsWith('lucide-')),
    );
    expect(icons.every(Boolean)).toBe(true);
    expect(new Set(icons).size).toBe(11);
  });

  it('marks exactly one sidebar link current on /portal/fees', async () => {
    render('/portal/fees');
    const nav = (await screen.findAllByRole('navigation', { name: /main|menu|navigation/i }))[0]!;
    await waitFor(() =>
      expect(within(nav).getAllByRole('link', { current: 'page' })).toHaveLength(1),
    );
  });

  it('marks More (and no cell) on a page outside the four bottom cells', async () => {
    render('/portal/syllabus');
    const bar = await screen.findByRole('navigation', { name: /bottom|quick|portal/i });
    const more = within(bar).getByRole('button');
    await waitFor(() => expect(more.getAttribute('data-active')).toBe('true'));
    expect(within(bar).queryAllByRole('link', { current: 'page' })).toHaveLength(0);
  });

  it('account menu has Security, which goes to /portal/account', async () => {
    const { router } = render('/portal/fees');
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole('button', { name: /Account menu/ }))[0]!);
    await user.click(await screen.findByRole('menuitem', { name: 'Security' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/portal/account'));
  });
});

import { clearAuthState, setSupportSession, writeSupportEntry } from '@biddaloy/ui/api';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../routeTree.gen';

function enterSupportTab(role: string) {
  server.use(
    http.get('/api/v1/auth/impersonation/me', () =>
      HttpResponse.json({
        sessionId: 's',
        adminName: 'Owner',
        userName: 'Rahim',
        role,
        viewOnly: false,
        writeLocked: false,
        expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
      }),
    ),
  );
  setSupportSession(true);
  writeSupportEntry({
    token: 't',
    sessionId: 's',
    expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
    tenantId: 'tenant-1',
    role,
  });
}

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

  it('lists 15 sidebar links, each with a different icon, including Surveys', async () => {
    render('/portal/fees');
    const nav = (await screen.findAllByRole('navigation', { name: /main|menu|navigation/i }))[0]!;
    const links = within(nav).getAllByRole('link');
    expect(links).toHaveLength(15);
    expect(links.some((l) => l.getAttribute('href') === '/portal/surveys')).toBe(true);
    expect(links.some((l) => l.getAttribute('href') === '/portal/notices')).toBe(true);
    expect(links.some((l) => l.getAttribute('href') === '/portal/applications')).toBe(true);
    const icons = links.map((l) =>
      Array.from(l.querySelector('svg')?.classList ?? []).find((c) => c.startsWith('lucide-')),
    );
    expect(icons.every(Boolean)).toBe(true);
    expect(new Set(icons).size).toBe(15);
  });

  it('hides the sidebar link of an off module (D16) and keeps the core ones', async () => {
    server.use(
      http.get('/api/v1/schools/me/profile', () =>
        HttpResponse.json({
          name: 'Ananta School',
          modules: { platform: {}, school: { homework: { on: false } } },
          labels: {},
        }),
      ),
    );
    render('/portal/fees');
    const nav = (await screen.findAllByRole('navigation', { name: /main|menu|navigation/i }))[0]!;
    await waitFor(() => expect(within(nav).getAllByRole('link')).toHaveLength(14));
    const hrefs = within(nav)
      .getAllByRole('link')
      .map((l) => l.getAttribute('href'));
    expect(hrefs).not.toContain('/portal/homework');
    expect(hrefs).toContain('/portal/account');
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

  it('shows the desktop header only from md up, so phones get one header row', async () => {
    render('/portal/fees');
    // jsdom applies no CSS, so check the wrapper class the staff shell uses too.
    const header = (await screen.findAllByRole('banner'))[0]!;
    expect(header.parentElement?.className).toBe('hidden md:flex');
  });

  it('account menu has Security, which goes to /portal/account', async () => {
    const { router } = render('/portal/fees');
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole('button', { name: /Account menu/ }))[0]!);
    await user.click(await screen.findByRole('menuitem', { name: 'Security' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/portal/account'));
  });

  // [99.G4.02]
  it('shows the red bar in a support tab and not in a normal tab', async () => {
    const first = render('/portal/fees');
    await screen.findAllByRole('navigation', { name: /main|menu|navigation/i });
    expect(screen.queryByRole('button', { name: 'End' })).toBeNull();
    first.unmount();

    enterSupportTab('PARENT');
    render('/portal/fees');
    expect(await screen.findByRole('button', { name: 'End' })).toBeTruthy();
    clearAuthState();
  });
});

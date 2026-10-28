import { useHelp } from '@biddaloy/ui/components';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppHelpProvider } from './help-provider';

function Probe() {
  const { pageId, pageHref } = useHelp();
  return (
    <p data-testid="probe">
      {String(pageId)}|{String(pageHref)}
    </p>
  );
}

async function probeAt(path: string): Promise<string> {
  const root = createRootRoute({
    component: () => (
      <AppHelpProvider>
        <Outlet />
      </AppHelpProvider>
    ),
  });
  const leaf = (p: string) =>
    createRoute({ getParentRoute: () => root, path: p, component: Probe });
  const router = createRouter({
    routeTree: root.addChildren([
      leaf('/fees/generate'),
      leaf('/students/$studentId'),
      leaf('/portal/fees'),
      leaf('/settings'),
      leaf('/not-in-the-guide'),
    ]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router} />);
  return (await screen.findByTestId('probe')).textContent ?? '';
}

describe('AppHelpProvider', () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ['/fees/generate', 'finance.generateFees'],
    ['/students/123', 'people.students'],
    ['/portal/fees', 'portal.fees'],
    ['/settings', 'administration.settings'],
  ])('%s resolves to %s with a guide link', async (path, id) => {
    vi.stubEnv('VITE_HANDBOOK_URL', 'https://guide.example/docs');
    const text = await probeAt(path);
    expect(text.startsWith(`${id}|https://guide.example/docs/`)).toBe(true);
  });

  it('a route outside HELP_ROUTES has no page id', async () => {
    vi.stubEnv('VITE_HANDBOOK_URL', 'https://guide.example/docs');
    expect(await probeAt('/not-in-the-guide')).toBe('null|null');
  });

  it('an empty base URL gives no pageHref', async () => {
    vi.stubEnv('VITE_HANDBOOK_URL', '');
    expect(await probeAt('/settings')).toBe('administration.settings|null');
  });
});

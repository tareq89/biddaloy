/**
 * Test support: mounts static `children` inside a router (the settings cards
 * hold `<Link>`s and `useBlocker`, which need one) and the tenant region,
 * pinned to English because the default `RegionConfig` is Bangla.
 */
import { REGION_BD_EN, RegionConfigProvider } from '@biddaloy/ui/i18n';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import * as React from 'react';

export function WithTestRouter({ children }: { children: React.ReactNode }) {
  const [router] = React.useState(() =>
    createRouter({
      routeTree: createRootRoute({
        component: () => (
          <RegionConfigProvider value={REGION_BD_EN}>{children}</RegionConfigProvider>
        ),
      }),
      history: createMemoryHistory({ initialEntries: ['/'] }),
    }),
  );
  return <RouterProvider router={router} />;
}

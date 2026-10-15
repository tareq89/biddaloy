import { RegionConfigProvider } from '@biddaloy/ui/i18n';
import { renderWithRouter } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import type { ReactElement } from 'react';

/** Mounts one portal card inside a one-route router (the cards hold `Link`s)
 * with the value-less region provider the portal page itself uses. */
export function renderPortalCard(element: ReactElement, locale = 'en') {
  const root = createRootRoute();
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <RegionConfigProvider>{element}</RegionConfigProvider>,
  });
  return renderWithRouter(root.addChildren([index]), {
    locale,
    role: 'PARENT',
    tenantId: 'tenant-1',
  });
}

import { Permission } from '@biddaloy/shared';
import { AppShell, EmptyState } from '@biddaloy/ui/components';
import { useHasPermission } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import type { QueryClient } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { createRootRouteWithContext, Outlet, useNavigate } from '@tanstack/react-router';
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools';

/**
 * `queryClient` in router context is what lets a route's `loader` call
 * `context.queryClient.ensureQueryData(...)` — the mechanism behind
 * [8.9.1]'s "hovering a sidebar link prefetches the route **and** data"
 * AC (see `main.tsx`'s `createRouter({ context: { queryClient } })`).
 */
export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  // Rendered inside `RootLayout`'s own `<Outlet />` — the sidebar/header
  // chrome around it stays up, satisfying [8.9.1]'s "404 renders inside
  // the shell, not a bare page" AC. See `AppShell`'s own doc comment for
  // why the epic's other app-shell concerns (focus management, the
  // tenant/role bar) aren't here yet.
  notFoundComponent: NotFoundPage,
});

/**
 * `useHasPermission` isn't reactive (see its own doc comment in
 * `ui/src/hooks/permissions.ts`) — a role that changes mid-session (tenant
 * switch) won't re-filter this list until something else forces a
 * re-render. Acceptable for now: [8.9.6] ("see only what my role
 * permits") owns making the whole nav reactive to role changes, not this
 * ticket.
 */
function RootLayout() {
  const { t } = useTranslation('nav');
  const canManageSettings = useHasPermission(Permission.SETTINGS_MANAGE);

  const navItems = [
    { to: '/', label: t('items.dashboard') },
    { to: '/students', label: t('items.students') },
    { to: '/fees', label: t('items.fees') },
    ...(canManageSettings ? [{ to: '/settings', label: t('items.settings') }] : []),
  ];

  return (
    <AppShell navItems={navItems} brand={t('brand')}>
      <Outlet />
      {import.meta.env.DEV && <TanStackRouterDevtools />}
      {import.meta.env.DEV && <ReactQueryDevtools />}
    </AppShell>
  );
}

function NotFoundPage() {
  const { t } = useTranslation('nav');
  const navigate = useNavigate();

  return (
    <EmptyState
      title={t('notFound.title')}
      explanation={t('notFound.explanation')}
      action={{ label: t('notFound.action'), onClick: () => void navigate({ to: '/' }) }}
    />
  );
}

import { Permission } from '@biddaloy/shared';
import { ensureSessionLoaded } from '@biddaloy/ui/api';
import { AppShell, EmptyState } from '@biddaloy/ui/components';
import { useHasPermission } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import type { QueryClient } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { createRootRouteWithContext, Outlet, redirect, useNavigate } from '@tanstack/react-router';
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
  // [8.9.3]'s protected-route guard — runs before every route in the tree,
  // `/login` included, which is exactly why the `pathname !== '/login'`
  // check exists: without it, an unauthenticated visit to `/login` itself
  // would redirect to `/login` forever. `ensureSessionLoaded()`
  // (`@biddaloy/ui/api`) is what makes the very first cold-load navigation
  // wait for a silent-refresh attempt against the httpOnly refresh cookie
  // before deciding — every navigation after that resolves instantly, since
  // it short-circuits once an access token is set. `location.href` here is
  // router-relative (`pathname + search + hash`, never the origin), so
  // there's no absolute-URL open-redirect surface in handing it to
  // `/login`'s `redirect` search param.
  beforeLoad: async ({ location }) => {
    const authenticated = await ensureSessionLoaded();
    if (!authenticated && location.pathname !== '/login') {
      // TanStack Router's own documented pattern: `redirect()` returns a
      // plain sentinel object (not an `Error` instance) that the router's
      // navigation machinery specifically catches — throwing anything else
      // here wouldn't redirect at all.
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
  },
  // Shown only if `beforeLoad`'s bootstrap attempt takes a while (Router's
  // own default `pendingMs` threshold) — a blank screen on a slow cold
  // load would otherwise look broken rather than loading.
  pendingComponent: RootPending,
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

function RootPending() {
  const { t } = useTranslation('common');

  // Explicit `{ ns: 'common' }` (a string literal, not the `COMMON_NAMESPACE`
  // constant — see `check-i18n-keys.mjs`'s own "known blind spots" comment,
  // its `ns:` extraction only matches a quoted literal) rather than relying
  // on the `useTranslation('common')` above: the checker's namespace
  // resolution picks the *first* `useTranslation()` call in the whole file,
  // not per-function scope — this file's other functions call
  // `useTranslation('nav')`, which would otherwise misattribute this key.
  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-muted-foreground">{t('status.loading', { ns: 'common' })}</p>
    </div>
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

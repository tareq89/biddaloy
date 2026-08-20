import { Permission } from '@biddaloy/shared';
import { ensureSessionLoaded, getActiveTenant } from '@biddaloy/ui/api';
import { AppShell, EmptyState, TenantBar } from '@biddaloy/ui/components';
import { useHasPermission } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import type { QueryClient } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import {
  createRootRouteWithContext,
  Outlet,
  redirect,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router';
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
  // Protected-route guard, runs before every route in the tree including
  // `/login` itself — `pathname !== '/login'` below stops that case from
  // redirecting to itself forever. `ensureSessionLoaded()` waits for a
  // silent-refresh attempt against the httpOnly refresh cookie on the
  // first cold-load navigation, then short-circuits instantly once an
  // access token is set. `location.href` here is router-relative
  // (`pathname + search + hash`, never the origin), so handing it to
  // `/login`'s `redirect` search param has no absolute-URL open-redirect
  // surface.
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
    // [8.9.5]: authenticated but no active tenant chosen yet — either a
    // fresh login with 2+ memberships (`ui/src/hooks/auth.ts`'s `login()`
    // deliberately leaves this unset in that case) or a reload whose
    // persisted tenant didn't restore (`session.ts`'s `restoreActiveTenant`).
    // `select-school.tsx` itself decides what to do with zero memberships;
    // this guard's only job is getting an unresolved visitor there.
    if (
      authenticated &&
      !getActiveTenant() &&
      location.pathname !== '/login' &&
      location.pathname !== '/select-school'
    ) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw redirect({ to: '/select-school', search: { redirect: location.href } });
    }
  },
  // Shown only if the bootstrap attempt takes a while (Router's own
  // default `pendingMs` threshold) — a blank screen on a slow cold load
  // would otherwise look broken rather than loading.
  pendingComponent: RootPending,
  component: RootLayout,
  // Rendered inside `RootLayout`'s own `<Outlet />` so the sidebar/header
  // chrome stays up around it.
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
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  const navItems = [
    { to: '/', label: t('items.dashboard') },
    { to: '/students', label: t('items.students') },
    { to: '/fees', label: t('items.fees') },
    ...(canManageSettings ? [{ to: '/settings', label: t('items.settings') }] : []),
  ];

  const devtools = (
    <>
      {import.meta.env.DEV && <TanStackRouterDevtools />}
      {import.meta.env.DEV && <ReactQueryDevtools />}
    </>
  );

  // [8.9.4]'s sign-in page is deliberately chrome-free, per the approved
  // `templates/sign-in` mockup — an unauthenticated visitor shouldn't see
  // nav links to pages they can't reach yet. The stub-era version of this
  // route flagged that gap in its own comment as deferred polish; this is
  // where it gets settled, rather than restructuring every route file
  // into a pathless layout route for one page's benefit. [8.9.5]'s
  // `/select-school` gets the same treatment: showing `AppShell`'s nav
  // (and `TenantBar`'s "current school" text) before a school is even
  // chosen would be actively misleading, not just premature.
  if (pathname === '/login' || pathname === '/select-school') {
    return (
      <>
        <Outlet />
        {devtools}
      </>
    );
  }

  return (
    <AppShell navItems={navItems} brand={t('brand')} topBar={<TenantBar />}>
      <Outlet />
      {devtools}
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

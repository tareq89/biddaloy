import { STAFF_ROLES, UserRole } from '@biddaloy/shared';
import { getFirstPasswordGate } from '@biddaloy/ui/api';
import {
  AccessDeniedState,
  AppHeader,
  AppShell,
  BottomNav,
  Breadcrumbs,
  LocaleSwitcher,
  NotificationBell,
  SyncStatusIndicator,
  TenantBar,
  ThemeToggle,
  type AppShellNavGroup,
} from '@biddaloy/ui/components';
import {
  ApprovalModalHostProvider,
  hasPermission,
  useActiveRole,
  useEntityLabel,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { RequirePermission, RequireRole } from '@biddaloy/ui/routes';
import {
  createFileRoute,
  Outlet,
  redirect,
  useMatches,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router';
import * as React from 'react';

import { CommandPaletteLauncher } from '../components/command-palette-launcher';
import { StaffUserMenu } from '../components/staff-user-menu';
import { TrialBar } from '../features/onboarding/trial-bar';
import { useWelcomeGate } from '../features/onboarding/welcome-gate';
import { MORE_ICON, PLATFORM_NAV_ICONS, STAFF_NAV_ICONS } from '../nav-icons';
import {
  isPathUnder,
  STAFF_BOTTOM_NAV,
  STAFF_NAV_GROUPS,
  STAFF_NAV_ITEMS,
  type StaffNavGroupDef,
  type StaffNavItemDef,
  type StaffNavItemId,
  type StaffRole,
  type StaffNavLabel,
} from '../nav-tree';
import { loadRouteNamespaces } from '../route-loaders';
import { STAFF_ROUTE_PERMISSIONS } from '../route-permissions';
import { useActiveSchoolName } from '../use-active-school-name';
import { useBreadcrumbs } from '../use-breadcrumbs';

/**
 * [8.9.10]'s staff half of one SPA. A **pathless** layout (`_staff`), so
 * every URL underneath is unchanged — `/students`, `/fees`, `/settings`,
 * `/invoices/:id` are exactly where they were when these routes sat at the
 * top level. The only staff URL that moved is the dashboard (`/` →
 * `/dashboard`), which frees `/` to be the role-aware redirect.
 *
 * Audience, not role, is the seam: `ROLE_PERMISSIONS[PARENT]` and
 * `[STUDENT]` are byte-identical, so a route tree per role would be two
 * copies of the same thing on day one. See `shared/src/enums/audiences.ts`.
 *
 * Two guards, not one, both client-side UX and neither the security
 * boundary (that is `RolesGuard`/`ContextGuard` on the server, which
 * already answers 403 for a PARENT hitting `GET /students`):
 *
 *   1. `RequireRole` — wrong app half. A guardian who typed a staff URL
 *      redirects to `/portal` instead of getting a page whose every
 *      request fails.
 *   2. `RequirePermission` ([8.14.17]) — right app half, wrong
 *      *permission*. A staff role that lacks the leaf route's permission
 *      (`STAFF_ROUTE_PERMISSIONS`, `../route-permissions.ts`) refuses
 *      **in place** rather than redirecting — a teacher at `/fees/dues`
 *      stays on `/fees/dues` and sees why, instead of bouncing somewhere
 *      unexplained.
 */
export const Route = createFileRoute('/_staff')({
  // [13.5.3] A first code sign-in that owes a password (`password_required`)
  // already holds a session; a reload or a new tab must land back on the
  // "set a password" card, not in the app. Client-side only — see
  // `first-password-gate.ts`.
  beforeLoad: ({ location }) => {
    if (getFirstPasswordGate()) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw redirect({ to: '/login', search: { step: 'password', redirect: location.href } });
    }
  },
  // [8.14.5]: this pathless layout renders the sidebar/header chrome
  // every staff route sits inside — its own `nav` namespace strings
  // (brand, nav groups, sidebar item labels) render on every navigation,
  // not just the first, so preloading `nav` here means it's warm before
  // any leaf route's own loader even runs.
  loader: () => loadRouteNamespaces('nav', 'trial'),
  component: StaffLayout,
});

/**
 * `useHasPermission` is reactive (`ui/src/hooks/permissions.ts`, built on
 * `useActiveRole`'s `useSyncExternalStore` subscription) — a role change
 * mid-session (a `TenantBar` switch) re-filters this list on its own, no
 * separate re-render trigger needed.
 */
function StaffLayout() {
  const { t } = useTranslation('nav');
  // #533: the platform-admin nav item is gated on the active *role*
  // (SUPER_ADMIN), not a `Permission` — `AppShellNavItem.permission` is
  // checked with `hasPermission`, and `ROLE_PERMISSIONS[SUPER_ADMIN]`
  // holds every permission there is (`permissions.ts`), so no permission
  // value could ever restrict this item to SUPER_ADMIN alone. Read
  // directly with `useActiveRole()` instead and only push the item into
  // `navGroups` below when it matches — same reactive role source
  // `RequireRole`/`_platform/route.tsx`'s own guard reads.
  const activeRole = useActiveRole();
  // `auditLogs` is loaded alongside `nav` here, not lazily on demand like
  // every other feature namespace, because this component reads a key
  // from it below (the audit-logs refusal explanation, via an explicit
  // namespace option on the call) — and when the permission gate refuses
  // that route, `AuditLogsPage` (whose own `useTranslation` call would
  // otherwise be what loads that namespace) never mounts at all. Without
  // this, a role's very first denied visit to `/audit-logs` would render
  // the untranslated key instead of its copy while the bundle loads.
  //
  // A second, separate `useTranslation()` call (return value unused) —
  // not a single call naming both namespaces at once — because
  // `ui/scripts/check-i18n-keys.mjs` resolves a file's default namespace
  // from its *first* `useTranslation()` call and only understands that
  // call's single-string-literal form; keeping it single-namespace is
  // what lets the checker attribute this file's plain nav keys correctly.
  useTranslation('auditLogs');
  const navigate = useNavigate();
  // [13.5.1] first-visit ADMIN -> /welcome, once.
  useWelcomeGate();

  // [8.14.17]: `useMatches()`'s last entry is the deepest match currently
  // rendered — the leaf route under `_staff`, e.g. `/_staff/fees/dues`.
  // `STAFF_ROUTE_PERMISSIONS` is keyed by exactly that route ID.
  const matches = useMatches();
  const leafRouteId = matches[matches.length - 1]?.routeId;
  // [32.4.1] The editor and print preview take the whole screen: no sidebar, no header (D54).
  // A route that renders `FullPageShell` as its whole page sets `staticData: { chromeless: true }`
  // (declared in `main.tsx`); a `FullPageShell` opened by a search param on a host route covers
  // the chrome itself (31.2.6). The bottom bar is not rendered on chromeless routes (D14, D22).
  const chromeless = matches[matches.length - 1]?.staticData.chromeless === true;
  const requiredPermission = leafRouteId ? STAFF_ROUTE_PERMISSIONS[leafRouteId] : undefined;
  const onDenied = () => void navigate({ to: '/' });
  const isAuditLogsRoute = leafRouteId === '/_staff/audit-logs/';

  // [30.3.3]: `document.title` for a route with a breadcrumb trail is
  // owned here, not by `useRouteFocus` (`__root.tsx`) — see that hook's
  // own comment on the `[data-slot="breadcrumbs"]` check it uses to stay
  // out of the way once this trail is on the page.
  const { items: breadcrumbItems, title: breadcrumbTitle } = useBreadcrumbs(t('brand'));
  React.useEffect(() => {
    if (breadcrumbTitle !== undefined) {
      document.title = breadcrumbTitle;
    }
  }, [breadcrumbTitle]);

  // [30.1.3]: entity nouns route through `useEntityLabel` ([30.1.2]) —
  // one hook call per entity used anywhere in `STAFF_NAV_GROUPS`, at the
  // component's top level (unconditional, same order every render), not
  // inside the `resolveLabel`/`toNavItem` loop below where the rules of
  // hooks would forbid it.
  // Nav labels here are all collection links ("Students", "Classes", …),
  // so pass a plural count — the singular form reads wrong in a sidebar
  // that lists many of each.
  const entityLabels: Record<string, string> = {
    student: useEntityLabel('student', { count: 2 }),
    guardian: useEntityLabel('guardian', { count: 2 }),
    staff: useEntityLabel('staff', { count: 2 }),
    class: useEntityLabel('class', { count: 2 }),
    academicYear: useEntityLabel('academicYear', { count: 2 }),
    invoice: useEntityLabel('invoice', { count: 2 }),
    exam: useEntityLabel('exam', { count: 2 }),
  };

  function resolveLabel(label: StaffNavLabel, namespace: 'items' | 'groups'): string {
    return 'entity' in label ? entityLabels[label.entity]! : t(`${namespace}.${label.key}`);
  }

  function toNavItem(def: StaffNavItemDef) {
    const Icon = STAFF_NAV_ICONS[def.id as StaffNavItemId];
    return {
      to: def.to,
      label: resolveLabel(def.label, 'items'),
      ...(def.permission !== undefined && { permission: def.permission }),
      icon: <Icon aria-hidden="true" />,
    };
  }

  function toNavGroup(def: StaffNavGroupDef): AppShellNavGroup {
    return {
      id: def.id,
      label: resolveLabel(def.label, 'groups'),
      ...(def.pinnedLabel !== undefined && {
        pinnedLabel: resolveLabel(def.pinnedLabel, 'groups'),
      }),
      ...(def.pinnedItems !== undefined && { pinnedItems: def.pinnedItems.map(toNavItem) }),
      items: def.items.map(toNavItem),
    };
  }

  const SchoolsIcon = PLATFORM_NAV_ICONS['/schools'];
  const HolidaySetsIcon = PLATFORM_NAV_ICONS['/holiday-sets'];
  const dashboardItem = toNavItem(STAFF_NAV_ITEMS.dashboard);

  // [31.3.1]: each role's own bottom-bar cells. They are built from the
  // sidebar's own item defs, and `BottomNav` applies the same permission
  // filter the sidebar uses, so the two surfaces cannot drift apart.
  const cells =
    (activeRole ? STAFF_BOTTOM_NAV[activeRole as StaffRole] : undefined) ?? STAFF_BOTTOM_NAV.ADMIN;
  const bottomItems = cells.map((c) => ({
    ...toNavItem(STAFF_NAV_ITEMS[c.id]),
    label: t(`bottomNavCells.${c.shortLabelKey}`),
  }));
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const visibleCells = bottomItems.filter(
    (i) => i.permission === undefined || hasPermission(activeRole, i.permission),
  );
  const moreActive = !visibleCells.some((i) => isPathUnder(pathname, i.to));
  const schoolName = useActiveSchoolName();

  const navItems = [dashboardItem];

  // [30.1.3]'s restructured §3 groups — `nav-tree.ts` is the single
  // source of truth for group order/membership/permissions; this route
  // only resolves each def's label and attaches its icon. The
  // SUPER_ADMIN-only platform items stay here rather than in
  // `nav-tree.ts`: they're gated on `activeRole`, not a `Permission`
  // value (see the `activeRole` comment above), a different mechanism
  // than every other item in the tree.
  const navGroups: AppShellNavGroup[] = STAFF_NAV_GROUPS.map(toNavGroup).map((group) =>
    group.id === 'administration'
      ? {
          ...group,
          items: [
            ...group.items,
            // #533 — SUPER_ADMIN only, see the `activeRole` comment above
            // for why this is a role check rather than a `permission`
            // value.
            ...(activeRole === UserRole.SUPER_ADMIN
              ? [
                  {
                    to: '/schools',
                    label: t('items.platformSchools'),
                    icon: <SchoolsIcon aria-hidden="true" />,
                  },
                  {
                    to: '/holiday-sets',
                    label: t('items.platformHolidaySets'),
                    icon: <HolidaySetsIcon aria-hidden="true" />,
                  },
                ]
              : []),
          ],
        }
      : group,
  );

  // [8.14.3]: hoisted so the desktop `topBar` and the mobile
  // `mobileActions` row share one definition instead of two
  // independently maintained copies of the same five props.
  // [8.14.11]: collapses further now that `NotificationBell` resolves its
  // own strings — see that component's header comment.
  const notificationBell = <NotificationBell viewAllTo="/notifications" />;

  const permissionGate = (
    <>
      {requiredPermission ? (
        <RequirePermission
          permission={requiredPermission}
          onDenied={onDenied}
          {...(isAuditLogsRoute
            ? { explanation: t('forbidden.explanation', { ns: 'auditLogs' }) }
            : {})}
        >
          <Outlet />
        </RequirePermission>
      ) : (
        // Fail-closed: no map entry for this route ID means
        // `route-permissions.test.ts`'s drift guard has a bug to catch
        // before this ever ships, but until it does, an unmapped route
        // refuses everyone — including admins — rather than rendering.
        <AccessDeniedState onAction={onDenied} />
      )}
    </>
  );

  return (
    <RequireRole allow={STAFF_ROLES} redirectTo="/portal">
      {/* The app's single step-up approval modal host. Every staff route
          renders inside this layout, so any `useApprovedMutation` on any
          staff page finds exactly one host — regardless of which component
          mounted first. See `ui/src/hooks/approval.tsx`. */}
      <ApprovalModalHostProvider>
        {chromeless ? (
          permissionGate
        ) : (
          <AppShell
            navItems={navItems}
            navGroups={navGroups}
            brand={t('brand')}
            // [8.14.3]: desktop-only now — below `md` the consolidated mobile
            // header row (`mobileTitle` / `mobileActions`) carries search, the bell and the account menu,
            // and language, theme and switch-school live in the account menu (D12). `topBar` itself
            // stays wired (not deleted): `AppShell` still measures it into
            // `--app-header-h` for the desktop sticky-chrome contract [8.14.2]
            // established.
            topBar={
              <div className="hidden md:flex">
                <AppHeader
                  start={<TenantBar />}
                  end={
                    <>
                      <SyncStatusIndicator />
                      <CommandPaletteLauncher />
                      {notificationBell}
                      <LocaleSwitcher />
                      <ThemeToggle />
                      <StaffUserMenu />
                    </>
                  }
                />
              </div>
            }
            mobileTitle={schoolName}
            mobileActions={
              <>
                <CommandPaletteLauncher />
                {notificationBell}
                <StaffUserMenu />
              </>
            }
            bottomNav={
              <BottomNav
                // [9.6 fix] `BottomNav`'s own contract caps `items` at 4 when
                // `more` is present (`bottom-nav.tsx`) — a 5th cell isn't
                // truncated for you, it just overflows the bar past 320/640px
                // (WCAG 1.4.10 reflow) for any role that can see all of them.
                // `attendanceItem` stays reachable through the drawer nav group
                // below instead, same as `attendanceReportsItem`/
                // `attendanceRegisterItem` already are.
                items={bottomItems}
                label={t('bottomNavStaffLabel')}
                more={{
                  label: t('items.more'),
                  icon: <MORE_ICON className="size-5" aria-hidden="true" />,
                  active: moreActive,
                }}
              />
            }
            openMenuLabel={t('openMenuLabel')}
            closeMenuLabel={t('closeMenuLabel')}
            navLabel={t('navLabel')}
            skipLinkLabel={t('skipToContent')}
          >
            <TrialBar className="mb-4 rounded-md" />
            {breadcrumbItems.length > 0 && (
              <Breadcrumbs
                items={breadcrumbItems}
                aria-label={t('breadcrumb.navLabel')}
                className="mb-4"
              />
            )}
            {permissionGate}
          </AppShell>
        )}
      </ApprovalModalHostProvider>
    </RequireRole>
  );
}

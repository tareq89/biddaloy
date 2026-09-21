import { STAFF_ROLES, UserRole } from '@biddaloy/shared';
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
import { ApprovalModalHostProvider, useActiveRole, useEntityLabel } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { RequirePermission, RequireRole } from '@biddaloy/ui/routes';
import { createFileRoute, Outlet, useMatches, useNavigate } from '@tanstack/react-router';
import {
  BanknoteIcon,
  BarChart3Icon,
  BellRingIcon,
  BriefcaseIcon,
  CalendarCheck2Icon,
  CalendarDaysIcon,
  ClipboardListIcon,
  FilePlus2Icon,
  RepeatIcon,
  GraduationCapIcon,
  HandCoinsIcon,
  HistoryIcon,
  LayoutDashboardIcon,
  ListChecksIcon,
  MoreHorizontalIcon,
  PrinterIcon,
  ReceiptIcon,
  ScrollTextIcon,
  SchoolIcon,
  SendIcon,
  SettingsIcon,
  UsersRoundIcon,
  WalletIcon,
} from 'lucide-react';
import * as React from 'react';
import type { ReactNode } from 'react';

import { CommandPaletteLauncher } from '../components/command-palette-launcher';
import { StaffUserMenu } from '../components/staff-user-menu';
import {
  STAFF_NAV_GROUPS,
  STAFF_NAV_ITEMS,
  type StaffNavGroupDef,
  type StaffNavItemDef,
  type StaffNavLabel,
} from '../nav-tree';
import { loadRouteNamespaces } from '../route-loaders';
import { STAFF_ROUTE_PERMISSIONS } from '../route-permissions';
import { useBreadcrumbs } from '../use-breadcrumbs';

/** [30.1.3] One icon per `STAFF_NAV_ITEMS` id — `nav-tree.ts` stays
 * JSX-free (importable from a plain `.test.ts`), so the `ReactNode` side of
 * every item lives here instead. A missing entry renders no icon rather
 * than throwing — `AppShellNavItem.icon` is optional. */
const STAFF_NAV_ICONS: Record<string, ReactNode> = {
  dashboard: <LayoutDashboardIcon aria-hidden="true" />,
  'people.students': <GraduationCapIcon aria-hidden="true" />,
  'people.guardians': <UsersRoundIcon aria-hidden="true" />,
  'people.calendar': <CalendarDaysIcon aria-hidden="true" />,
  'people.staff': <BriefcaseIcon aria-hidden="true" />,
  'academics.academicYears': <CalendarDaysIcon aria-hidden="true" />,
  'academics.classes': <SchoolIcon aria-hidden="true" />,
  'attendance.attendance': <CalendarCheck2Icon aria-hidden="true" />,
  'attendance.attendanceReports': <ClipboardListIcon aria-hidden="true" />,
  'attendance.attendanceRegister': <PrinterIcon aria-hidden="true" />,
  'finance.dues': <HandCoinsIcon aria-hidden="true" />,
  'finance.recordPayment': <BanknoteIcon aria-hidden="true" />,
  'finance.fees': <WalletIcon aria-hidden="true" />,
  'finance.feeStructures': <ListChecksIcon aria-hidden="true" />,
  'finance.generateFees': <FilePlus2Icon aria-hidden="true" />,
  'finance.recurringSchedules': <RepeatIcon aria-hidden="true" />,
  'finance.invoices': <ReceiptIcon aria-hidden="true" />,
  'reports.collectionsReport': <BarChart3Icon aria-hidden="true" />,
  'communications.sendMessage': <SendIcon aria-hidden="true" />,
  'communications.feeReminders': <BellRingIcon aria-hidden="true" />,
  'communications.reminderHistory': <HistoryIcon aria-hidden="true" />,
  'administration.auditLogs': <ScrollTextIcon aria-hidden="true" />,
  'administration.settings': <SettingsIcon aria-hidden="true" />,
};

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
  // [8.14.5]: this pathless layout renders the sidebar/header chrome
  // every staff route sits inside — its own `nav` namespace strings
  // (brand, nav groups, sidebar item labels) render on every navigation,
  // not just the first, so preloading `nav` here means it's warm before
  // any leaf route's own loader even runs.
  loader: () => loadRouteNamespaces('nav'),
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

  // [8.14.17]: `useMatches()`'s last entry is the deepest match currently
  // rendered — the leaf route under `_staff`, e.g. `/_staff/fees/dues`.
  // `STAFF_ROUTE_PERMISSIONS` is keyed by exactly that route ID.
  const matches = useMatches();
  const leafRouteId = matches[matches.length - 1]?.routeId;
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
  };

  function resolveLabel(label: StaffNavLabel, namespace: 'items' | 'groups'): string {
    return 'entity' in label ? entityLabels[label.entity]! : t(`${namespace}.${label.key}`);
  }

  function toNavItem(def: StaffNavItemDef) {
    return {
      to: def.to,
      label: resolveLabel(def.label, 'items'),
      ...(def.permission !== undefined && { permission: def.permission }),
      icon: STAFF_NAV_ICONS[def.id],
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

  // [8.14.3]: these four are the sidebar's own item objects, hoisted so
  // `bottomNavItems` below can reference the exact same objects instead of
  // a second, independently maintained list — one permission per item,
  // checked once by `BottomNav`'s own `hasPermission` filter (the same
  // gate the sidebar uses), so the two surfaces cannot drift out of sync
  // with each other.
  const dashboardItem = toNavItem(STAFF_NAV_ITEMS.dashboard);
  const studentsItem = toNavItem(STAFF_NAV_ITEMS['people.students']);
  const duesItem = toNavItem(STAFF_NAV_ITEMS['finance.dues']);
  const recordPaymentItem = toNavItem(STAFF_NAV_ITEMS['finance.recordPayment']);

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
                    icon: <SchoolIcon aria-hidden="true" />,
                  },
                  {
                    to: '/holiday-sets',
                    label: t('items.platformHolidaySets'),
                    icon: <CalendarDaysIcon aria-hidden="true" />,
                  },
                ]
              : []),
          ],
        }
      : group,
  );

  // [8.14.3]: hoisted so the desktop `topBar` and the mobile
  // `mobileHeaderActions` row share one definition instead of two
  // independently maintained copies of the same five props.
  // [8.14.11]: collapses further now that `NotificationBell` resolves its
  // own strings — see that component's header comment.
  const notificationBell = <NotificationBell viewAllTo="/notifications" />;

  return (
    <RequireRole allow={STAFF_ROLES} redirectTo="/portal">
      {/* The app's single step-up approval modal host. Every staff route
          renders inside this layout, so any `useApprovedMutation` on any
          staff page finds exactly one host — regardless of which component
          mounted first. See `ui/src/hooks/approval.tsx`. */}
      <ApprovalModalHostProvider>
        <AppShell
          navItems={navItems}
          navGroups={navGroups}
          brand={t('brand')}
          // [8.14.3]: desktop-only now — below `md` the consolidated mobile
          // header row (`mobileHeaderActions`) carries search and the bell,
          // and `TenantBar` moves into the drawer (`drawerHeader`) instead of
          // stacking a second chrome row under this one. `topBar` itself
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
          mobileHeaderActions={
            <>
              <CommandPaletteLauncher />
              {notificationBell}
            </>
          }
          drawerHeader={
            <div className="mb-4 flex flex-col gap-2">
              <TenantBar />
              <div className="flex items-center gap-2">
                <SyncStatusIndicator />
                <ThemeToggle />
              </div>
            </div>
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
              items={[dashboardItem, studentsItem, duesItem, recordPaymentItem]}
              label={t('bottomNavStaffLabel')}
              more={{
                label: t('items.more'),
                icon: <MoreHorizontalIcon className="size-5" aria-hidden="true" />,
              }}
            />
          }
          openMenuLabel={t('openMenuLabel')}
          closeMenuLabel={t('closeMenuLabel')}
          navLabel={t('navLabel')}
          skipLinkLabel={t('skipToContent')}
        >
          {breadcrumbItems.length > 0 && (
            <Breadcrumbs
              items={breadcrumbItems}
              aria-label={t('breadcrumb.navLabel')}
              className="mb-4"
            />
          )}
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
        </AppShell>
      </ApprovalModalHostProvider>
    </RequireRole>
  );
}

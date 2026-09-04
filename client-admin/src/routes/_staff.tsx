import { Permission, STAFF_ROLES } from '@biddaloy/shared';
import {
  AccessDeniedState,
  AppHeader,
  AppShell,
  BottomNav,
  LocaleSwitcher,
  NotificationBell,
  SyncStatusIndicator,
  TenantBar,
  ThemeToggle,
  type AppShellNavGroup,
} from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { RequirePermission, RequireRole } from '@biddaloy/ui/routes';
import { createFileRoute, Outlet, useMatches, useNavigate } from '@tanstack/react-router';
import {
  BanknoteIcon,
  BellRingIcon,
  BriefcaseIcon,
  CalendarCheck2Icon,
  CalendarDaysIcon,
  ClipboardListIcon,
  FilePlus2Icon,
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

import { GlobalSearchLauncher } from '../components/global-search-launcher';
import { StaffUserMenu } from '../components/staff-user-menu';
import { loadRouteNamespaces } from '../route-loaders';
import { STAFF_ROUTE_PERMISSIONS } from '../route-permissions';

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

  // [8.14.3]: these four are the sidebar's own item objects, hoisted to
  // named consts so `bottomNavItems` below can reference the exact same
  // objects instead of a second, independently maintained list — one
  // permission per item, checked once by `BottomNav`'s own `hasPermission`
  // filter (the same gate the sidebar uses), so the two surfaces cannot
  // drift out of sync with each other.
  const dashboardItem = {
    to: '/dashboard',
    label: t('items.dashboard'),
    permission: Permission.DASHBOARD_VIEW,
    icon: <LayoutDashboardIcon aria-hidden="true" />,
  };
  const studentsItem = {
    to: '/students',
    label: t('items.students'),
    permission: Permission.STUDENT_READ,
    icon: <GraduationCapIcon aria-hidden="true" />,
  };
  const duesItem = {
    to: '/fees/dues',
    label: t('items.studentDues'),
    permission: Permission.FEE_COLLECT,
    icon: <HandCoinsIcon aria-hidden="true" />,
  };
  const recordPaymentItem = {
    to: '/payments/record',
    label: t('items.recordPayment'),
    permission: Permission.PAYMENT_RECORD,
    icon: <BanknoteIcon aria-hidden="true" />,
  };
  // [9.6] Gated on ATTENDANCE_READ — same "may you see it" reasoning as
  // `STAFF_ROUTE_PERMISSIONS`'s own comment on this route. Hoisted next to
  // `recordPaymentItem` rather than only inside a group: this is a daily,
  // teacher-facing task, so it also rides in the mobile bottom bar below.
  const attendanceItem = {
    to: '/attendance',
    label: t('items.attendance'),
    permission: Permission.ATTENDANCE_READ,
    icon: <CalendarCheck2Icon aria-hidden="true" />,
  };
  // [9.10] Same ATTENDANCE_READ gate as `attendanceItem` above — these are
  // read-only report/printable surfaces over [9.4]'s summary endpoints,
  // not a daily marking task, so unlike `attendanceItem` they live only in
  // the `people` group below, not the mobile bottom bar.
  const attendanceReportsItem = {
    to: '/attendance/reports',
    label: t('items.attendanceReports'),
    permission: Permission.ATTENDANCE_READ,
    icon: <ClipboardListIcon aria-hidden="true" />,
  };
  const attendanceRegisterItem = {
    to: '/attendance/register',
    label: t('items.attendanceRegister'),
    permission: Permission.ATTENDANCE_READ,
    icon: <PrinterIcon aria-hidden="true" />,
  };

  const navItems = [dashboardItem];

  // Domain groups per [8.9.6]'s issue text — "so future modules slot in
  // without restructuring". Academics and Communication aren't listed
  // here yet: no route exists for either domain until those feature
  // modules ([8.10.x]/[8.11.x]) land, and an empty group is exactly what
  // `AppShell` already renders nothing for. Adding a group later is then
  // just one more object in this array, not a layout change.
  const navGroups: AppShellNavGroup[] = [
    {
      id: 'people',
      label: t('groups.people'),
      items: [
        studentsItem,
        attendanceItem,
        attendanceReportsItem,
        attendanceRegisterItem,
        // [8.11.4] — gated on GUARDIAN_READ, the same permission
        // `GuardianController`'s `GET /guardians` requires server-side
        // (`students.controller.ts`'s `@Roles(ADMIN, ACCOUNTANT,
        // EXECUTIVE, TEACHER)` on that endpoint).
        {
          to: '/guardians',
          label: t('items.guardians'),
          permission: Permission.GUARDIAN_READ,
          icon: <UsersRoundIcon aria-hidden="true" />,
        },
        // [8.11.8] — gated on USER_READ, which ROLE_PERMISSIONS grants
        // to ADMIN only. Deliberately stricter than `GET /users`'s own
        // `@Roles(ADMIN, ACCOUNTANT, EXECUTIVE, TEACHER)` server-side —
        // the server-broader-than-ROLE_PERMISSIONS pattern is flagged
        // rather than fixed (see shared/src/enums/permissions.ts).
        {
          to: '/staff',
          label: t('items.staff'),
          permission: Permission.USER_READ,
          icon: <BriefcaseIcon aria-hidden="true" />,
        },
      ],
    },
    {
      id: 'finance',
      label: t('groups.finance'),
      // ACCOUNTANT's day runs through these two — pinned above the
      // rest of Finance. Gated on FEE_COLLECT/PAYMENT_RECORD rather than
      // the broader FEE_READ so TEACHER/EXECUTIVE (who hold FEE_READ for
      // read-only context elsewhere, e.g. a student's own record) don't
      // get a collection queue they can't act on.
      pinnedLabel: t('groups.quickActions'),
      pinnedItems: [duesItem, recordPaymentItem],
      items: [
        {
          to: '/fees',
          label: t('items.fees'),
          permission: Permission.FEE_STRUCTURE_READ,
          icon: <WalletIcon aria-hidden="true" />,
        },
        {
          to: '/fee-structures',
          label: t('items.feeStructures'),
          permission: Permission.FEE_STRUCTURE_READ,
          icon: <ListChecksIcon aria-hidden="true" />,
        },
        // [8.11.6] — FEE_GENERATE, the same permission
        // `FeeController.generateStudentFees`'s `@Roles(ADMIN, ACCOUNTANT)`
        // maps to, so TEACHER/EXECUTIVE never see a batch write they'd
        // only be refused at submit time.
        {
          to: '/fees/generate',
          label: t('items.generateFees'),
          permission: Permission.FEE_GENERATE,
          icon: <FilePlus2Icon aria-hidden="true" />,
        },
        {
          to: '/invoices',
          label: t('items.invoices'),
          permission: Permission.INVOICE_READ,
          icon: <ReceiptIcon aria-hidden="true" />,
        },
      ],
    },
    {
      id: 'communications',
      label: t('groups.communications'),
      items: [
        // [8.11.9] — COMMUNICATION_SEND matches `POST /communications/send`'s
        // `@Roles(ADMIN, ACCOUNTANT, EXECUTIVE, TEACHER)` for every role
        // ROLE_PERMISSIONS actually grants it to (EXECUTIVE's missing grant
        // is the flagged server-broader-than-ROLE_PERMISSIONS pattern, same
        // as `/staff` above).
        {
          to: '/communications/send',
          label: t('items.sendMessage'),
          permission: Permission.COMMUNICATION_SEND,
          icon: <SendIcon aria-hidden="true" />,
        },
        // Gated on COMMUNICATION_BULK_SEND, not COMMUNICATION_SEND: the
        // reminder routes are `@Roles(ADMIN, ACCOUNTANT, EXECUTIVE)` —
        // no TEACHER — and BULK_SEND is the permission whose holders
        // (ADMIN, ACCOUNTANT) are a subset of that server list. Gating on
        // SEND would show a TEACHER a page every request of which 403s.
        {
          to: '/communications/reminders',
          label: t('items.feeReminders'),
          permission: Permission.COMMUNICATION_BULK_SEND,
          icon: <BellRingIcon aria-hidden="true" />,
        },
        // Gated on COMMUNICATION_BULK_SEND rather than the plan's
        // COMMUNICATION_LOG_READ: the batch read routes are
        // `@Roles(ADMIN, ACCOUNTANT, EXECUTIVE)`, and ACCOUNTANT — the
        // story's primary persona — holds BULK_SEND but *not* LOG_READ
        // (ROLE_PERMISSIONS). Gating on LOG_READ would hide the history
        // this role's own bulk sends produce.
        {
          to: '/communications/batches',
          label: t('items.reminderHistory'),
          permission: Permission.COMMUNICATION_BULK_SEND,
          icon: <HistoryIcon aria-hidden="true" />,
        },
      ],
    },
    {
      id: 'administration',
      label: t('groups.administration'),
      items: [
        {
          to: '/academic-years',
          label: t('items.academicYears'),
          permission: Permission.ACADEMIC_YEAR_MANAGE,
          icon: <CalendarDaysIcon aria-hidden="true" />,
        },
        {
          to: '/classes',
          label: t('items.classes'),
          permission: Permission.CLASS_MANAGE,
          icon: <SchoolIcon aria-hidden="true" />,
        },
        // [8.11.10] — AUDIT_LOG_READ is ADMIN-only in `ROLE_PERMISSIONS`,
        // exactly matching `GET /audit-logs`'s own `@Roles(ADMIN)`. Every
        // other staff role sees no item at all rather than a page that
        // could only refuse them.
        {
          to: '/audit-logs',
          label: t('items.auditLogs'),
          permission: Permission.AUDIT_LOG_READ,
          icon: <ScrollTextIcon aria-hidden="true" />,
        },
        {
          to: '/settings',
          label: t('items.settings'),
          permission: Permission.SETTINGS_MANAGE,
          icon: <SettingsIcon aria-hidden="true" />,
        },
      ],
    },
  ];

  // [8.14.3]: hoisted so the desktop `topBar` and the mobile
  // `mobileHeaderActions` row share one definition instead of two
  // independently maintained copies of the same five props.
  // [8.14.11]: collapses further now that `NotificationBell` resolves its
  // own strings — see that component's header comment.
  const notificationBell = <NotificationBell viewAllTo="/notifications" />;

  return (
    <RequireRole allow={STAFF_ROLES} redirectTo="/portal">
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
                  <GlobalSearchLauncher />
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
            <GlobalSearchLauncher />
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
            items={[dashboardItem, studentsItem, attendanceItem, duesItem, recordPaymentItem]}
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
    </RequireRole>
  );
}

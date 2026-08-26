import { Permission, STAFF_ROLES } from '@biddaloy/shared';
import {
  AppShell,
  NotificationBell,
  TenantBar,
  type AppShellNavGroup,
} from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { RequireRole } from '@biddaloy/ui/routes';
import { createFileRoute, Outlet } from '@tanstack/react-router';

import { GlobalSearchLauncher } from '../components/global-search-launcher';

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
 * The guard is `RequireRole` — client-side gating, a UX nicety and not the
 * security boundary (that is `RolesGuard`/`ContextGuard` on the server,
 * which already answers 403 for a PARENT hitting `GET /students`). What it
 * fixes is the dead end: before this, a guardian who typed a staff URL got
 * a page whose every request failed, with nowhere else to go.
 */
export const Route = createFileRoute('/_staff')({
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

  const navItems = [
    { to: '/dashboard', label: t('items.dashboard'), permission: Permission.DASHBOARD_VIEW },
  ];

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
        { to: '/students', label: t('items.students'), permission: Permission.STUDENT_READ },
        // [8.11.4] — gated on GUARDIAN_READ, the same permission
        // `GuardianController`'s `GET /guardians` requires server-side
        // (`students.controller.ts`'s `@Roles(ADMIN, ACCOUNTANT,
        // EXECUTIVE, TEACHER)` on that endpoint).
        { to: '/guardians', label: t('items.guardians'), permission: Permission.GUARDIAN_READ },
        // [8.11.8] — gated on USER_READ, which ROLE_PERMISSIONS grants
        // to ADMIN only. Deliberately stricter than `GET /users`'s own
        // `@Roles(ADMIN, ACCOUNTANT, EXECUTIVE, TEACHER)` server-side —
        // the server-broader-than-ROLE_PERMISSIONS pattern is flagged
        // rather than fixed (see shared/src/enums/permissions.ts).
        { to: '/staff', label: t('items.staff'), permission: Permission.USER_READ },
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
      pinnedItems: [
        {
          to: '/fees/dues',
          label: t('items.studentDues'),
          permission: Permission.FEE_COLLECT,
        },
        {
          to: '/payments/record',
          label: t('items.recordPayment'),
          permission: Permission.PAYMENT_RECORD,
        },
      ],
      items: [
        { to: '/fees', label: t('items.fees'), permission: Permission.FEE_STRUCTURE_READ },
        {
          to: '/fee-structures',
          label: t('items.feeStructures'),
          permission: Permission.FEE_STRUCTURE_READ,
        },
        // [8.11.6] — FEE_GENERATE, the same permission
        // `FeeController.generateStudentFees`'s `@Roles(ADMIN, ACCOUNTANT)`
        // maps to, so TEACHER/EXECUTIVE never see a batch write they'd
        // only be refused at submit time.
        {
          to: '/fees/generate',
          label: t('items.generateFees'),
          permission: Permission.FEE_GENERATE,
        },
        { to: '/invoices', label: t('items.invoices'), permission: Permission.INVOICE_READ },
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
        },
        { to: '/classes', label: t('items.classes'), permission: Permission.CLASS_MANAGE },
        // [8.11.10] — AUDIT_LOG_READ is ADMIN-only in `ROLE_PERMISSIONS`,
        // exactly matching `GET /audit-logs`'s own `@Roles(ADMIN)`. Every
        // other staff role sees no item at all rather than a page that
        // could only refuse them.
        {
          to: '/audit-logs',
          label: t('items.auditLogs'),
          permission: Permission.AUDIT_LOG_READ,
        },
        { to: '/settings', label: t('items.settings'), permission: Permission.SETTINGS_MANAGE },
      ],
    },
  ];

  return (
    <RequireRole allow={STAFF_ROLES} redirectTo="/portal">
      <AppShell
        navItems={navItems}
        navGroups={navGroups}
        brand={t('brand')}
        topBar={
          <div className="flex flex-wrap items-center justify-between gap-x-2">
            <TenantBar />
            <div className="flex items-center gap-2">
              <GlobalSearchLauncher />
              <NotificationBell
                label={t('notifications.bellLabel')}
                panelTitle={t('notifications.panelLabel')}
                emptyLabel={t('notifications.empty')}
                markAllReadLabel={t('notifications.markAllRead')}
              />
            </div>
          </div>
        }
        openMenuLabel={t('openMenuLabel')}
        closeMenuLabel={t('closeMenuLabel')}
        navLabel={t('navLabel')}
        skipLinkLabel={t('skipToContent')}
      >
        <Outlet />
      </AppShell>
    </RequireRole>
  );
}

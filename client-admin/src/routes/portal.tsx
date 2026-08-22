import { GUARDIAN_ROLES, Permission } from '@biddaloy/shared';
import { AppShell, TenantBar } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { RequireRole } from '@biddaloy/ui/routes';
import { createFileRoute, Outlet } from '@tanstack/react-router';

/**
 * [8.9.10]'s guardian half of one SPA — the family-facing audience
 * (PARENT, STUDENT), pathed under `/portal` so its URLs are legible as a
 * different place rather than a differently-permissioned view of the same
 * one.
 *
 * Before this route existed, a PARENT who signed in landed on the staff
 * dashboard, saw a single sidebar link (Students, because
 * `ROLE_PERMISSIONS[PARENT]` carries `STUDENT_READ` for "read my child"),
 * and got a 403 on click, because `GET /students` means "read the roster"
 * to the server. Not a data leak — the server held — but a dead end,
 * because there was nowhere else to send them.
 *
 * A lighter shell than `_staff.tsx`: same `AppShell`, but no
 * `GlobalSearchLauncher` (staff search over students/receipts) and no
 * `NotificationBell` (staff notifications), because neither has a
 * guardian-scoped API behind it yet. `TenantBar` stays — a parent with
 * children at two schools switches the same way staff do, and [8.9.11]'s
 * role switcher is how a dual-role user gets back to their staff view
 * without logging out.
 *
 * The pages underneath are placeholders. The real portal — landing,
 * fee breakdown, invoice history, multi-child switching — is Epic 5.0
 * (#187), which also needs the family-facing read API (#19) that does not
 * exist yet. This ticket's job is the shell and the routing, so a
 * guardian has somewhere that is theirs instead of a 403.
 */
export const Route = createFileRoute('/portal')({
  component: PortalLayout,
});

function PortalLayout() {
  const { t } = useTranslation('nav');

  // `FEE_READ`/`INVOICE_READ` are what `ROLE_PERMISSIONS[PARENT]` and
  // `[STUDENT]` actually hold, so `AppShell`'s own `visibleItems()` filter
  // keeps this honest without a second list of "guardian links".
  const navItems = [
    { to: '/portal', label: t('items.portalOverview'), permission: Permission.FEE_READ },
    { to: '/portal/fees', label: t('items.portalFees'), permission: Permission.INVOICE_READ },
  ];

  return (
    <RequireRole allow={GUARDIAN_ROLES} redirectTo="/dashboard">
      <AppShell
        navItems={navItems}
        brand={t('brand')}
        topBar={<TenantBar />}
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

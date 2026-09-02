import { GUARDIAN_ROLES, Permission } from '@biddaloy/shared';
import {
  AppHeader,
  AppShell,
  BottomNav,
  SyncStatusIndicator,
  TenantBar,
  ThemeToggle,
} from '@biddaloy/ui/components';
import { useDensity } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { RequireRole } from '@biddaloy/ui/routes';
import { createFileRoute, Outlet } from '@tanstack/react-router';
import { CreditCardIcon, HomeIcon, UserRoundIcon } from 'lucide-react';

import { loadRouteNamespaces } from '../route-loaders';

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
  // [8.14.5]: same reasoning as `_staff.tsx`'s own loader — this
  // layout's chrome renders `nav` strings on every navigation, and
  // `portal` covers the guardian-facing leaf routes underneath it.
  loader: () => loadRouteNamespaces('nav', 'portal'),
  component: PortalLayout,
});

function PortalLayout() {
  const { t } = useTranslation('nav');

  // [8.13.8] Comfortable density (contract section 6): one attribute lifts
  // every control under the guardian shell to the 44 px WCAG SC 2.5.5 target,
  // without a single component prop changing. The staff shell sets no
  // attribute and so keeps today's 32 px controls.
  //
  // Set on `document.documentElement`, NOT on a wrapper element around
  // `AppShell`. A wrapper would miss everything Radix renders through a
  // portal into `document.body` — and on this shell that is the part that
  // matters most: the mobile off-canvas navigation IS a `DialogContent`, so
  // its close button (`size="icon-sm"`) and every nav link would have stayed
  // 28 px on the exact 360 px phone this rule exists for. `useDensity`
  // restores the previous value on unmount, so navigating (or going Back) to
  // a staff route leaves the document compact again.
  useDensity('comfortable');

  // `FEE_READ`/`INVOICE_READ` are what `ROLE_PERMISSIONS[PARENT]` and
  // `[STUDENT]` actually hold, so `AppShell`'s own `visibleItems()` filter
  // keeps this honest without a second list of "guardian links".
  //
  // [5.2]: one array, two renderings — the sidebar at >=768px and the
  // `BottomNav` below it. Icons are only ever decorative here; the label
  // is always real text, so an item is never an unlabelled glyph.
  const navItems = [
    {
      to: '/portal',
      label: t('items.portalOverview'),
      icon: <HomeIcon className="size-5" aria-hidden="true" />,
      permission: Permission.FEE_READ,
    },
    {
      to: '/portal/fees',
      label: t('items.portalFees'),
      icon: <CreditCardIcon className="size-5" aria-hidden="true" />,
      permission: Permission.INVOICE_READ,
    },
    {
      to: '/portal/account',
      label: t('items.portalAccount'),
      icon: <UserRoundIcon className="size-5" aria-hidden="true" />,
      // [8.14.4] No `permission`: every signed-in role in this shell owns
      // its own account — this is the exact "everyone in the shell sees
      // it" case `app-shell.tsx`'s `NavItem.permission` documents.
    },
  ];

  return (
    <RequireRole allow={GUARDIAN_ROLES} redirectTo="/dashboard">
      <AppShell
        navItems={navItems}
        brand={t('brand')}
        topBar={
          <AppHeader
            start={<TenantBar />}
            end={
              <>
                <SyncStatusIndicator />
                <ThemeToggle />
              </>
            }
          />
        }
        openMenuLabel={t('openMenuLabel')}
        closeMenuLabel={t('closeMenuLabel')}
        navLabel={t('navLabel')}
        skipLinkLabel={t('skipToContent')}
        bottomNav={<BottomNav items={navItems} label={t('bottomNavLabel')} />}
      >
        <Outlet />
      </AppShell>
    </RequireRole>
  );
}

import { UserRole } from '@biddaloy/shared';
import { useTranslation } from '@biddaloy/ui/i18n';
import { RequireRole } from '@biddaloy/ui/routes';
import { createFileRoute, Link, Outlet } from '@tanstack/react-router';

import { loadRouteNamespaces } from '../../route-loaders';

/**
 * #533's SUPER_ADMIN platform console — a pathless layout, same
 * "`_`-prefixed folder = no path segment of its own" convention
 * `_staff.tsx`/`portal.tsx` already use (see `_staff.tsx`'s header
 * comment). Every route under `_platform/` (`/schools`, `/schools/:id`,
 * ...) sits directly at that URL, e.g. `_platform/schools/index.tsx` is
 * `/schools`.
 *
 * A **separate** top-level layout from `_staff`, not nested inside it —
 * `STAFF_ROLES` includes `SUPER_ADMIN` (`shared/src/enums/audiences.ts`),
 * so a SUPER_ADMIN's day-to-day tenant work still lives in the ordinary
 * staff shell; this is a distinct, narrower admin console they step into
 * (via the nav link `_staff.tsx` renders for them, see that file's
 * `platformItem`), not a section of it. Redirects to `/dashboard` rather
 * than `/portal` — the same non-SUPER_ADMIN staff role that would land
 * here already belongs in the staff shell, just not this console.
 *
 * `RequireRole` here is the same **UX-only** gate `_staff.tsx` uses —
 * the server's own `@Roles(UserRole.SUPER_ADMIN)` on every `/schools`
 * route (`schools.controller.ts`) is the actual security boundary.
 */
export const Route = createFileRoute('/_platform')({
  loader: () => loadRouteNamespaces('platform'),
  component: PlatformLayout,
});

function PlatformLayout() {
  const { t } = useTranslation('platform');
  return (
    <RequireRole allow={[UserRole.SUPER_ADMIN]} redirectTo="/dashboard">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link to="/dashboard" className="inline-flex min-h-6 items-center underline">
            {t('breadcrumb.dashboard')}
          </Link>
          <span aria-hidden="true">/</span>
          <span>{t('breadcrumb.platformAdmin')}</span>
        </div>
        <Outlet />
      </div>
    </RequireRole>
  );
}

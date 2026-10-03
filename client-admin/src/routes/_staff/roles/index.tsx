/**
 * [24.3.5] Roles & access — a read-only comparison of every staff role.
 * No data fetch and no button: the content is the shared `ROLE_PERMISSIONS` /
 * `ROLE_SCOPE` tables the server enforces. Gated on `USER_READ` by
 * `_staff.tsx`'s `RequirePermission` (`route-permissions.ts`).
 */
import { UserRole } from '@biddaloy/shared';
import { RoutePending } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';

import { loadRouteNamespaces } from '../../../route-loaders';

import { RoleCard } from './-role-card';

/** Every staff role a school can assign, in D23 (`ROLE_PRIORITY`) order. SUPER_ADMIN
 * is left out: a platform role no school can grant (#731). The test checks this
 * covers every other `STAFF_ROLES` entry. */
const ROLE_CARD_ORDER = [
  UserRole.ADMIN,
  UserRole.ACCOUNTANT,
  UserRole.EXECUTIVE,
  UserRole.TEACHER,
  UserRole.EXAM_CONTROLLER,
  UserRole.OFFICE_STAFF,
  UserRole.COMMITTEE,
] as const;

export const Route = createFileRoute('/_staff/roles/')({
  loader: () => loadRouteNamespaces('staff'),
  pendingComponent: RolesPending,
  component: RolesRoute,
});

function RolesPending() {
  const { t } = useTranslation('staff');
  return <RoutePending variant="detail" label={t('rolesAccess.title')} />;
}

function RolesRoute() {
  const { t } = useTranslation('staff');
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">{t('rolesAccess.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('rolesAccess.subtitle')}</p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {ROLE_CARD_ORDER.map((role) => (
          <RoleCard key={role} role={role} />
        ))}
      </div>
    </div>
  );
}

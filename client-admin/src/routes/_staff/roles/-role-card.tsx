/**
 * [24.3.5] One role on the read-only Roles & access page: label,
 * one-line description, data scope, and the grouped permission list.
 * Nothing here is interactive except the native `<details>` groups.
 */
import { ROLE_PERMISSIONS, ROLE_SCOPE, type UserRole } from '@biddaloy/shared';
import { Card } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';

import { PermissionGroupList } from '../staff/-detail/permissions-tab';

export interface RoleCardProps {
  role: UserRole;
}

export function RoleCard({ role }: RoleCardProps) {
  const { t } = useTranslation('staff');
  const permissions = ROLE_PERMISSIONS[role];

  return (
    <Card className="flex flex-col gap-3 p-4" data-testid={`role-card-${role}`}>
      <div>
        <h2 className="text-base font-semibold">{t(`roles.${role}`)}</h2>
        <p className="text-sm text-muted-foreground">{t(`roleDescriptions.${role}`)}</p>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <dl>
          <dt className="sr-only">{t('rolesAccess.scopeLabel')}</dt>
          <dd>{t(`rolesAccess.scope.${ROLE_SCOPE[role]}`)}</dd>
        </dl>
        <p className="text-muted-foreground">
          {t('rolesAccess.permissionCount', { count: permissions.length })}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <PermissionGroupList permissions={permissions} collapsible />
      </div>
    </Card>
  );
}

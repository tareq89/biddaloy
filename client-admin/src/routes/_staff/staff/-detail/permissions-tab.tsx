import { ROLE_PERMISSIONS, type Permission, type UserRole } from '@biddaloy/shared';
import { useUser } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { CheckIcon } from 'lucide-react';

import { PERMISSION_GROUPS } from './permission-groups';
import { TabQueryState } from './tab-query-state';

export interface PermissionsTabProps {
  userId: string;
}

export interface PermissionGroupListProps {
  permissions: readonly Permission[];
  /** Render each group as a native `<details>` (toggles with Enter/Space,
   * collapsed by default) instead of an always-open block. */
  collapsible?: boolean;
}

/** The grouped, read-only, translated permission list — shared by the staff
 * detail Permissions tab and the Roles & access cards. */
export function PermissionGroupList({
  permissions,
  collapsible = false,
}: PermissionGroupListProps) {
  const { t } = useTranslation('staff');
  const regionConfig = useRegionConfig();
  const held = new Set<Permission>(permissions);
  const groups = PERMISSION_GROUPS.map((group) => ({
    id: group.id,
    items: group.permissions.filter((permission) => held.has(permission)),
  })).filter((group) => group.items.length > 0);

  const body = (
    <>
      {groups.map(({ id, items }) => {
        const title = `${t(`permissions.groups.${id}`)} (${formatNumber(items.length, regionConfig)})`;
        const list = (
          <ul className="mt-2 space-y-1 text-text-primary">
            {items.map((permission) => (
              <li key={permission} className="flex items-start gap-2">
                <CheckIcon className="mt-0.5 size-4 shrink-0 text-status-paid-fg" aria-hidden />
                {t(`permissions.items.${permission}`)}
              </li>
            ))}
          </ul>
        );
        return collapsible ? (
          <details key={id} className="rounded-md border border-border-subtle px-3 py-2">
            <summary className="cursor-pointer text-label font-semibold">{title}</summary>
            <div className="mt-1">{list}</div>
          </details>
        ) : (
          <section key={id} aria-label={t(`permissions.groups.${id}`)}>
            <h3 className="text-h3">{title}</h3>
            {list}
          </section>
        );
      })}
    </>
  );
  // Collapsible callers (the Roles cards) own their own layout.
  return collapsible ? body : <div className="grid gap-4 md:grid-cols-3">{body}</div>;
}

/**
 * [8.11.8]'s "Permissions tab renders read-only from `ROLE_PERMISSIONS`"
 * AC — the access model made visible to administrators instead of
 * implicit. Deliberately not editable: permissions follow the role, and
 * the server enforces this exact list (`RolesGuard`).
 */
export function PermissionsTab({ userId }: PermissionsTabProps) {
  const { t } = useTranslation('staff');
  const query = useUser(userId);

  return (
    <TabQueryState
      query={query}
      forbiddenMessage={t('detail.forbidden')}
      errorMessage={t('detail.loadError')}
    >
      {(user) => {
        if (user.role === null) {
          return <p className="text-text-secondary">{t('detail.permissions.unknownRole')}</p>;
        }
        return (
          <section className="rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5">
            <p className="text-text-secondary">{t('detail.permissions.explainer')}</p>
            <div className="mt-4">
              <PermissionGroupList permissions={ROLE_PERMISSIONS[user.role as UserRole]} />
            </div>
          </section>
        );
      }}
    </TabQueryState>
  );
}

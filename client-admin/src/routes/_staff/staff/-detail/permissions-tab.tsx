import { ROLE_PERMISSIONS, type Permission, type UserRole } from '@biddaloy/shared';
import { useUser } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

import { TabQueryState } from './tab-query-state';

export interface PermissionsTabProps {
  userId: string;
}

/** "USER_CREATE" → domain "User", label "Create" — a readable grouping
 * derived from the permission names themselves, the same
 * humanize-the-enum approach `StatusBadge` documents (not real i18n; the
 * permission identifiers are the stable, meaningful values here). */
function groupPermissions(permissions: readonly Permission[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const permission of permissions) {
    const [domain, ...rest] = permission.split('_');
    const key = domain ?? permission;
    const label = permission
      .toLowerCase()
      .replace(/_/g, ' ')
      .replace(/^./, (c) => c.toUpperCase());
    groups.set(key, [...(groups.get(key) ?? []), label]);
    void rest;
  }
  return groups;
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
          return (
            <p className="text-sm text-muted-foreground">{t('detail.permissions.unknownRole')}</p>
          );
        }
        const groups = groupPermissions(ROLE_PERMISSIONS[user.role as UserRole]);
        return (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">{t('detail.permissions.explainer')}</p>
            {[...groups.entries()].map(([domain, labels]) => (
              <section key={domain} aria-label={domain}>
                <h3 className="mb-1 text-sm font-semibold capitalize">{domain.toLowerCase()}</h3>
                <ul className="list-inside list-disc text-sm">
                  {labels.map((label) => (
                    <li key={label}>{label}</li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        );
      }}
    </TabQueryState>
  );
}

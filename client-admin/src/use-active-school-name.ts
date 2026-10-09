import { decodeAccessTokenMemberships } from '@biddaloy/ui/api';
import { useAccessToken, useActiveRole, useActiveTenant } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

/** The active school's name for the phone top bar (`mobileTitle`). Same lookup as `TenantBar`. */
export function useActiveSchoolName(): string {
  const { t } = useTranslation('nav');
  const tenantId = useActiveTenant();
  const role = useActiveRole();
  const token = useAccessToken();
  const memberships = token ? decodeAccessTokenMemberships(token) : [];
  // Tenant and role: two memberships at one school must not both report the first.
  const active = memberships.find(
    (m) => m.tenantId === tenantId && (role === null || (m.role as string) === role),
  );
  return active?.name ?? t('tenantBar.unnamedSchool');
}

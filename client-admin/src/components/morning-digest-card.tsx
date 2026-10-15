/**
 * [8.10.7.5.13] "Morning summary" opt-out on the staff `/security` page (D31).
 * One checkbox for ADMIN / EXECUTIVE / TEACHER, the only roles that get the
 * digest push. The preference is per user, so it covers every school they
 * belong to. Absent = on. Request is hand-typed: `schema.d.ts` lags (5-99).
 */
import { apiClient } from '@biddaloy/ui/api';
import { Card, Checkbox, toast } from '@biddaloy/ui/components';
import {
  currentUserQueryOptions,
  useActiveRole,
  useActiveTenant,
  useSchoolSettings,
} from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatTime } from '@biddaloy/ui/utils';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { MutationErrorMessage } from './MutationErrorMessage';

const DIGEST_ROLES = ['ADMIN', 'EXECUTIVE', 'TEACHER'];

export function MorningDigestCard() {
  const role = useActiveRole();
  const visible = role !== null && DIGEST_ROLES.includes(role);
  // Hooks run before the role gate; `enabled` keeps a hidden card request-free.
  const { t } = useTranslation('dashboard');
  const config = useTenantRegionConfig();
  const queryClient = useQueryClient();
  const tenantId = useActiveTenant();
  const me = useQuery({ ...currentUserQueryOptions(), enabled: visible });
  // Settings are ADMIN-only on the server; others get no time (never the 07:30 default).
  const settings = useSchoolSettings(role === 'ADMIN' ? (tenantId ?? '') : '');
  const save = useMutation({
    mutationFn: async (enabled: boolean) =>
      (await apiClient.patch<{ enabled: boolean }>('/users/me/preferences/digest', { enabled }))
        .data,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: currentUserQueryOptions().queryKey });
      toast.success(t('digest.saved'));
    },
  });

  if (!visible) return null;

  const stored = (me.data?.preferences as { digest?: { enabled?: boolean } } | null)?.digest
    ?.enabled;
  const enabled = stored !== false;
  const digestTime = settings.data?.dashboard?.digestTime;
  const needsPush = typeof Notification !== 'undefined' && Notification.permission !== 'granted';

  return (
    <Card padded aria-labelledby="morning-digest-title" className="flex flex-col gap-3">
      <div>
        <h2 id="morning-digest-title" className="text-h2">
          {t('digest.title')}
        </h2>
        {digestTime && (
          <p className="mt-1 text-text-secondary">
            {t('digest.description', { time: formatTime(digestTime, config) })}
          </p>
        )}
      </div>
      <div className="flex min-h-11 items-center gap-3 md:min-h-0">
        <Checkbox
          id="morning-digest-toggle"
          checked={enabled}
          disabled={me.isPending || save.isPending}
          onCheckedChange={(next) => save.mutate(next === true)}
        />
        <label htmlFor="morning-digest-toggle" className="text-label">
          {t('digest.toggle')}
        </label>
      </div>
      {save.isError && <MutationErrorMessage error={save.error} />}
      {needsPush && <p className="text-caption text-text-secondary">{t('digest.needsPush')}</p>}
    </Card>
  );
}

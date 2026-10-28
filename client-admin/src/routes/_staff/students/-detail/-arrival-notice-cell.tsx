import { Permission } from '@biddaloy/shared';
import {
  Button,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  StatusBadge,
  type StatusTone,
} from '@biddaloy/ui/components';
import {
  useArrivalSubscriptions,
  useCreateArrivalSubscription,
  useHasPermission,
  useLockArrivalSubscription,
  usePatchArrivalSubscription,
  type ArrivalLock,
  type Guardian,
  type StaffArrivalSubscription,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate } from '@biddaloy/ui/utils';
import { MoreVertical } from 'lucide-react';

export interface ArrivalNoticeCellProps {
  studentId: string;
  sectionId: string;
  guardian: Guardian;
}

type BadgeKey =
  'none' | 'waiting' | 'once' | 'daily' | 'done' | 'off' | 'adminAlways' | 'adminNever';

const TONE: Record<BadgeKey, StatusTone> = {
  none: 'neutral',
  waiting: 'warning',
  once: 'info',
  daily: 'success',
  done: 'neutral',
  off: 'neutral',
  adminAlways: 'success',
  adminNever: 'danger',
};

function badgeKey(sub: StaffArrivalSubscription | undefined): BadgeKey {
  if (!sub) return 'none';
  if (sub.lock === 'ALWAYS') return 'adminAlways';
  if (sub.lock === 'NEVER') return 'adminNever';
  if (sub.status === 'REQUESTED') return 'waiting';
  if (sub.status === 'OFF') return 'off';
  if (sub.mode === 'ONCE') return sub.consumed_at ? 'done' : 'once';
  return 'daily';
}

/** One guardian's arrival-notice state plus the MANAGE / LOCK menu ([84.3.2], D5, D16, D35).
 * The staff list has no student filter, so it is read per section and narrowed here. */
export function ArrivalNoticeCell({ studentId, sectionId, guardian }: ArrivalNoticeCellProps) {
  const { t } = useTranslation('students');
  const config = useRegionConfig();
  const canManage = useHasPermission(Permission.ATTENDANCE_ARRIVAL_NOTICE_MANAGE);
  const canLock = useHasPermission(Permission.ATTENDANCE_ARRIVAL_NOTICE_LOCK);
  const list = useArrivalSubscriptions({ sectionId, limit: 100 });
  const create = useCreateArrivalSubscription();
  const patch = usePatchArrivalSubscription();
  const lockMutation = useLockArrivalSubscription();

  const sub = list.data?.find((s) => s.student_id === studentId && s.guardian_id === guardian.id);
  const key = badgeKey(sub);
  const locked = sub !== undefined && sub.lock !== 'NONE';
  const busy = create.isPending || patch.isPending || lockMutation.isPending;
  const failed = create.isError || patch.isError || lockMutation.isError;

  const setMode = (mode: 'ONCE' | 'RECURRING') => {
    if (sub) patch.mutate({ id: sub.id, input: { status: 'ACTIVE', mode } });
    else create.mutate({ student_id: studentId, guardian_id: guardian.id, mode });
  };
  const setLock = (lock: ArrivalLock) => {
    if (sub) lockMutation.mutate({ id: sub.id, lock });
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <StatusBadge tone={TONE[key]} label={t(`detail.guardians.arrival.status.${key}`)} />
        {sub && (
          <span className="text-caption text-text-secondary">
            {t(`detail.guardians.arrival.channel.${sub.channel}`)}
          </span>
        )}
        {(canManage || canLock) && (
          <Menu>
            <MenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                iconOnly
                disabled={busy}
                aria-label={t('detail.guardians.arrival.menuLabel', { name: guardian.full_name })}
              >
                <MoreVertical aria-hidden="true" />
              </Button>
            </MenuTrigger>
            <MenuContent align="end">
              {canManage && (
                <>
                  <MenuItem disabled={locked} onSelect={() => setMode('ONCE')}>
                    {t('detail.guardians.arrival.action.once')}
                  </MenuItem>
                  <MenuItem disabled={locked} onSelect={() => setMode('RECURRING')}>
                    {t('detail.guardians.arrival.action.daily')}
                  </MenuItem>
                  <MenuItem
                    disabled={locked || !sub || sub.status === 'OFF'}
                    onSelect={() => sub && patch.mutate({ id: sub.id, input: { status: 'OFF' } })}
                  >
                    {t('detail.guardians.arrival.action.stop')}
                  </MenuItem>
                  {locked && (
                    <p className="px-2 py-1 text-caption text-text-secondary">
                      {t('detail.guardians.arrival.lockedNote')}
                    </p>
                  )}
                </>
              )}
              {canLock && (
                <>
                  {canManage && <MenuSeparator />}
                  <MenuItem disabled={!sub} onSelect={() => setLock('ALWAYS')}>
                    {t('detail.guardians.arrival.action.always')}
                  </MenuItem>
                  <MenuItem disabled={!sub} onSelect={() => setLock('NEVER')}>
                    {t('detail.guardians.arrival.action.never')}
                  </MenuItem>
                  <MenuItem disabled={!sub || sub.lock === 'NONE'} onSelect={() => setLock('NONE')}>
                    {t('detail.guardians.arrival.action.clear')}
                  </MenuItem>
                </>
              )}
            </MenuContent>
          </Menu>
        )}
      </div>
      {sub && (
        <span className="text-caption text-text-secondary">
          {t('detail.guardians.arrival.updatedOn', {
            date: formatDate(new Date(sub.updated_at), config),
          })}
        </span>
      )}
      {failed && (
        <span role="alert" className="text-danger text-caption">
          {t('detail.guardians.arrival.error')}
        </span>
      )}
    </div>
  );
}

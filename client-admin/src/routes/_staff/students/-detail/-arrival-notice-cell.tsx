import { Permission } from '@biddaloy/shared';
import {
  Button,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Skeleton,
  StatusBadge,
  type StatusTone,
} from '@biddaloy/ui/components';
import {
  isArrivalDisabledError,
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
  // A used "Once" ends OFF with `consumed_at` set: Done, as on My class and the portal.
  if (sub.status === 'OFF') return sub.consumed_at ? 'done' : 'off';
  if (sub.mode === 'ONCE') return 'once';
  return 'daily';
}

/** One guardian's arrival-notice state plus the MANAGE / LOCK menu ([84.3.2], D5, D16, D35).
 * The list is read with the `studentId` filter (the same filters as the tab's read, so the
 * query key is shared). Lock-to-create (D35): with no row the create call carries the lock,
 * so row and lock are saved together. */
export function ArrivalNoticeCell({ studentId, sectionId, guardian }: ArrivalNoticeCellProps) {
  const { t } = useTranslation('students');
  const config = useRegionConfig();
  const canManage = useHasPermission(Permission.ATTENDANCE_ARRIVAL_NOTICE_MANAGE);
  const canLock = useHasPermission(Permission.ATTENDANCE_ARRIVAL_NOTICE_LOCK);
  // Same query key as the Guardians tab's read, so this is the cached list, not a new call.
  const list = useArrivalSubscriptions({ sectionId, studentId });
  const create = useCreateArrivalSubscription();
  const patch = usePatchArrivalSubscription();
  const lockMutation = useLockArrivalSubscription();

  const sub = list.data?.find((s) => s.guardian_id === guardian.id);
  const key = badgeKey(sub);
  const locked = sub !== undefined && sub.lock !== 'NONE';
  const busy = create.isPending || patch.isPending || lockMutation.isPending;
  const failure = create.error ?? patch.error ?? lockMutation.error;
  const failed = create.isError || patch.isError || lockMutation.isError;

  const setMode = (mode: 'ONCE' | 'RECURRING') => {
    if (sub) patch.mutate({ id: sub.id, input: { status: 'ACTIVE', mode } });
    else create.mutate({ student_id: studentId, guardian_id: guardian.id, mode });
  };
  const setLock = (lock: ArrivalLock) => {
    if (sub) {
      lockMutation.mutate({ id: sub.id, lock });
      return;
    }
    // No row yet: one call makes it already locked (every day), so a failed or abandoned
    // second call can never leave an unlocked ACTIVE row behind.
    create.mutate({ student_id: studentId, guardian_id: guardian.id, mode: 'RECURRING', lock });
  };

  // No state is known yet (loading) or at all (failed): never claim "Not asked" and never
  // offer choices that cannot be saved.
  if (list.isPending) return <Skeleton className="h-6 w-24" />;
  if (list.isError) {
    return <span className="text-text-secondary">{t('list.emptyValue')}</span>;
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <StatusBadge tone={TONE[key]} label={t(`detail.guardians.arrival.status.${key}`)} />
        {sub && (
          <span className="text-caption text-text-secondary">
            {t(`detail.guardians.arrival.channel.${sub.channel}`)}
          </span>
        )}
        {canManage && (
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
                </>
              )}
              {canLock && (
                <>
                  {canManage && <MenuSeparator />}
                  <MenuItem onSelect={() => setLock('ALWAYS')}>
                    {t('detail.guardians.arrival.action.always')}
                  </MenuItem>
                  <MenuItem onSelect={() => setLock('NEVER')}>
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
      {locked && canManage && (
        // Outside the menu (a <p> in role="menu" is skipped by screen readers): the reason the
        // three choices are greyed out.
        <span className="text-caption text-text-secondary">
          {t('detail.guardians.arrival.lockedNote')}
        </span>
      )}
      {sub && !sub.notifications_enabled && (
        <span className="text-caption text-text-secondary">
          {t('detail.guardians.arrival.notificationsOff')}
        </span>
      )}
      {sub?.set_by_name && sub.set_at && (
        <span className="text-caption text-text-secondary">
          {t('detail.guardians.arrival.setBy', {
            name: sub.set_by_name,
            date: formatDate(new Date(sub.set_at), config),
          })}
        </span>
      )}
      {sub?.locked_by_name && sub.locked_at && sub.lock !== 'NONE' && (
        <span className="text-caption text-text-secondary">
          {t('detail.guardians.arrival.lockedBy', {
            name: sub.locked_by_name,
            date: formatDate(new Date(sub.locked_at), config),
          })}
        </span>
      )}
      {failed && (
        <span role="alert" className="text-danger text-caption">
          {t(
            isArrivalDisabledError(failure)
              ? 'detail.guardians.arrival.disabled'
              : 'detail.guardians.arrival.error',
          )}
        </span>
      )}
    </div>
  );
}

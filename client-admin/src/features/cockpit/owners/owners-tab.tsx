import {
  Button,
  Card,
  ConfirmDialog,
  ErrorState,
  StatusBadge,
  toast,
} from '@biddaloy/ui/components';
import {
  ApprovalCancelledError,
  getApprovalRequestId,
  useLockOwner,
  usePlatformApprovals,
  usePlatformOwners,
  useUnlockOwner,
  type PlatformOwner,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDateTime } from '@biddaloy/ui/utils';
import * as React from 'react';

/**
 * Owners tab of `/platform-owners`: one card per owner (never a table). Locking or unlocking the
 * other owner goes ConfirmDialog (what is lost) then the code prompt that `useApprovedMutation`
 * opens. The server's own checks (self, last active owner) are the boundary; the disabled button
 * is the same rule shown early.
 */
export interface OwnersTabProps {
  currentUserId: string | null;
  /** Jump to the Approval requests tab (a lock can answer "waiting for the other owner"). */
  onOpenApprovals: () => void;
}

export function OwnersTab({ currentUserId, onOpenApprovals }: OwnersTabProps) {
  const { t } = useTranslation('platformOwners');
  const config = useRegionConfig();
  const owners = usePlatformOwners();
  const lock = useLockOwner();
  const unlock = useUnlockOwner();
  const [target, setTarget] = React.useState<PlatformOwner | null>(null);
  const approvals = usePlatformApprovals();
  const [waiting, setWaiting] = React.useState(false);
  // Gone once the server shows no pending request of mine (decided, expired), or when dismissed.
  const showWaiting =
    waiting &&
    (!approvals.data ||
      approvals.data.some((a) => a.status === 'PENDING' && a.requested_by === currentUserId));

  if (owners.isError) {
    return <ErrorState message={t('owners.loadError')} onRetry={() => void owners.refetch()} />;
  }
  const list = owners.data ?? [];
  const activeCount = list.filter((o) => o.status === 'ACTIVE').length;
  const busy = lock.isPending || unlock.isPending;

  async function confirm() {
    if (!target) return;
    const unlocking = target.status === 'LOCKED';
    try {
      await (unlocking ? unlock : lock).mutateAsync(target.userId);
      toast.success(t(unlocking ? 'owners.unlocked' : 'owners.locked', { name: target.fullName }));
      setWaiting(false);
    } catch (error) {
      if (error instanceof ApprovalCancelledError) {
        // The owner closed the code prompt: nothing to say.
      } else if (getApprovalRequestId(error)) {
        setWaiting(true);
        void approvals.refetch();
      } else {
        toast.error(t('owners.actionError'));
      }
    }
    setTarget(null);
  }

  return (
    <div className="flex flex-col gap-3">
      {showWaiting && (
        <Card role="status" className="flex flex-wrap items-center justify-between gap-2 p-4">
          <span>{t('owners.waiting')}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="lg" onClick={onOpenApprovals}>
              {t('owners.seeRequests')}
            </Button>
            <Button variant="outline" size="lg" onClick={() => setWaiting(false)}>
              {t('owners.dismiss')}
            </Button>
          </div>
        </Card>
      )}
      {list.map((owner) => {
        const isSelf = owner.userId === currentUserId;
        const locked = owner.status === 'LOCKED';
        const lockBlocked = !locked && (isSelf || activeCount <= 1);
        const note = lockBlocked
          ? t(isSelf ? 'owners.lockDisabledSelf' : 'owners.lockDisabledLast')
          : null;
        return (
          <Card
            key={owner.userId}
            role="group"
            aria-label={owner.fullName}
            className="flex flex-col gap-3 p-4 md:flex-row md:items-center"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-h3">{owner.fullName}</h2>
                {isSelf && (
                  <span className="text-caption text-text-secondary">{t('owners.you')}</span>
                )}
                <StatusBadge
                  tone={locked ? 'warning' : 'success'}
                  label={t(`owners.status.${owner.status}`)}
                />
              </div>
              <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-body sm:grid-cols-2">
                <div>
                  <dt className="sr-only">{t('owners.email')}</dt>
                  <dd>{owner.email ?? t('owners.noContact')}</dd>
                </div>
                <div>
                  <dt className="sr-only">{t('owners.phone')}</dt>
                  <dd>{owner.phone ?? t('owners.noContact')}</dd>
                </div>
                <div>
                  <dt className="text-caption text-text-secondary">{t('owners.lastSignIn')}</dt>
                  <dd>
                    {owner.lastLoginAt
                      ? formatDateTime(owner.lastLoginAt, config)
                      : t('owners.neverSignedIn')}
                  </dd>
                </div>
                <div>
                  <dt className="text-caption text-text-secondary">{t('owners.twoStep')}</dt>
                  <dd>{t(owner.mfaEnrolled ? 'owners.twoStepOn' : 'owners.twoStepOff')}</dd>
                </div>
              </dl>
              {locked && owner.lockedByName && (
                <p className="mt-1 text-caption text-text-secondary">
                  {t('owners.lockedBy', { name: owner.lockedByName })}
                </p>
              )}
            </div>
            {!isSelf || lockBlocked ? (
              <div className="flex flex-col gap-1 md:items-end">
                <Button
                  size="lg"
                  className="min-h-11 md:min-w-32"
                  disabled={lockBlocked || busy}
                  onClick={() => setTarget(owner)}
                >
                  {t(locked ? 'owners.unlock' : 'owners.lock')}
                </Button>
                {note && <span className="text-caption text-text-secondary">{note}</span>}
              </div>
            ) : null}
          </Card>
        );
      })}
      {target && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setTarget(null)}
          title={t(target.status === 'LOCKED' ? 'owners.unlockTitle' : 'owners.lockTitle', {
            name: target.fullName,
          })}
          description={t(
            target.status === 'LOCKED' ? 'owners.unlockDescription' : 'owners.lockDescription',
          )}
          confirmLabel={t(target.status === 'LOCKED' ? 'owners.unlock' : 'owners.lock')}
          tone={target.status === 'LOCKED' ? 'default' : 'danger'}
          busy={busy}
          onConfirm={() => void confirm()}
        />
      )}
    </div>
  );
}

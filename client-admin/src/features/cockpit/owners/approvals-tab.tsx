import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  StatusBadge,
  Switch,
  toast,
} from '@biddaloy/ui/components';
import {
  ApprovalCancelledError,
  getApprovalRequestId,
  useApprovalsSetting,
  useDecideApproval,
  usePlatformApprovals,
  usePlatformOwners,
  useSetApprovalsSetting,
  type PlatformApproval,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { formatRelativeAge } from '@biddaloy/ui/utils';
import * as React from 'react';

const TONE = {
  PENDING: 'warning',
  GRANTED: 'success',
  DENIED: 'danger',
  USED: 'neutral',
  EXPIRED: 'neutral',
} as const;

/**
 * Approval requests tab: the approvals switch on top, then every request. A request the OTHER
 * owner made shows Approve and Deny (each asks for a code); your own pending one shows
 * "Waiting for <name>".
 */
export function ApprovalsTab({ currentUserId }: { currentUserId: string | null }) {
  const { t, i18n } = useTranslation('platformOwners');
  const approvals = usePlatformApprovals();
  const owners = usePlatformOwners();
  const setting = useApprovalsSetting();
  const decide = useDecideApproval();
  const setSetting = useSetApprovalsSetting();
  const [confirmSwitch, setConfirmSwitch] = React.useState(false);
  const [switchWaiting, setSwitchWaiting] = React.useState(false);

  const nameOf = (id: string) => owners.data?.find((o) => o.userId === id)?.fullName;
  const otherName = owners.data?.find((o) => o.userId !== currentUserId)?.fullName;
  const enabled = setting.data?.enabled ?? true;

  async function flip() {
    try {
      await setSetting.mutateAsync({ enabled: !enabled });
      toast.success(t(enabled ? 'approvals.switch.turnedOff' : 'approvals.switch.turnedOn'));
      setSwitchWaiting(false);
    } catch (error) {
      if (error instanceof ApprovalCancelledError) {
        // Code prompt closed: nothing to say.
      } else if (getApprovalRequestId(error)) {
        setSwitchWaiting(true);
      } else {
        toast.error(t('approvals.actionError'));
      }
    }
    setConfirmSwitch(false);
  }

  async function answer(id: string, decision: 'approve' | 'deny') {
    try {
      await decide.mutateAsync({ id, decision });
      toast.success(t(decision === 'approve' ? 'approvals.approved' : 'approvals.denied'));
    } catch (error) {
      if (!(error instanceof ApprovalCancelledError)) toast.error(t('approvals.actionError'));
    }
  }

  const list = approvals.data ?? [];
  const renderRequest = (a: PlatformApproval) => {
    const mine = a.requested_by === currentUserId;
    const requester = nameOf(a.requested_by) ?? t('approvals.otherOwner');
    return (
      <Card key={a.id} className="flex flex-col gap-3 p-4 md:flex-row md:items-center">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-h3">
              {t(`approvals.scopes.${a.scope}`, { defaultValue: t('approvals.scopeFallback') })}
            </h2>
            <StatusBadge tone={TONE[a.status]} label={t(`approvals.status.${a.status}`)} />
          </div>
          <p className="mt-1 text-caption text-text-secondary">
            {t('approvals.askedBy', { name: mine ? t('owners.you') : requester })} ·{' '}
            {formatRelativeAge(Date.parse(a.created_at), i18n.language)}
          </p>
        </div>
        {a.status === 'PENDING' &&
          (mine ? (
            <span className="text-body text-text-secondary">
              {t('approvals.waitingFor', { name: otherName ?? t('approvals.otherOwner') })}
            </span>
          ) : (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="lg"
                className="min-h-11"
                disabled={decide.isPending}
                onClick={() => void answer(a.id, 'deny')}
              >
                {t('approvals.deny')}
              </Button>
              <Button
                size="lg"
                className="min-h-11"
                disabled={decide.isPending}
                onClick={() => void answer(a.id, 'approve')}
              >
                {t('approvals.approve')}
              </Button>
            </div>
          ))}
      </Card>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <Card className="flex flex-col gap-2 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-h3">{t('approvals.switch.title')}</h2>
            <p className="text-body text-text-secondary">{t('approvals.switch.description')}</p>
          </div>
          {setting.isError ? (
            <span className="text-caption text-text-secondary">
              {t('approvals.switch.loadError')}
            </span>
          ) : (
            <Switch
              checked={enabled}
              disabled={setting.isLoading || setSetting.isPending}
              aria-label={t('approvals.switch.label')}
              onCheckedChange={() => setConfirmSwitch(true)}
            />
          )}
        </div>
        {switchWaiting && (
          <p role="status" className="text-body">
            {t('approvals.switch.waiting')}
          </p>
        )}
      </Card>
      {approvals.isError ? (
        <ErrorState message={t('approvals.loadError')} onRetry={() => void approvals.refetch()} />
      ) : approvals.isSuccess && list.length === 0 ? (
        <EmptyState
          kind="empty"
          title={t('approvals.empty')}
          explanation={t('approvals.emptyExplanation')}
        />
      ) : (
        list.map(renderRequest)
      )}
      {confirmSwitch && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setConfirmSwitch(false)}
          title={t(enabled ? 'approvals.switch.turnOffTitle' : 'approvals.switch.turnOnTitle')}
          description={t(
            enabled ? 'approvals.switch.turnOffDescription' : 'approvals.switch.turnOnDescription',
          )}
          confirmLabel={t(
            enabled ? 'approvals.switch.turnOffConfirm' : 'approvals.switch.turnOnConfirm',
          )}
          tone="default"
          busy={setSetting.isPending}
          onConfirm={() => void flip()}
        />
      )}
    </div>
  );
}

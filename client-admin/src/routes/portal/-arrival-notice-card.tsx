/**
 * [84.4.x #3166] Portal Attendance: one row per child to ask for an "arrival
 * notice" (a message when the child reaches school). The guardian asks; the
 * teacher confirms. Hidden when the school switch is off (the server still
 * answers, so `school.enabled` is the only gate).
 */
import { apiClient } from '@biddaloy/ui/api';
import { Card, RadioRows, StatusBadge, Switch, type StatusTone } from '@biddaloy/ui/components';
import {
  usePortalArrivalSubscriptions,
  usePutPortalArrivalSubscription,
  type MyArrivalChild,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

type Channel = 'PUSH' | 'SMS';

function badgeFor(sub: MyArrivalChild['subscription']): { tone: StatusTone; key: string } | null {
  if (sub === null) return null;
  // Either admin choice (D35) shows "Set by the admin": the guardian cannot change it.
  if (sub.lock !== 'NONE') return { tone: 'neutral', key: 'locked' };
  if (sub.status === 'REQUESTED') return { tone: 'warning', key: 'waiting' };
  if (sub.status === 'ACTIVE') {
    return sub.mode === 'RECURRING'
      ? { tone: 'success', key: 'everyDay' }
      : { tone: 'success', key: 'once' };
  }
  // OFF + consumed ONCE.
  return sub.consumed_at === null ? null : { tone: 'neutral', key: 'done' };
}

function ChildRow({
  child,
  smsAllowed,
  pushReady,
}: {
  child: MyArrivalChild;
  smsAllowed: boolean;
  pushReady: boolean;
}) {
  const { t } = useTranslation('portal');
  const put = usePutPortalArrivalSubscription();
  const sub = child.subscription;
  const on = sub !== null && (sub.status === 'REQUESTED' || sub.status === 'ACTIVE');
  // NEVER and ALWAYS both fix the switch (the server answers 409 to a change); under ALWAYS
  // the guardian still picks how it is sent (D5).
  const lock = sub?.lock ?? 'NONE';
  const locked = lock !== 'NONE';
  const channel: Channel = sub?.channel ?? 'PUSH';
  const badge = badgeFor(sub);
  const send = (want: boolean, next: Channel) =>
    put.mutate({ studentId: child.student_id, input: { want, channel: next } });

  return (
    <li className="flex flex-col gap-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">{child.student_name}</span>
        <div className="flex items-center gap-3">
          {badge && (
            <StatusBadge tone={badge.tone} label={t(`arrivalNotice.status.${badge.key}`)} />
          )}
          <label className="flex min-h-11 items-center gap-2 md:min-h-6">
            <Switch
              checked={on}
              disabled={locked || put.isPending}
              // A stale SMS choice from before the school switched SMS off would be refused.
              onCheckedChange={(want) => send(want, smsAllowed ? channel : 'PUSH')}
              aria-label={t('arrivalNotice.switchLabel', { name: child.student_name })}
            />
            <span>{t('arrivalNotice.want')}</span>
          </label>
        </div>
      </div>
      {locked && (
        <p className="text-caption text-text-secondary">
          {t(lock === 'ALWAYS' ? 'arrivalNotice.lockedAlwaysHint' : 'arrivalNotice.lockedHint')}
        </p>
      )}
      {on && lock !== 'NEVER' && (
        <>
          <RadioRows
            legend={t('arrivalNotice.channelLegend')}
            legendHidden
            value={channel}
            onValueChange={(next) => send(true, next as Channel)}
            options={[
              { value: 'PUSH', title: t('arrivalNotice.channel.push') },
              { value: 'SMS', title: t('arrivalNotice.channel.sms'), disabled: !smsAllowed },
            ]}
          />
          {!smsAllowed && (
            // Outside the greyed-out row: inside it the text fades below readable contrast.
            <p className="text-caption text-text-secondary">{t('arrivalNotice.smsNotAllowed')}</p>
          )}
          {channel === 'PUSH' && !pushReady && (
            <p className="text-caption text-text-secondary">
              {t('arrivalNotice.noPush')}{' '}
              <Link to="/portal/account" hash="push-devices" className="text-primary underline">
                {t('arrivalNotice.noPushLink')}
              </Link>
            </p>
          )}
        </>
      )}
      {put.isError && (
        // One fixed sentence: the server's text is never shown (Rule 23).
        <p role="alert" className="text-caption text-destructive">
          {t('arrivalNotice.saveError')}
        </p>
      )}
    </li>
  );
}

export function ArrivalNoticeCard() {
  const { t } = useTranslation('portal');
  const query = usePortalArrivalSubscriptions();
  // D10: any device on the account counts, not just this browser (and not just browsers that
  // can push). While the list loads there is no warning, so it never flashes.
  const devices = useQuery({
    queryKey: ['me', 'push', 'subscriptions'],
    queryFn: async () => (await apiClient.get<unknown[]>('/me/push/subscriptions')).data,
  });
  const pushReady = devices.isPending || (devices.data?.length ?? 0) > 0;
  const data = query.data;
  if (data === undefined || !data.school.enabled || data.children.length === 0) return null;

  return (
    <Card className="p-4 md:p-5">
      <h2 className="text-h3">{t('arrivalNotice.title')}</h2>
      <p className="mt-1 text-text-secondary">{t('arrivalNotice.explanation')}</p>
      <ul className="mt-2 divide-y divide-border-subtle">
        {data.children.map((child) => (
          <ChildRow
            key={child.student_id}
            child={child}
            smsAllowed={data.school.smsAllowed}
            pushReady={pushReady}
          />
        ))}
      </ul>
    </Card>
  );
}

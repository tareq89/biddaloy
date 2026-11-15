/**
 * [71.4.09] The merit list and the waiting lists of one round (the desk's `merit` / `waiting`
 * steps). A waiting list opens only after the list before it has passed its last date and a seat
 * is free; when it cannot, one line says why (#2204 D24-D25).
 */
import { ConfirmDialog, Button, StatusBadge, toast } from '@biddaloy/ui/components';
import {
  useActivateList,
  useAdmissionLists,
  useExpirePendingList,
  type AdmissionLists,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, formatNumber, toIsoDate } from '@biddaloy/ui/utils';
import { useParams, useSearch } from '@tanstack/react-router';
import * as React from 'react';

import { AdmitApplicantModal } from '../AdmitApplicantModal';
import { useApplicant } from '../hooks/useApplicants';

import { CallListDialog } from './CallListDialog';
import { ListBuildDialog } from './ListBuildDialog';

type List = AdmissionLists['lists'][number];

function AdmitFromList({ id, onClose }: { id: string; onClose: () => void }) {
  const applicant = useApplicant(id);
  if (!applicant.data) return null;
  return (
    <AdmitApplicantModal
      applicant={applicant.data.applicant}
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    />
  );
}

function ListCard({
  list,
  previous,
  seatsLeft,
  roundId,
}: {
  list: List;
  previous: List | undefined;
  seatsLeft: number;
  roundId: string;
}) {
  const { t } = useTranslation('admission-lists');
  const region = useRegionConfig();
  const activate = useActivateList();
  const expire = useExpirePendingList();
  const [confirm, setConfirm] = React.useState<'activate' | 'expire' | null>(null);
  const [calling, setCalling] = React.useState(false);
  const [admitting, setAdmitting] = React.useState<string | null>(null);
  const today = toIsoDate(new Date());
  const n = (v: number) => formatNumber(v, region);
  const date = (d: string) => formatDate(d, region);

  const isMerit = list.kind === 'MERIT';
  const opened = list.activated_at !== null;
  const prevDeadline = previous?.act_by_date ?? null;
  const prevPassed = !previous || !prevDeadline || prevDeadline < today;
  const activateReason = opened
    ? null
    : !prevPassed
      ? t('reasons.activateDeadline', { date: date(prevDeadline) })
      : seatsLeft <= 0
        ? t('reasons.activateSeats')
        : null;
  const deadlinePassed = !list.act_by_date || list.act_by_date < today;
  const expireReason =
    opened && !deadlinePassed
      ? t('reasons.expireDeadline', { date: date(list.act_by_date!) })
      : null;
  const canExpire = opened && list.counts.OFFERED > 0;

  async function run(kind: 'activate' | 'expire') {
    try {
      if (kind === 'activate') {
        await activate.mutateAsync({ id: list.id });
        toast.success(t('toast.activated'));
      } else {
        const res = await expire.mutateAsync({ id: list.id });
        toast.success(t('toast.expired', { count: n(res.affected) }));
      }
    } catch {
      toast.error(t('toast.error'));
    }
    setConfirm(null);
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border-functional bg-surface p-4">
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="text-lg font-semibold">
          {isMerit ? t('card.merit') : t('card.waiting', { n: n(list.sequence) })}
        </h3>
        {opened ? null : <StatusBadge tone="neutral" label={t('card.notOpened')} />}
      </header>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <li>{t('card.capacity', { count: n(list.capacity) })}</li>
        <li>
          {list.act_by_date
            ? t('card.deadline', { date: date(list.act_by_date) })
            : t('card.noDeadline')}
        </li>
        <li>{t('card.offered', { count: n(list.counts.OFFERED) })}</li>
        <li>{t('card.admitted', { count: n(list.counts.ADMITTED) })}</li>
        <li>{t('card.expired', { count: n(list.counts.EXPIRED) })}</li>
        <li>{t('card.seatsLeft', { count: n(seatsLeft) })}</li>
      </ul>
      <div className="flex flex-wrap gap-2">
        {!isMerit && !opened ? (
          <Button
            disabled={activateReason !== null || activate.isPending}
            onClick={() => setConfirm('activate')}
          >
            {activate.isPending ? t('actions.activating') : t('actions.activate')}
          </Button>
        ) : null}
        {canExpire ? (
          <Button
            variant="outline"
            disabled={expireReason !== null || expire.isPending}
            onClick={() => setConfirm('expire')}
          >
            {expire.isPending ? t('actions.expiring') : t('actions.expire')}
          </Button>
        ) : null}
        <Button variant="outline" onClick={() => setCalling(true)}>
          {t('actions.call')}
        </Button>
      </div>
      {activateReason ? (
        <p role="note" className="text-sm text-text-secondary">
          {activateReason}
        </p>
      ) : null}
      {canExpire && expireReason ? (
        <p role="note" className="text-sm text-text-secondary">
          {expireReason}
        </p>
      ) : null}

      <div>
        <h4 className="mb-1 text-label font-medium">{t('card.members')}</h4>
        {list.members.length === 0 ? (
          <p className="text-sm">{t('card.noMembers')}</p>
        ) : (
          <ol className="divide-y divide-border-subtle rounded-md border">
            {list.members.map((m) => (
              <li key={m.applicant_id} className="flex items-center gap-2 px-3 py-1.5">
                <span className="w-8 text-text-secondary tabular-nums">{n(m.position)}</span>
                <span className="flex-1 font-medium">{m.applicant_name}</span>
                {m.status === 'OFFERED' ? (
                  <Button size="sm" onClick={() => setAdmitting(m.applicant_id)}>
                    {t('actions.admit')}
                  </Button>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </div>

      {confirm ? (
        <ConfirmDialog
          open
          tone="default"
          onOpenChange={(o) => {
            if (!o) setConfirm(null);
          }}
          title={t(confirm === 'activate' ? 'confirm.activateTitle' : 'confirm.expireTitle')}
          description={t(confirm === 'activate' ? 'confirm.activateText' : 'confirm.expireText')}
          confirmLabel={t('confirm.yes')}
          busy={activate.isPending || expire.isPending}
          onConfirm={() => void run(confirm)}
        />
      ) : null}
      {calling ? (
        <CallListDialog roundId={roundId} listId={list.id} open onOpenChange={setCalling} />
      ) : null}
      {admitting ? <AdmitFromList id={admitting} onClose={() => setAdmitting(null)} /> : null}
    </section>
  );
}

export function ListsPanel() {
  const { t } = useTranslation('admission-lists');
  const region = useRegionConfig();
  const { roundId = '' } = useParams({ strict: false });
  const { step } = useSearch({ strict: false });
  const lists = useAdmissionLists(roundId);
  const [building, setBuilding] = React.useState<'MERIT' | 'WAITING' | null>(null);

  if (lists.isError) return <p role="alert">{t('panel.loadError')}</p>;
  if (!lists.data) return <p role="status">{t('panel.loading')}</p>;

  const { lists: all, seat_count, seats_left } = lists.data;
  const ordered = [...all].sort((a, b) => a.sequence - b.sequence);
  const showWaiting = step === 'waiting';
  const shown = ordered.filter((l) => (l.kind === 'WAITING') === showWaiting);
  const hasMerit = ordered.some((l) => l.kind === 'MERIT');

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">
          {t(showWaiting ? 'panel.waitingHeading' : 'panel.meritHeading')}
        </h2>
        <p className="text-sm text-text-secondary">
          {t('panel.seats', {
            seats: formatNumber(seat_count, region),
            left: formatNumber(seats_left, region),
          })}
        </p>
      </div>
      {shown.length === 0 ? <p>{t(showWaiting ? 'panel.noWaiting' : 'panel.noMerit')}</p> : null}
      {shown.map((l) => (
        <ListCard
          key={l.id}
          list={l}
          previous={ordered[ordered.indexOf(l) - 1]}
          seatsLeft={seats_left}
          roundId={roundId}
        />
      ))}
      <div>
        {showWaiting ? (
          <Button disabled={!hasMerit} onClick={() => setBuilding('WAITING')}>
            {t('panel.newWaiting')}
          </Button>
        ) : !hasMerit ? (
          <Button onClick={() => setBuilding('MERIT')}>{t('panel.buildMerit')}</Button>
        ) : null}
      </div>
      {building ? (
        <ListBuildDialog
          roundId={roundId}
          kind={building}
          seatsLeft={seats_left}
          open
          onOpenChange={(o) => {
            if (!o) setBuilding(null);
          }}
        />
      ) : null}
    </div>
  );
}

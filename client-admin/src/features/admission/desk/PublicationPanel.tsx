/**
 * [71.4.10] Publish a stage result or a list: see the SMS cost first, then send once (#2204 D6,
 * D26, D27). Whether a row is already published comes from the estimate's `already_published`.
 */
import {
  Button,
  Checkbox,
  ConfirmDialog,
  StatusBadge,
  Switch,
  toast,
} from '@biddaloy/ui/components';
import {
  useAdmissionLists,
  useAdmissionRound,
  useAdmissionStages,
  usePublish,
  usePublishEstimate,
  useUpdateAdmissionRound,
  type PublishWhat,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { useParams } from '@tanstack/react-router';
import * as React from 'react';

function PublishRow({
  roundId,
  what,
  refId,
  label,
  defaultSms,
  channels,
}: {
  roundId: string;
  what: PublishWhat;
  refId: string;
  label: string;
  defaultSms: boolean;
  channels: string[];
}) {
  const { t } = useTranslation('admission-lists');
  const region = useRegionConfig();
  const [sms, setSms] = React.useState(defaultSms);
  const [rejected, setRejected] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const estimate = usePublishEstimate(roundId, what, refId, rejected);
  const publish = usePublish(roundId);
  const n = (v: number) => formatNumber(v, region);
  const est = estimate.data;

  async function send() {
    if (publish.isPending) return;
    try {
      const res = await publish.mutateAsync({
        what,
        ref_id: refId,
        send_sms: sms,
        include_not_selected: rejected,
      });
      toast.success(t('publish.toast.done', { count: n(res.sms_attempted) }));
    } catch {
      toast.error(t('publish.toast.error'));
    }
    setOpen(false);
  }

  const low = sms && est?.metered && est.available !== null && est.segments > est.available;
  const cost = !sms
    ? t('publish.noSms')
    : est
      ? (low
          ? `${t('publish.lowCredit', { credits: n(est.segments), available: n(est.available ?? 0) })} `
          : '') + t('publish.estimate', { count: n(est.recipients), credits: n(est.segments) })
      : t('publish.estimateLoading');

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border-functional bg-surface p-4">
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="text-lg font-semibold">{label}</h3>
        <StatusBadge
          tone={est?.already_published ? 'success' : 'neutral'}
          label={est?.already_published ? t('publish.published') : t('publish.notPublished')}
        />
      </header>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <li>{t('publish.channelSite')}</li>
        {channels.includes('CALL_LIST') ? <li>{t('publish.channelPhone')}</li> : null}
      </ul>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={sms} onCheckedChange={(v) => setSms(v === true)} />
        {t('publish.channelSms')}
      </label>
      {sms && what === 'STAGE' ? (
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={rejected} onCheckedChange={(v) => setRejected(v === true)} />
          {t('publish.includeNotSelected')}
        </label>
      ) : null}
      <div>
        <Button disabled={publish.isPending || (sms && !est)} onClick={() => setOpen(true)}>
          {t('publish.action')}
        </Button>
      </div>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t('publish.confirmTitle', { name: label })}
        description={cost}
        confirmLabel={t('publish.action')}
        tone="default"
        busy={publish.isPending}
        hideConfirm={Boolean(low)}
        onConfirm={() => void send()}
      />
    </section>
  );
}

export function PublicationPanel() {
  const { t } = useTranslation('admission-lists');
  // Loads the desk namespace; keys from it are read with an explicit `{ ns }` (check:i18n resolves one namespace per file).
  useTranslation('admission-desk');
  const region = useRegionConfig();
  const { roundId = '' } = useParams({ strict: false });
  const round = useAdmissionRound(roundId);
  const stages = useAdmissionStages(roundId);
  const lists = useAdmissionLists(roundId);
  const update = useUpdateAdmissionRound(roundId);

  if (round.isError || lists.isError || stages.isError)
    return <p role="alert">{t('publish.loadError')}</p>;
  if (!round.data || !lists.data || !stages.data)
    return <p role="status">{t('publish.loading')}</p>;

  const channels: string[] = round.data.publish_channels ?? [];
  const defaultSms = channels.includes('SMS');
  const names = round.data.show_names_publicly ?? false;
  const ordered = [...lists.data.lists].sort((a, b) => a.sequence - b.sequence);

  async function setNames(v: boolean) {
    try {
      await update.mutateAsync({ show_names_publicly: v });
    } catch {
      toast.error(t('publish.toast.error'));
    }
  }

  const common = { roundId, defaultSms, channels };
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{t('panels.publication', { ns: 'admission-desk' })}</h2>
      <section className="flex flex-col gap-2 rounded-lg border border-border-functional bg-surface p-4">
        <label className="flex items-center gap-2 text-sm font-medium">
          <Switch
            checked={names}
            disabled={update.isPending}
            onCheckedChange={(v) => void setNames(v)}
          />
          {t('publish.names')}
        </label>
        {names ? (
          <p role="note" className="text-sm text-text-secondary">
            {t('publish.namesWarning')}
          </p>
        ) : null}
        <div>
          {/* ponytail: no public lists URL is derivable from the admin app yet, see report. */}
          <Button variant="outline" disabled title={t('publish.previewUnavailable')}>
            {t('publish.preview')}
          </Button>
        </div>
      </section>
      {stages.data.map((s) => (
        <PublishRow
          key={s.id}
          {...common}
          what="STAGE"
          refId={s.id}
          label={s.title || t(`desk.steps.kind.${s.kind}`, { ns: 'admission-desk' })}
        />
      ))}
      {ordered.map((l) => (
        <PublishRow
          key={l.id}
          {...common}
          what={l.kind}
          refId={l.id}
          label={
            l.kind === 'MERIT'
              ? t('card.merit')
              : t('card.waiting', { n: formatNumber(l.sequence, region) })
          }
        />
      ))}
    </div>
  );
}

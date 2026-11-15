/**
 * [71.4.08] A lottery stage: draw once in the app, or upload a list made outside. After either,
 * the ranks show and no draw or upload button is left (#2204 D15). Phone shows the result only.
 */
import { ApiError } from '@biddaloy/ui/api';
import { Button, ConfirmDialog, toast } from '@biddaloy/ui/components';
import {
  useAdmissionApplicants,
  useAdmissionStages,
  useDrawLottery,
  useStageResults,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber, renderDigits } from '@biddaloy/ui/utils';
import { useParams, useSearch } from '@tanstack/react-router';
import * as React from 'react';

import { useIsPhone } from '../../../pages/settings/use-is-phone';

import { LotteryImportDialog } from './LotteryImportDialog';

function LotteryBody({ roundId, stageId }: { roundId: string; stageId: string }) {
  const { t } = useTranslation('admission-stages');
  const region = useRegionConfig();
  const phone = useIsPhone();
  const results = useStageResults(stageId);
  const roster = useAdmissionApplicants({ intakeId: roundId, stage_id: stageId, limit: 1 });
  const draw = useDrawLottery(stageId);
  const [confirm, setConfirm] = React.useState(false);
  const [importing, setImporting] = React.useState(false);

  if (results.isError) return <p role="alert">{t('lottery.loadError')}</p>;
  if (!results.data) return <p role="status">{t('lottery.loading')}</p>;

  const rows = results.data;
  const n = rows.length;
  const drawn = n > 0;
  // The server stores points = N - rank + 1 (higher is better), so rank 1 has the top points.
  const ranked = rows
    .map((r) => ({ ...r, rank: n - Math.round(r.score ?? 0) + 1 }))
    .sort((a, b) => a.rank - b.rank);

  async function runDraw() {
    try {
      await draw.mutateAsync();
      setConfirm(false);
    } catch (e) {
      setConfirm(false);
      void results.refetch(); // a 409 means it is drawn already: show it, hide the draw button
      // A second draw from another tab: the lottery is there already, show it.
      toast.error(
        e instanceof ApiError && e.statusCode === 409
          ? t('lottery.already')
          : t('lottery.drawError'),
      );
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {drawn ? (
        <>
          <p role="status" className="text-lg font-semibold">
            {t('lottery.done')}
          </p>
          <p className="text-sm">{t('lottery.doneCount', { count: formatNumber(n, region) })}</p>
          <div className="overflow-x-auto rounded-lg border border-border-functional bg-surface">
            <table className="w-full border-collapse text-body">
              <thead>
                <tr className="bg-muted text-label text-text-secondary">
                  <th scope="col" className="h-10 px-4 text-start font-medium">
                    {t('lottery.rank')}
                  </th>
                  <th scope="col" className="h-10 px-4 text-start font-medium">
                    {t('lottery.roll')}
                  </th>
                  <th scope="col" className="h-10 px-4 text-start font-medium">
                    {t('lottery.name')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {ranked.map((r) => (
                  <tr key={r.applicant_id}>
                    <td className="px-4 py-1.5 tabular-nums">
                      {renderDigits(String(r.rank), region.numerals)}
                    </td>
                    <td className="px-4 py-1.5 tabular-nums">
                      {r.roll ? renderDigits(r.roll, region.numerals) : '—'}
                    </td>
                    <td className="px-4 py-1.5 font-medium">{r.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : phone ? (
        <p role="note">{t('lottery.desktopOnly')}</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          <section className="flex flex-col gap-2 rounded-md border p-4">
            <h3 className="font-semibold">{t('lottery.drawCard')}</h3>
            <p className="text-sm">{t('lottery.drawCardText')}</p>
            <div>
              <Button
                disabled={!roster.data || roster.data.total === 0}
                onClick={() => setConfirm(true)}
              >
                {t('lottery.drawButton')}
              </Button>
            </div>
          </section>
          <section className="flex flex-col gap-2 rounded-md border p-4">
            <h3 className="font-semibold">{t('lottery.importCard')}</h3>
            <p className="text-sm">{t('lottery.importCardText')}</p>
            <div>
              <Button variant="outline" onClick={() => setImporting(true)}>
                {t('lottery.importButton')}
              </Button>
            </div>
          </section>
        </div>
      )}

      {confirm ? (
        <ConfirmDialog
          open
          tone="default"
          onOpenChange={(o) => {
            if (!o && !draw.isPending) setConfirm(false);
          }}
          title={t('lottery.drawTitle')}
          description={t('lottery.drawConfirmText', {
            count: formatNumber(roster.data?.total ?? 0, region),
          })}
          confirmLabel={t('lottery.drawConfirm')}
          busy={draw.isPending}
          onConfirm={() => void runDraw()}
        />
      ) : null}
      {importing ? (
        <LotteryImportDialog stageId={stageId} open onOpenChange={(o) => setImporting(o)} />
      ) : null}
    </div>
  );
}

export function LotteryPanel() {
  const { t } = useTranslation('admission-stages');
  const { roundId = '' } = useParams({ strict: false });
  const { step } = useSearch({ strict: false });
  const stages = useAdmissionStages(roundId);
  const stage = stages.data?.find((s) => s.id === step);
  if (stages.isError) return <p role="alert">{t('lottery.loadError')}</p>;
  if (!stage) return <p role="status">{t('lottery.loading')}</p>;
  if (stage.kind !== 'LOTTERY') return <p>{t('lottery.none')}</p>;
  return <LotteryBody roundId={roundId} stageId={stage.id} />;
}

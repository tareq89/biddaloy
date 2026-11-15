/**
 * [71.4.07] One test stage on the desk: date / time / venue, roll numbers, the print menu,
 * marks entry and the cut-off. Which stage is the desk's `?step=` (#2204 D21-D23).
 */
import {
  Button,
  DatePicker,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  TimeInput,
  toast,
} from '@biddaloy/ui/components';
import {
  useAdmissionApplicants,
  useAdmissionStages,
  useAssignRolls,
  usePutStageResults,
  useSetStageSchedule,
  useStageResults,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { useParams, useSearch } from '@tanstack/react-router';
import * as React from 'react';

import { useIsPhone } from '../../../pages/settings/use-is-phone';

import { AdmissionPrintMenu } from './AdmissionPrintMenu';
import { CutoffPreview } from './CutoffPreview';
import { StageScoreGrid, type SavedResult } from './StageScoreGrid';

const PAGE = 100;

const pad = (n: number) => String(n).padStart(2, '0');
const toDate = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d) : undefined;
};
const fromDate = (d: Date | undefined) =>
  d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : '';

type Stage = NonNullable<ReturnType<typeof useAdmissionStages>['data']>[number];

function StageBody({ roundId, stage }: { roundId: string; stage: Stage }) {
  const { t } = useTranslation('admission-stages');
  const region = useRegionConfig();
  const wide = !useIsPhone();
  const [page, setPage] = React.useState(1);
  const [date, setDate] = React.useState(stage.date ?? '');
  const [time, setTime] = React.useState(stage.start_time ?? '');
  const [venue, setVenue] = React.useState(stage.venue ?? '');
  const [saves, setSaves] = React.useState(0);
  const [order, setOrder] = React.useState<'APPLIED_AT' | 'NAME'>('APPLIED_AT');

  const schedule = useSetStageSchedule(stage.id);
  const rolls = useAssignRolls(roundId);
  const put = usePutStageResults(stage.id);
  const roster = useAdmissionApplicants({
    intakeId: roundId,
    stage_id: stage.id,
    sort: 'roll',
    page,
    limit: PAGE,
  });
  const results = useStageResults(stage.id);
  const saved = React.useMemo(() => {
    const map = new Map<string, SavedResult>();
    for (const r of results.data ?? []) map.set(r.applicant_id, r);
    return map;
  }, [results.data]);
  const totalPages = Math.max(1, roster.data?.totalPages ?? 1);
  const passFail = stage.mode === 'PASS_FAIL';
  const scheduleReady = date !== '' && time !== '' && venue.trim() !== '';

  async function saveSchedule() {
    try {
      await schedule.mutateAsync({ date, start_time: time, venue: venue.trim() });
      toast.success(t('header.scheduleSaved'));
    } catch {
      toast.error(t('header.scheduleError'));
    }
  }
  async function makeRolls() {
    try {
      const res = await rolls.mutateAsync(order);
      toast.success(
        res.assigned > 0 ? t('header.rollsDone', { count: res.assigned }) : t('header.rollsNone'),
      );
    } catch {
      toast.error(t('header.rollsError'));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1 text-sm">
          {t('header.date')}
          <DatePicker
            aria-label={t('header.date')}
            config={region}
            clearable={false}
            value={toDate(date)}
            onValueChange={(d) => setDate(fromDate(d))}
          />
        </div>
        <div className="flex flex-col gap-1 text-sm">
          {t('header.time')}
          <TimeInput
            aria-label={t('header.time')}
            value={time || undefined}
            onValueChange={setTime}
          />
        </div>
        <label className="flex flex-col gap-1 text-sm">
          {t('header.venue')}
          <Input maxLength={200} value={venue} onChange={(e) => setVenue(e.target.value)} />
        </label>
        <Button
          variant="outline"
          disabled={!scheduleReady || schedule.isPending}
          onClick={() => void saveSchedule()}
        >
          {t('header.saveSchedule')}
        </Button>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1 text-sm">
          {t('header.rollOrder')}
          <Select value={order} onValueChange={(v) => setOrder(v as 'APPLIED_AT' | 'NAME')}>
            <SelectTrigger aria-label={t('header.rollOrder')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="APPLIED_AT">{t('header.orderAppliedAt')}</SelectItem>
              <SelectItem value="NAME">{t('header.orderName')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button disabled={rolls.isPending} onClick={() => void makeRolls()}>
          {t('header.makeRolls')}
        </Button>
        <AdmissionPrintMenu
          roundId={roundId}
          stage={{
            id: stage.id,
            title: stage.title,
            kind: stage.kind,
            date: stage.date,
            start_time: stage.start_time,
            venue: stage.venue,
          }}
        />
        {stage.cutoff_committed_at ? (
          <span role="status" className="text-sm font-medium">
            {t('header.cutoffDone')}
          </span>
        ) : null}
      </div>

      {!wide ? (
        <p role="note">{t('grid.desktopOnly')}</p>
      ) : roster.isError || results.isError ? (
        <p role="alert">{t('grid.loadError')}</p>
      ) : !roster.data || !results.data ? (
        <p role="status">{t('grid.loading')}</p>
      ) : roster.data.data.length === 0 ? (
        <p>{t('grid.empty')}</p>
      ) : (
        <>
          <StageScoreGrid
            // A new page or a fresh server copy starts clean edits.
            key={`${stage.id}:${page}`}
            applicants={roster.data.data.map((a) => ({
              id: a.id,
              roll: a.roll_number,
              name: a.applicant_name,
            }))}
            saved={saved}
            maxScore={stage.max_score}
            passFail={passFail}
            onSave={async (rows) => {
              await put.mutateAsync({ results: rows });
              setSaves((n) => n + 1); // new marks make an open cut-off preview stale
            }}
          />
          {totalPages > 1 ? (
            <div className="flex items-center justify-between">
              <Button
                size="sm"
                variant="ghost"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                {t('grid.previous')}
              </Button>
              <span className="text-sm">
                {t('grid.page', {
                  current: formatNumber(page, region),
                  total: formatNumber(totalPages, region),
                })}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
              >
                {t('grid.next')}
              </Button>
            </div>
          ) : null}
        </>
      )}

      {passFail ? null : <CutoffPreview key={saves} stageId={stage.id} />}
    </div>
  );
}

export function StagePanel() {
  const { t } = useTranslation('admission-stages');
  const { roundId = '' } = useParams({ strict: false });
  const { step } = useSearch({ strict: false });
  const stages = useAdmissionStages(roundId);
  const stage = stages.data?.find((s) => s.id === step);
  if (stages.isError) return <p role="alert">{t('grid.loadError')}</p>;
  if (!stage) return <p role="status">{t('grid.loading')}</p>;
  if (stage.kind === 'NONE') return null; // nothing to enter: the server takes no results
  return <StageBody roundId={roundId} stage={stage} />;
}

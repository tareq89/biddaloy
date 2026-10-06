/**
 * [13.5] The platform school-detail page's "Trial" card — end date, students
 * used against the limit, and the "Extend trial" button. Presentational only
 * (`$schoolId.tsx` owns the dialog state), same split as `stats-card.tsx`.
 * Rendered only for a school that has or had a trial (`trial_ends_at` set).
 */
import { Button, Card } from '@biddaloy/ui/components';
import type { SchoolSummary } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, formatNumber } from '@biddaloy/ui/utils';

const DAY_MS = 86_400_000;

/** Whole days left (rounded up); 0 or less means the trial has ended. */
export function trialDaysLeft(trialEndsAt: string, now: number = Date.now()): number {
  return Math.ceil((new Date(trialEndsAt).getTime() - now) / DAY_MS);
}

export interface TrialCardProps {
  school: Pick<SchoolSummary, 'trial_ends_at' | 'seat_limit'>;
  /** Active students; `undefined` while the stats are still loading. */
  studentsUsed?: number;
  onExtend: () => void;
}

export function TrialCard({ school, studentsUsed, onExtend }: TrialCardProps) {
  const { t } = useTranslation('platform');
  const config = useRegionConfig();

  if (!school.trial_ends_at) return null;

  const ended = trialDaysLeft(school.trial_ends_at) <= 0;
  const used = studentsUsed === undefined ? '–' : formatNumber(studentsUsed, config);
  const limit =
    school.seat_limit === null
      ? t('trial.card.unlimited')
      : formatNumber(school.seat_limit, config);

  return (
    <Card padded>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h2 className="text-h2">{t('trial.card.title')}</h2>
        <Button type="button" variant="outline" onClick={onExtend}>
          {t('trial.card.extendAction')}
        </Button>
      </div>
      <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-caption text-text-secondary">
            {ended ? t('trial.card.endedOn') : t('trial.card.endsOn')}
          </dt>
          <dd className="font-medium">{formatDate(school.trial_ends_at, config)}</dd>
        </div>
        <div>
          <dt className="text-caption text-text-secondary">{t('trial.card.students')}</dt>
          <dd className="font-medium tabular-nums">
            {used} / {limit}
          </dd>
        </div>
      </dl>
    </Card>
  );
}

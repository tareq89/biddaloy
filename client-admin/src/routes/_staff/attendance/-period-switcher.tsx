/**
 * [41.4.4] "Whole day" + one tab per period of the date's routine. Renders
 * nothing when the date has no periods (switch off, or no published
 * routine) — except the admin-only hint pointing at `/routines`.
 */
import { StatusBadge, Tabs, TabsList, TabsTrigger } from '@biddaloy/ui/components';
import { useSectionPeriods } from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatTime } from '@biddaloy/ui/utils';
import { Link } from '@tanstack/react-router';
import { Info } from 'lucide-react';
import * as React from 'react';

const WHOLE_DAY = 'day';

export interface PeriodSwitcherProps {
  sectionId: string;
  date: string;
  period: number | undefined;
  onChange: (period: number | undefined, opts?: { replace: boolean }) => void;
  /** Admin-only: the tenant switch is on, so an empty list means "no published routine". */
  showRoutineHint?: boolean;
}

export function PeriodSwitcher({
  sectionId,
  date,
  period,
  onChange,
  showRoutineHint = false,
}: PeriodSwitcherProps) {
  const { t } = useTranslation('attendance');
  const regionConfig = useTenantRegionConfig();
  const periodsQuery = useSectionPeriods(sectionId, date);
  const periods = periodsQuery.data;

  // A date change keeps the chosen period only if the new date's list has it.
  React.useEffect(() => {
    if (periods && period !== undefined && !periods.some((p) => p.period_no === period)) {
      onChange(undefined, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- react to the list/selection only, `onChange` is a fresh closure each render
  }, [periods, period]);

  if (!periods) return null;
  if (periods.length === 0) {
    if (!showRoutineHint) return null;
    return (
      <p className="flex flex-wrap items-start gap-2 rounded-lg border border-border-subtle bg-muted p-4 text-text-secondary">
        <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span>{t('period.noRoutineHint')}</span>
        <Link to="/routines" className="font-medium text-primary underline">
          {t('period.openRoutines')}
        </Link>
      </p>
    );
  }

  return (
    <Tabs
      value={period === undefined ? WHOLE_DAY : String(period)}
      onValueChange={(value) => onChange(value === WHOLE_DAY ? undefined : Number(value))}
    >
      <TabsList variant="line" aria-label={t('period.tabsLabel')}>
        <TabsTrigger value={WHOLE_DAY}>{t('period.wholeDay')}</TabsTrigger>
        {periods.map((p) => {
          const name = p.name ?? String(p.period_no);
          return (
            <TabsTrigger key={p.period_no} value={String(p.period_no)}>
              {p.subject_name ? t('period.tab', { name, subject: p.subject_name }) : name}
              <span className="text-caption font-normal text-text-secondary">
                {formatTime(p.starts_at, regionConfig)}
              </span>
              {p.state === 'FINALIZED' ? (
                <StatusBadge tone="success" label={t('mark.stateFinalized')} />
              ) : p.state === 'DRAFT' ? (
                <StatusBadge tone="warning" label={t('list.draft')} />
              ) : null}
            </TabsTrigger>
          );
        })}
      </TabsList>
    </Tabs>
  );
}

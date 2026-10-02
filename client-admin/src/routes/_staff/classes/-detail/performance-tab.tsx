/**
 * [28.4.5] Class detail's "Performance" tab — `GET /performance/classes/:id`
 * with a section filter that defaults to "All sections" (D20). Mounted behind
 * `MARK_VIEW` in `$classId.tsx`. Same layout as the student tab: summary
 * card, then swipeable CSS-bar widgets.
 */
import {
  BarWidget,
  Button,
  ErrorState,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  SummaryCard,
  SwipeRow,
} from '@biddaloy/ui/components';
import { useClassPerformance, useClassSections } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { renderDigits } from '@biddaloy/ui/utils';
import { Printer } from 'lucide-react';
import * as React from 'react';

import '../../-performance-print.css';

const ALL = 'all';

export interface PerformanceTabProps {
  classId: string;
  academicYearId: string;
}

export function PerformanceTab({ classId, academicYearId }: PerformanceTabProps) {
  const { t } = useTranslation('performance');
  const { t: tCommon } = useTranslation('common');
  const { numerals } = useRegionConfig();
  const [section, setSection] = React.useState(ALL);
  const sections = useClassSections(classId);
  const query = useClassPerformance(classId, {
    academicYearId,
    ...(section === ALL ? {} : { sectionId: section }),
  });

  const n = (value: string) => renderDigits(value, numerals);
  const pct = (v: number | null) => (v === null ? t('notAvailable') : n(`${Math.round(v)}%`));
  const num = (v: number | null) =>
    v === null ? t('notAvailable') : n(String(Math.round(v * 10) / 10));

  const sectionLabel =
    section === ALL
      ? t('allSections')
      : (sections.data?.find((x) => x.id === section)?.section_name ?? t('allSections'));

  let body: React.ReactNode;
  if (query.isPending) {
    body = (
      <div className="flex flex-col gap-3" aria-busy="true" aria-live="polite">
        <span className="sr-only">{t('loading')}</span>
        <Skeleton className="h-28 w-full rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    );
  } else if (query.isError) {
    body = (
      <ErrorState
        message={t('loadError')}
        retryLabel={tCommon('actions.retry')}
        onRetry={() => void query.refetch()}
      />
    );
  } else {
    const d = query.data;
    body = (
      <div id="performance-print-area" className="flex flex-col gap-3">
        <div className="flex justify-end print:hidden">
          <Button type="button" variant="outline" onClick={() => window.print()}>
            <Printer className="size-4" />
            {t('print')}
          </Button>
        </div>
        <h2 className="hidden text-base font-semibold print:block">{sectionLabel}</h2>
        <SummaryCard
          title={t('title')}
          headline={d.passRate === null ? null : { label: t('passRate'), value: pct(d.passRate) }}
          emptyLabel={t('notEnoughData')}
          figures={[
            { label: t('averageMarks'), value: num(d.averageMarks) },
            { label: t('attendance'), value: pct(d.attendancePercent) },
          ]}
        />
        <SwipeRow label={t('title')}>
          <BarWidget
            title={t('examResults')}
            emptyLabel={t('notEnoughData')}
            bars={d.exams.map((e) => ({
              label: e.examName,
              value: e.passRate,
              valueLabel: pct(e.passRate),
            }))}
          />
          <BarWidget
            title={t('attendanceTitle')}
            emptyLabel={t('notEnoughData')}
            bars={
              d.attendancePercent === null
                ? []
                : [
                    {
                      label: t('attendance'),
                      value: d.attendancePercent,
                      valueLabel: pct(d.attendancePercent),
                    },
                  ]
            }
          />
          <BarWidget
            title={t('homeworkTitle')}
            emptyLabel={t('notEnoughData')}
            bars={
              d.homework.totalAssignments > 0
                ? [
                    {
                      label: t('homeworkAllTime'),
                      value: d.homework.completionPercent,
                      valueLabel: pct(d.homework.completionPercent),
                    },
                  ]
                : []
            }
          />
        </SwipeRow>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Select value={section} onValueChange={setSection}>
        <SelectTrigger aria-label={t('sectionLabel')} className="w-full sm:w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t('allSections')}</SelectItem>
          {sections.data?.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.section_name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {body}
    </div>
  );
}

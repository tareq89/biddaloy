import { Skeleton } from '@biddaloy/ui/components';
import { useAcademicYearStats } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';

import { TabQueryState } from './tab-query-state';

export interface StatisticsTabProps {
  academicYearId: string;
}

export function StatisticsTab({ academicYearId }: StatisticsTabProps) {
  const { t } = useTranslation('academicYears');
  const regionConfig = useRegionConfig();
  const query = useAcademicYearStats(academicYearId);

  return (
    <TabQueryState
      query={query}
      forbiddenMessage={t('detail.forbidden')}
      errorMessage={t('detail.statistics.errorMessage')}
      // Three stat cards, not this route's default table shape. The height
      // is the real card's box: `p-4` (32px) + a `text-sm` label (20px
      // line-height, per tailwindcss/theme.css) + `gap-1` (4px) + the
      // `text-2xl` figure (32px line-height) + 2px of border = 90px.
      skeleton={<StatisticsSkeleton />}
    >
      {(stats) => (
        <div className="flex flex-wrap gap-4">
          <div className="flex min-w-[8rem] flex-col gap-1 rounded-md border p-4">
            <span className="text-sm text-muted-foreground">{t('detail.statistics.classes')}</span>
            <span className="text-2xl font-semibold">
              {formatNumber(stats.classes_count, regionConfig)}
            </span>
          </div>
          <div className="flex min-w-[8rem] flex-col gap-1 rounded-md border p-4">
            <span className="text-sm text-muted-foreground">{t('detail.statistics.students')}</span>
            <span className="text-2xl font-semibold">
              {formatNumber(stats.students_count, regionConfig)}
            </span>
          </div>
          <div className="flex min-w-[8rem] flex-col gap-1 rounded-md border p-4">
            <span className="text-sm text-muted-foreground">
              {t('detail.statistics.feeStructures')}
            </span>
            <span className="text-2xl font-semibold">
              {formatNumber(stats.fee_structures_count, regionConfig)}
            </span>
          </div>
        </div>
      )}
    </TabQueryState>
  );
}

function StatisticsSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-wrap gap-4">
      <Skeleton className="h-[5.625rem] w-32 rounded-md" />
      <Skeleton className="h-[5.625rem] w-32 rounded-md" />
      <Skeleton className="h-[5.625rem] w-32 rounded-md" />
    </div>
  );
}

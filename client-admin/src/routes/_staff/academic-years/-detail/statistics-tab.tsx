import { useAcademicYearStats } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

import { TabQueryState } from './tab-query-state';

export interface StatisticsTabProps {
  academicYearId: string;
}

export function StatisticsTab({ academicYearId }: StatisticsTabProps) {
  const { t } = useTranslation('academicYears');
  const query = useAcademicYearStats(academicYearId);

  return (
    <TabQueryState
      query={query}
      forbiddenMessage={t('detail.forbidden')}
      errorMessage={t('detail.statistics.errorMessage')}
    >
      {(stats) => (
        <div className="flex flex-wrap gap-4">
          <div className="flex min-w-[8rem] flex-col gap-1 rounded-md border p-4">
            <span className="text-sm text-muted-foreground">{t('detail.statistics.classes')}</span>
            <span className="text-2xl font-semibold">{stats.classes_count}</span>
          </div>
          <div className="flex min-w-[8rem] flex-col gap-1 rounded-md border p-4">
            <span className="text-sm text-muted-foreground">{t('detail.statistics.students')}</span>
            <span className="text-2xl font-semibold">{stats.students_count}</span>
          </div>
          <div className="flex min-w-[8rem] flex-col gap-1 rounded-md border p-4">
            <span className="text-sm text-muted-foreground">
              {t('detail.statistics.feeStructures')}
            </span>
            <span className="text-2xl font-semibold">{stats.fee_structures_count}</span>
          </div>
        </div>
      )}
    </TabQueryState>
  );
}

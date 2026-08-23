import { useStudent } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

import { TabQueryState } from './tab-query-state';

export interface OverviewTabProps {
  studentId: string;
}

/** Same query key as the page header's own `useStudent(studentId)` —
 * TanStack Query dedupes both into the one request that fires when the
 * page opens (Overview is the default active tab), not two. */
export function OverviewTab({ studentId }: OverviewTabProps) {
  const { t } = useTranslation('students');
  const query = useStudent(studentId);

  return (
    <TabQueryState
      query={query}
      forbiddenMessage={t('detail.forbidden')}
      errorMessage={t('detail.loadError')}
    >
      {(student) => (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          <div>
            <dt className="text-sm text-muted-foreground">{t('detail.overview.dateOfBirth')}</dt>
            <dd>{student.date_of_birth ?? t('list.emptyValue')}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">{t('detail.overview.gender')}</dt>
            <dd>{student.gender ?? t('list.emptyValue')}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">{t('detail.overview.address')}</dt>
            <dd>{student.home_address ?? t('list.emptyValue')}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">
              {t('detail.overview.preferredCommunication')}
            </dt>
            <dd>{student.preferred_communication}</dd>
          </div>
        </dl>
      )}
    </TabQueryState>
  );
}

import { Field, FieldGrid, SkeletonFieldList } from '@biddaloy/ui/components';
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
      // Four label/value pairs, not this route's default table shape —
      // Overview is the one students tab that renders a `<dl>`.
      skeleton={<SkeletonFieldList fields={4} />}
    >
      {(student) => (
        <FieldGrid>
          <Field label={t('detail.overview.dateOfBirth')}>
            {student.date_of_birth ?? t('list.emptyValue')}
          </Field>
          <Field label={t('detail.overview.gender')}>
            {student.gender ?? t('list.emptyValue')}
          </Field>
          <Field label={t('detail.overview.address')}>
            {student.home_address ?? t('list.emptyValue')}
          </Field>
          <Field label={t('detail.overview.preferredCommunication')}>
            {student.preferred_communication}
          </Field>
        </FieldGrid>
      )}
    </TabQueryState>
  );
}

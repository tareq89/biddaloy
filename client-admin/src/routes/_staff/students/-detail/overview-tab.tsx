import { Card, Field, FieldGrid, SkeletonFieldList } from '@biddaloy/ui/components';
import { useStudent } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate } from '@biddaloy/ui/utils';

import { GENDER_VALUES } from '../-student-form-schema';

import { TabQueryState } from './tab-query-state';

export interface OverviewTabProps {
  studentId: string;
}

/** Same query key as the page header's own `useStudent(studentId)` —
 * TanStack Query dedupes both into the one request that fires when the
 * page opens (Overview is the default active tab), not two. */
export function OverviewTab({ studentId }: OverviewTabProps) {
  const { t } = useTranslation('students');
  const config = useRegionConfig();
  const query = useStudent(studentId);

  // Known values get a translated label; old free text is shown as typed.
  const genderLabel = (value: string | null | undefined): string => {
    if (!value) return t('list.emptyValue');
    return (GENDER_VALUES as readonly string[]).includes(value)
      ? t(`form.fields.genderOptions.${value}`)
      : value;
  };

  return (
    <TabQueryState
      query={query}
      forbiddenMessage={t('detail.forbidden')}
      errorMessage={t('detail.loadError')}
      // Six label/value pairs, not this route's default table shape —
      // Overview is the one students tab that renders a `<dl>`.
      skeleton={<SkeletonFieldList fields={6} />}
    >
      {(student) => (
        <Card padded>
          <h2 className="text-h2">{t('detail.overview.title')}</h2>
          <FieldGrid className="mt-4 grid-cols-2">
            <Field label={t('detail.overview.fullNameBn')}>
              {student.full_name_bn ?? t('list.emptyValue')}
            </Field>
            <Field label={t('detail.overview.dateOfBirth')}>
              {student.date_of_birth
                ? formatDate(student.date_of_birth, config)
                : t('list.emptyValue')}
            </Field>
            <Field label={t('detail.overview.gender')}>{genderLabel(student.gender)}</Field>
            <Field label={t('detail.overview.bloodGroup')}>
              {student.blood_group ?? t('list.emptyValue')}
            </Field>
            <Field label={t('detail.overview.preferredCommunication')}>
              {student.preferred_communication
                ? t(`form.preferredCommunicationOptions.${student.preferred_communication}`)
                : t('list.emptyValue')}
            </Field>
            <Field label={t('detail.overview.address')} className="col-span-2 md:col-span-1">
              {student.home_address ?? t('list.emptyValue')}
            </Field>
          </FieldGrid>
        </Card>
      )}
    </TabQueryState>
  );
}

/**
 * [23.10] Education section — see `hr-record-family-section.tsx`'s
 * header comment; over `GET`/`PUT /staff/:userId/education` (23.3).
 */
import {
  ErrorState,
  RepeatableRowForm,
  SkeletonFieldList,
  type RepeatableRowField,
} from '@biddaloy/ui/components';
import { useReplaceStaffRows, useStaffRows, type EducationRow } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

export interface HrRecordEducationSectionProps {
  userId: string;
}

export function HrRecordEducationSection({ userId }: HrRecordEducationSectionProps) {
  const { t } = useTranslation('staff');
  const rowsQuery = useStaffRows<EducationRow>('education', userId);
  const replaceRows = useReplaceStaffRows<EducationRow>('education', userId);

  const fields: RepeatableRowField[] = [
    { key: 'degree', label: t('hrRecord.education.degreeLabel'), type: 'text', required: true },
    {
      key: 'institution',
      label: t('hrRecord.education.institutionLabel'),
      type: 'text',
      required: true,
    },
    { key: 'board_university', label: t('hrRecord.education.boardUniversityLabel'), type: 'text' },
    { key: 'result', label: t('hrRecord.education.resultLabel'), type: 'text' },
    { key: 'passing_year', label: t('hrRecord.education.passingYearLabel'), type: 'text' },
  ];

  if (rowsQuery.isPending) {
    return <SkeletonFieldList fields={2} />;
  }

  if (rowsQuery.isError) {
    return (
      <ErrorState
        message={t('hrRecord.loadError')}
        retryLabel={t('actions.retry', { ns: 'common' })}
        onRetry={() => void rowsQuery.refetch()}
      />
    );
  }

  return (
    <RepeatableRowForm
      fields={fields}
      rows={rowsQuery.data}
      onSave={(rows) => replaceRows.mutate(rows)}
      emptyExplanation={t('hrRecord.education.emptyExplanation')}
      addRowLabel={t('hrRecord.addRowAction')}
      saveLabel={t('hrRecord.saveAction')}
    />
  );
}

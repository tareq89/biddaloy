/**
 * [23.10] Work-experience section — see `hr-record-family-section.tsx`'s
 * header comment; over `GET`/`PUT /staff/:userId/experience` (23.3).
 */
import {
  RepeatableRowForm,
  SkeletonFieldList,
  type RepeatableRowField,
} from '@biddaloy/ui/components';
import { useReplaceStaffRows, useStaffRows, type ExperienceRow } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

export interface HrRecordExperienceSectionProps {
  userId: string;
}

export function HrRecordExperienceSection({ userId }: HrRecordExperienceSectionProps) {
  const { t } = useTranslation('staff');
  const rowsQuery = useStaffRows<ExperienceRow>('experience', userId);
  const replaceRows = useReplaceStaffRows<ExperienceRow>('experience', userId);

  const fields: RepeatableRowField[] = [
    {
      key: 'institution',
      label: t('hrRecord.experience.institutionLabel'),
      type: 'text',
      required: true,
    },
    {
      key: 'designation',
      label: t('hrRecord.experience.designationLabel'),
      type: 'text',
      required: true,
    },
    {
      key: 'from_date',
      label: t('hrRecord.experience.fromDateLabel'),
      type: 'text',
      required: true,
    },
    { key: 'to_date', label: t('hrRecord.experience.toDateLabel'), type: 'text' },
    { key: 'description', label: t('hrRecord.experience.descriptionLabel'), type: 'text' },
  ];

  if (rowsQuery.isPending) {
    return <SkeletonFieldList fields={2} />;
  }

  return (
    <RepeatableRowForm
      fields={fields}
      rows={rowsQuery.data ?? []}
      onSave={(rows) => replaceRows.mutate(rows as ExperienceRow[])}
      emptyExplanation={t('hrRecord.experience.emptyExplanation')}
      addRowLabel={t('hrRecord.addRowAction')}
      saveLabel={t('hrRecord.saveAction')}
    />
  );
}

/**
 * [23.10] Achievements section — see `hr-record-family-section.tsx`'s
 * header comment; over `GET`/`PUT /staff/:userId/achievement` (23.3).
 */
import {
  RepeatableRowForm,
  SkeletonFieldList,
  type RepeatableRowField,
} from '@biddaloy/ui/components';
import { useReplaceStaffRows, useStaffRows, type AchievementRow } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

export interface HrRecordAchievementSectionProps {
  userId: string;
}

export function HrRecordAchievementSection({ userId }: HrRecordAchievementSectionProps) {
  const { t } = useTranslation('staff');
  const rowsQuery = useStaffRows<AchievementRow>('achievement', userId);
  const replaceRows = useReplaceStaffRows<AchievementRow>('achievement', userId);

  const fields: RepeatableRowField[] = [
    { key: 'title', label: t('hrRecord.achievement.titleLabel'), type: 'text', required: true },
    { key: 'description', label: t('hrRecord.achievement.descriptionLabel'), type: 'text' },
    { key: 'date', label: t('hrRecord.achievement.dateLabel'), type: 'text' },
    { key: 'issued_by', label: t('hrRecord.achievement.issuedByLabel'), type: 'text' },
  ];

  if (rowsQuery.isPending) {
    return <SkeletonFieldList fields={2} />;
  }

  return (
    <RepeatableRowForm
      fields={fields}
      rows={rowsQuery.data ?? []}
      onSave={(rows) => replaceRows.mutate(rows)}
      emptyExplanation={t('hrRecord.achievement.emptyExplanation')}
      addRowLabel={t('hrRecord.addRowAction')}
      saveLabel={t('hrRecord.saveAction')}
    />
  );
}

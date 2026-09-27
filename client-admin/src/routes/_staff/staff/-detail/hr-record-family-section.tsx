/**
 * [23.10] Family-members section — a thin `RepeatableRowForm` (23.8)
 * config wrapper around `GET`/`PUT /staff/:userId/family` (23.3). No
 * bespoke row UI here (D3): only the field list differs from the other
 * 6 sections this ticket fills in.
 */
import {
  RepeatableRowForm,
  SkeletonFieldList,
  type RepeatableRowField,
} from '@biddaloy/ui/components';
import { useReplaceStaffRows, useStaffRows, type FamilyMemberRow } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

export interface HrRecordFamilySectionProps {
  userId: string;
}

export function HrRecordFamilySection({ userId }: HrRecordFamilySectionProps) {
  const { t } = useTranslation('staff');
  const rowsQuery = useStaffRows<FamilyMemberRow>('family', userId);
  const replaceRows = useReplaceStaffRows<FamilyMemberRow>('family', userId);

  const fields: RepeatableRowField[] = [
    { key: 'relation', label: t('hrRecord.family.relationLabel'), type: 'text', required: true },
    { key: 'name', label: t('hrRecord.family.nameLabel'), type: 'text', required: true },
    { key: 'occupation', label: t('hrRecord.family.occupationLabel'), type: 'text' },
    { key: 'contact', label: t('hrRecord.family.contactLabel'), type: 'text' },
  ];

  if (rowsQuery.isPending) {
    return <SkeletonFieldList fields={2} />;
  }

  return (
    <RepeatableRowForm
      fields={fields}
      rows={rowsQuery.data ?? []}
      onSave={(rows) => replaceRows.mutate(rows as FamilyMemberRow[])}
      emptyExplanation={t('hrRecord.family.emptyExplanation')}
      addRowLabel={t('hrRecord.addRowAction')}
      saveLabel={t('hrRecord.saveAction')}
    />
  );
}

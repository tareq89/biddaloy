/**
 * [23.10] Training section — see `hr-record-family-section.tsx`'s
 * header comment; over `GET`/`PUT /staff/:userId/training` (23.3).
 */
import {
  ErrorState,
  RepeatableRowForm,
  SkeletonFieldList,
  toast,
  type RepeatableRowField,
} from '@biddaloy/ui/components';
import { useReplaceStaffRows, useStaffRows, type TrainingRow } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

export interface HrRecordTrainingSectionProps {
  userId: string;
}

export function HrRecordTrainingSection({ userId }: HrRecordTrainingSectionProps) {
  const { t } = useTranslation('staff');
  const rowsQuery = useStaffRows<TrainingRow>('training', userId);
  const replaceRows = useReplaceStaffRows<TrainingRow>('training', userId);

  const fields: RepeatableRowField[] = [
    { key: 'title', label: t('hrRecord.training.titleLabel'), type: 'text', required: true },
    {
      key: 'institution',
      label: t('hrRecord.training.institutionLabel'),
      type: 'text',
      required: true,
    },
    { key: 'from_date', label: t('hrRecord.training.fromDateLabel'), type: 'text', required: true },
    { key: 'to_date', label: t('hrRecord.training.toDateLabel'), type: 'text' },
    { key: 'certificate_no', label: t('hrRecord.training.certificateNoLabel'), type: 'text' },
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
      onSave={(rows) =>
        replaceRows.mutate(rows, { onError: () => toast.error(t('hrRecord.saveError')) })
      }
      emptyExplanation={t('hrRecord.training.emptyExplanation')}
      addRowLabel={t('hrRecord.addRowAction')}
      saveLabel={t('hrRecord.saveAction')}
    />
  );
}

/**
 * [23.10] Languages section — see `hr-record-family-section.tsx`'s
 * header comment; over `GET`/`PUT /staff/:userId/language` (23.3).
 */
import {
  ErrorState,
  RepeatableRowForm,
  SkeletonFieldList,
  toast,
  type RepeatableRowField,
} from '@biddaloy/ui/components';
import { useReplaceStaffRows, useStaffRows, type LanguageRow } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

export interface HrRecordLanguageSectionProps {
  userId: string;
}

export function HrRecordLanguageSection({ userId }: HrRecordLanguageSectionProps) {
  const { t } = useTranslation('staff');
  const rowsQuery = useStaffRows<LanguageRow>('language', userId);
  const replaceRows = useReplaceStaffRows<LanguageRow>('language', userId);

  const fields: RepeatableRowField[] = [
    {
      key: 'language_name',
      label: t('hrRecord.language.languageNameLabel'),
      type: 'text',
      required: true,
    },
    { key: 'proficiency', label: t('hrRecord.language.proficiencyLabel'), type: 'text' },
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
      emptyExplanation={t('hrRecord.language.emptyExplanation')}
      addRowLabel={t('hrRecord.addRowAction')}
      saveLabel={t('hrRecord.saveAction')}
    />
  );
}

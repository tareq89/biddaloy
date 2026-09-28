/**
 * [23.10] Addresses section — see `hr-record-family-section.tsx`'s
 * header comment for why this is a thin `RepeatableRowForm` config
 * wrapper, this time over `GET`/`PUT /staff/:userId/address` (23.3).
 */
import {
  ErrorState,
  RepeatableRowForm,
  SkeletonFieldList,
  toast,
  type RepeatableRowField,
} from '@biddaloy/ui/components';
import { useReplaceStaffRows, useStaffRows, type AddressRow } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

export interface HrRecordAddressSectionProps {
  userId: string;
}

export function HrRecordAddressSection({ userId }: HrRecordAddressSectionProps) {
  const { t } = useTranslation('staff');
  const rowsQuery = useStaffRows<AddressRow>('address', userId);
  const replaceRows = useReplaceStaffRows<AddressRow>('address', userId);

  const fields: RepeatableRowField[] = [
    {
      key: 'type',
      label: t('hrRecord.address.typeLabel'),
      type: 'select',
      required: true,
      options: [
        { value: 'PRESENT', label: t('hrRecord.address.typePresent') },
        { value: 'PERMANENT', label: t('hrRecord.address.typePermanent') },
      ],
    },
    { key: 'village_street', label: t('hrRecord.address.villageStreetLabel'), type: 'text' },
    { key: 'post_office', label: t('hrRecord.address.postOfficeLabel'), type: 'text' },
    { key: 'upazila', label: t('hrRecord.address.upazilaLabel'), type: 'text' },
    { key: 'district', label: t('hrRecord.address.districtLabel'), type: 'text' },
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
      emptyExplanation={t('hrRecord.address.emptyExplanation')}
      addRowLabel={t('hrRecord.addRowAction')}
      saveLabel={t('hrRecord.saveAction')}
    />
  );
}

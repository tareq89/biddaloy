import { DataTable, type DataTableColumn } from '@biddaloy/ui/components';
import { useFeeStructures } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatServerAmount } from '@biddaloy/ui/utils';
import { LayersIcon } from 'lucide-react';
import * as React from 'react';

import { TabQueryState } from './tab-query-state';

export interface FeeStructuresTabProps {
  academicYearId: string;
}

const PAGE_SIZE = 25;

/** A year with more than a page's worth of fee structures must page
 * through the rest, not silently truncate at a fixed `limit` — see
 * `classes-tab.tsx`'s identical reasoning for the sibling tab. */
export function FeeStructuresTab({ academicYearId }: FeeStructuresTabProps) {
  const { t } = useTranslation('academicYears');
  // [8.14.15] Separate binding (not `t(..., { ns: 'feeStructures' })`
  // alone) so `feeStructures` is actually loaded before the fee-type
  // cell renders. Kept as its own call, not `useTranslation(['academicYears',
  // 'feeStructures'])` — `check-i18n-keys.mjs` resolves this file's
  // namespace from the *first* single-quoted `useTranslation('...')` call
  // it finds, and an array argument doesn't match that regex.
  useTranslation('feeStructures');
  const regionConfig = useRegionConfig();
  const [page, setPage] = React.useState(1);
  const query = useFeeStructures({ academic_year_id: academicYearId, page, limit: PAGE_SIZE });

  const columns: DataTableColumn<NonNullable<typeof query.data>['data'][number]>[] = [
    {
      id: 'name',
      header: t('detail.feeStructures.columnName'),
      card: 'title',
      accessorFn: (structure) => <span className="font-medium">{structure.name}</span>,
    },
    {
      id: 'fee_type',
      header: t('detail.feeStructures.columnType'),
      card: 'field',
      accessorFn: (structure) => t(`feeTypes.${structure.fee_type}`, { ns: 'feeStructures' }),
    },
    {
      id: 'class',
      header: t('detail.feeStructures.columnClass'),
      card: 'field',
      accessorFn: (structure) =>
        structure.class === null ? t('detail.feeStructures.wholeSchool') : structure.class.name,
    },
    {
      id: 'amount',
      header: t('detail.feeStructures.columnAmount'),
      align: 'end',
      card: 'field',
      accessorFn: (structure) => formatServerAmount(structure.amount, regionConfig),
    },
  ];

  return (
    <TabQueryState
      query={query}
      forbiddenMessage={t('detail.forbidden')}
      errorMessage={t('detail.feeStructures.errorMessage')}
    >
      {(feeStructures) => (
        <DataTable
          tableId="academic-year-fee-structures"
          caption={t('detail.tabFeeStructures')}
          columns={columns}
          data={feeStructures.data}
          getRowId={(structure) => structure.id}
          sorting={null}
          onSortingChange={() => {}}
          page={page}
          pageSize={PAGE_SIZE}
          totalCount={feeStructures.total}
          onPageChange={setPage}
          emptyState={{
            icon: <LayersIcon />,
            title: t('detail.feeStructures.emptyMessage'),
            explanation: t('detail.feeStructures.emptyExplanation'),
          }}
        />
      )}
    </TabQueryState>
  );
}

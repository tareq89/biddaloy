import { DataTable, type DataTableColumn } from '@biddaloy/ui/components';
import { useFeeStructures, type FeeStructure } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatServerAmount } from '@biddaloy/ui/utils';
import * as React from 'react';

import { TabQueryState } from './tab-query-state';

export interface FeeStructuresTabProps {
  classId: string;
}

const PAGE_SIZE = 20;

/** Reuses `useFeeStructures({ class_id })` — same `academic-years/
 * -detail/fee-structures-tab.tsx` reasoning, scoped by class instead of
 * academic year here.
 *
 * Renders through `DataTable` rather than the raw `Table` primitive so
 * this list gets the same card-mode fallback at narrow container widths
 * as every other list — see `StudentsTab`'s identical comment on why. */
export function FeeStructuresTab({ classId }: FeeStructuresTabProps) {
  const { t } = useTranslation('classes');
  // [8.14.15] Separate binding (not `t(..., { ns: 'feeStructures' })`
  // alone) so `feeStructures` is actually loaded before the fee-type
  // cell renders — a bare `{ ns }` override on `t()` doesn't trigger
  // Suspense the way a `useTranslation()` binding does. Kept as its own
  // call (not `useTranslation(['classes', 'feeStructures'])`) because
  // `check-i18n-keys.mjs` resolves a file's namespace from the *first*
  // single-quoted `useTranslation('...')` call it finds — an array
  // argument doesn't match that regex, which would silently mis-tag
  // every other `t()` call in this file as `common`.
  useTranslation('feeStructures');
  const regionConfig = useRegionConfig();
  const [page, setPage] = React.useState(1);
  const query = useFeeStructures({ class_id: classId, page, limit: PAGE_SIZE });

  const columns: DataTableColumn<FeeStructure>[] = [
    {
      id: 'name',
      header: t('detail.feeStructures.columnName'),
      accessorFn: (structure) => structure.name,
    },
    {
      id: 'type',
      header: t('detail.feeStructures.columnType'),
      accessorFn: (structure) => t(`feeTypes.${structure.fee_type}`, { ns: 'feeStructures' }),
    },
    {
      id: 'amount',
      header: t('detail.feeStructures.columnAmount'),
      accessorFn: (structure) => formatServerAmount(structure.amount, regionConfig),
      align: 'end',
    },
    {
      id: 'recurring',
      header: t('detail.feeStructures.columnRecurring'),
      accessorFn: (structure) =>
        structure.is_recurring ? t('detail.feeStructures.yes') : t('detail.feeStructures.no'),
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
          tableId="class-detail-fee-structures"
          caption={t('detail.feeStructures.columnName')}
          columns={columns}
          data={feeStructures.data}
          getRowId={(structure) => structure.id}
          sorting={null}
          onSortingChange={() => {}}
          page={page}
          pageSize={PAGE_SIZE}
          totalCount={feeStructures.total}
          onPageChange={setPage}
          emptyMessage={t('detail.feeStructures.emptyMessage')}
        />
      )}
    </TabQueryState>
  );
}

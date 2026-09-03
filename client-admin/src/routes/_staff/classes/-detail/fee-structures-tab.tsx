import {
  Pagination,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@biddaloy/ui/components';
import { useFeeStructures } from '@biddaloy/ui/hooks';
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
 * academic year here. */
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

  return (
    <TabQueryState
      query={query}
      forbiddenMessage={t('detail.forbidden')}
      errorMessage={t('detail.feeStructures.errorMessage')}
    >
      {(feeStructures) =>
        feeStructures.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('detail.feeStructures.emptyMessage')}</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('detail.feeStructures.columnName')}</TableHead>
                  <TableHead>{t('detail.feeStructures.columnType')}</TableHead>
                  <TableHead>{t('detail.feeStructures.columnAmount')}</TableHead>
                  <TableHead>{t('detail.feeStructures.columnRecurring')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {feeStructures.data.map((structure) => (
                  <TableRow key={structure.id}>
                    <TableCell>{structure.name}</TableCell>
                    <TableCell>
                      {t(`feeTypes.${structure.fee_type}`, { ns: 'feeStructures' })}
                    </TableCell>
                    <TableCell>{formatServerAmount(structure.amount, regionConfig)}</TableCell>
                    <TableCell>
                      {structure.is_recurring
                        ? t('detail.feeStructures.yes')
                        : t('detail.feeStructures.no')}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              totalCount={feeStructures.total}
              onPageChange={setPage}
            />
          </>
        )
      }
    </TabQueryState>
  );
}

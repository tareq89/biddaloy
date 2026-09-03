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
  academicYearId: string;
}

const PAGE_SIZE = 20;

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
                  <TableHead>{t('detail.feeStructures.columnClass')}</TableHead>
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
                    <TableCell>{structure.class.name}</TableCell>
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

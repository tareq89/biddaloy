import {
  Pagination,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  humanizeStatus,
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
                    <TableCell>{humanizeStatus(structure.fee_type)}</TableCell>
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

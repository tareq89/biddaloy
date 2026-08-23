import {
  Pagination,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@biddaloy/ui/components';
import { useClasses } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

import { TabQueryState } from './tab-query-state';

export interface ClassesTabProps {
  academicYearId: string;
}

const PAGE_SIZE = 20;

/** A year with more than a page's worth of classes must page through the
 * rest, not silently truncate at `classes.ts`'s `CLASS_FILTER_LIMIT` — that
 * limit is a ceiling for the unpaginated "All classes" dropdown use case,
 * not this tab. */
export function ClassesTab({ academicYearId }: ClassesTabProps) {
  const { t } = useTranslation('academicYears');
  const [page, setPage] = React.useState(1);
  const query = useClasses({ academic_year_id: academicYearId, page, limit: PAGE_SIZE });

  return (
    <TabQueryState
      query={query}
      forbiddenMessage={t('detail.forbidden')}
      errorMessage={t('detail.classes.errorMessage')}
    >
      {(classes) =>
        classes.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('detail.classes.emptyMessage')}</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('detail.classes.columnName')}</TableHead>
                  <TableHead>{t('detail.classes.columnGrade')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {classes.data.map((klass) => (
                  <TableRow key={klass.id}>
                    <TableCell>{klass.name}</TableCell>
                    <TableCell>{klass.numeric_grade ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              totalCount={classes.total}
              onPageChange={setPage}
            />
          </>
        )
      }
    </TabQueryState>
  );
}

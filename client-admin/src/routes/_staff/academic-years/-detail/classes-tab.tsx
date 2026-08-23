import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@biddaloy/ui/components';
import { useClasses } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

import { TabQueryState } from './tab-query-state';

export interface ClassesTabProps {
  academicYearId: string;
}

/** Reuses `classes.ts`'s `useClasses` — its `academic_year_id` filter and
 * `CLASS_FILTER_LIMIT` (100) already fit this tab: a class list scoped to
 * one year is exactly the "small enough for one page" case that hook was
 * built for. */
export function ClassesTab({ academicYearId }: ClassesTabProps) {
  const { t } = useTranslation('academicYears');
  const query = useClasses({ academic_year_id: academicYearId });

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
        )
      }
    </TabQueryState>
  );
}

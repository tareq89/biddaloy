import { DataTable, type DataTableColumn } from '@biddaloy/ui/components';
import { useClasses } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { Link } from '@tanstack/react-router';
import { SchoolIcon } from 'lucide-react';
import * as React from 'react';

import { TabQueryState } from './tab-query-state';

export interface ClassesTabProps {
  academicYearId: string;
}

const PAGE_SIZE = 25;

/** A year with more than a page's worth of classes must page through the
 * rest, not silently truncate at `classes.ts`'s `CLASS_FILTER_LIMIT` — that
 * limit is a ceiling for the unpaginated "All classes" dropdown use case,
 * not this tab. */
export function ClassesTab({ academicYearId }: ClassesTabProps) {
  const { t } = useTranslation('academicYears');
  const regionConfig = useRegionConfig();
  const [page, setPage] = React.useState(1);
  const query = useClasses({ academic_year_id: academicYearId, page, limit: PAGE_SIZE });

  const columns: DataTableColumn<NonNullable<typeof query.data>['data'][number]>[] = [
    {
      id: 'name',
      header: t('detail.classes.columnName'),
      card: 'title',
      accessorFn: (klass) => (
        <Link
          to="/classes/$classId"
          params={{ classId: klass.id }}
          className="font-medium text-text-primary hover:text-primary"
        >
          {klass.name}
        </Link>
      ),
    },
    {
      id: 'numeric_grade',
      header: t('detail.classes.columnGrade'),
      align: 'end',
      card: 'field',
      accessorFn: (klass) =>
        klass.numeric_grade == null ? '—' : formatNumber(klass.numeric_grade, regionConfig),
    },
  ];

  return (
    <TabQueryState
      query={query}
      forbiddenMessage={t('detail.forbidden')}
      errorMessage={t('detail.classes.errorMessage')}
    >
      {(classes) => (
        <DataTable
          tableId="academic-year-classes"
          caption={t('detail.tabClasses')}
          columns={columns}
          rowActions={(klass) => [
            { intent: 'view', label: t('detail.classes.view'), to: `/classes/${klass.id}` },
          ]}
          data={classes.data}
          getRowId={(klass) => klass.id}
          sorting={null}
          onSortingChange={() => {}}
          page={page}
          pageSize={PAGE_SIZE}
          totalCount={classes.total}
          onPageChange={setPage}
          emptyState={{
            icon: <SchoolIcon />,
            title: t('detail.classes.emptyMessage'),
            explanation: t('detail.classes.emptyExplanation'),
          }}
        />
      )}
    </TabQueryState>
  );
}

import { Button, DataTable, type DataTableColumn } from '@biddaloy/ui/components';
import { type BulkUploadError } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { downloadCsv, renderDigits } from '@biddaloy/ui/utils';
import * as React from 'react';

const PAGE_SIZE = 10;

/**
 * The per-row error report of a partial-success import — row number,
 * field, offending value, plain-language problem — with a CSV export so
 * the source file can be fixed offline. Data is fully client-side (it
 * arrived in the upload response), so pagination just slices locally.
 */
export function ImportErrorTable({ errors }: { errors: BulkUploadError[] }) {
  const { t } = useTranslation('studentImport');
  const regionConfig = useRegionConfig();
  const [page, setPage] = React.useState(1);

  const columns: DataTableColumn<BulkUploadError>[] = [
    {
      id: 'row',
      header: t('errors.columnRow'),
      accessorFn: (error) => renderDigits(String(error.row), regionConfig.numerals),
    },
    {
      id: 'field',
      header: t('errors.columnField'),
      accessorFn: (error) => error.field ?? t('errors.wholeRow'),
    },
    {
      id: 'value',
      header: t('errors.columnValue'),
      accessorFn: (error) => error.value ?? t('errors.emptyValue'),
    },
    {
      id: 'reason',
      header: t('errors.columnReason'),
      accessorFn: (error) => error.reason,
    },
  ];

  function exportErrorsToCsv() {
    downloadCsv('import-errors.csv', [
      [
        t('errors.columnRow'),
        t('errors.columnField'),
        t('errors.columnValue'),
        t('errors.columnReason'),
      ],
      ...errors.map((error) => [error.row, error.field ?? '', error.value ?? '', error.reason]),
    ]);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{t('errors.title')}</h2>
        <Button type="button" variant="outline" size="sm" onClick={exportErrorsToCsv}>
          {t('errors.exportCsv')}
        </Button>
      </div>
      <DataTable
        tableId="student-import-errors"
        caption={t('errors.caption')}
        columns={columns}
        data={errors.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)}
        getRowId={(error) => `${error.row}-${error.field ?? 'row'}`}
        sorting={null}
        onSortingChange={() => {}}
        page={page}
        pageSize={PAGE_SIZE}
        totalCount={errors.length}
        onPageChange={setPage}
      />
    </div>
  );
}

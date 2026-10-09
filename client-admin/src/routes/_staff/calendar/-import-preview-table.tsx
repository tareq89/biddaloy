/**
 * [17.5.3] / [31.4] Step 2 of the import wizard: summary badges, a kit table
 * (error rows first; row number, status badge, a translated problem — never
 * the server's English `message`) and the import-options card. The commit
 * stays disabled (in the page footer) until there are zero `ERROR` rows or
 * "import the valid rows anyway" is on.
 */
import { Card, Checkbox, DataTable, StatusBadge, type StatusTone } from '@biddaloy/ui/components';
import type { CalendarImportRow, CalendarImportSummary } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';

const STATUS_TONE: Record<CalendarImportRow['status'], StatusTone> = {
  NEW: 'success',
  UPDATED: 'info',
  UNCHANGED: 'neutral',
  ERROR: 'danger',
};

export interface ImportPreviewTableProps {
  summary: CalendarImportSummary;
  rows: CalendarImportRow[];
  allowPartial: boolean;
  onAllowPartialChange: (value: boolean) => void;
  publishImmediately: boolean;
  onPublishImmediatelyChange: (value: boolean) => void;
}

function OptionRow({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3 py-1">
      <div className="flex min-h-11 items-center md:min-h-8">
        <Checkbox
          id={id}
          checked={checked}
          aria-describedby={`${id}-hint`}
          onCheckedChange={(value) => onChange(value === true)}
        />
      </div>
      <div className="flex min-h-11 flex-col justify-center md:min-h-8">
        <label htmlFor={id}>{label}</label>
        <p id={`${id}-hint`} className="text-caption text-text-secondary">
          {hint}
        </p>
      </div>
    </div>
  );
}

export function ImportPreviewTable({
  summary,
  rows,
  allowPartial,
  onAllowPartialChange,
  publishImmediately,
  onPublishImmediatelyChange,
}: ImportPreviewTableProps) {
  const { t } = useTranslation('calendarImport');
  const regionConfig = useRegionConfig();
  const hasErrors = summary.error > 0;

  // The rows that need action come first; file order within each group.
  const sorted = [...rows].sort(
    (a, b) => Number(b.status === 'ERROR') - Number(a.status === 'ERROR') || a.row - b.row,
  );

  const wholeRow = t('step2.wholeRow');
  const problemText = (column: string | null) =>
    t('step2.problem', {
      column: column ? t(`columns.${column}`, { defaultValue: wholeRow }) : wholeRow,
    });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {summary.new > 0 && (
          <StatusBadge tone="success" label={t('step2.summaryNew', { count: summary.new })} />
        )}
        {summary.updated > 0 && (
          <StatusBadge tone="info" label={t('step2.summaryUpdated', { count: summary.updated })} />
        )}
        {summary.unchanged > 0 && (
          <StatusBadge
            tone="neutral"
            label={t('step2.summaryUnchanged', { count: summary.unchanged })}
          />
        )}
        {summary.error > 0 && (
          <StatusBadge tone="danger" label={t('step2.summaryError', { count: summary.error })} />
        )}
      </div>

      <DataTable<CalendarImportRow>
        tableId="calendar-import-preview"
        caption={t('step2.caption')}
        data={sorted}
        getRowId={(row) => String(row.row)}
        totalCount={sorted.length}
        paginated={false}
        sorting={null}
        onSortingChange={() => {}}
        columns={[
          {
            id: 'row',
            header: t('step2.columnRow'),
            accessorFn: (row) => (
              <span className="font-medium">
                {t('step2.rowLabel', { row: formatNumber(row.row, regionConfig) })}
              </span>
            ),
          },
          {
            id: 'status',
            header: t('step2.columnStatus'),
            accessorFn: (row) => (
              <StatusBadge tone={STATUS_TONE[row.status]} label={t(`step2.status.${row.status}`)} />
            ),
          },
          {
            id: 'problem',
            header: t('step2.columnError'),
            accessorFn: (row) =>
              row.errors.length === 0
                ? '—'
                : row.errors.map((error) => problemText(error.column)).join(' '),
          },
        ]}
      />

      <Card className="p-4 md:p-5">
        <h2 className="text-h3">{t('step2.rulesTitle')}</h2>
        <div className="mt-2">
          {hasErrors && (
            <OptionRow
              id="import-allow-partial"
              label={t('step2.allowPartial')}
              hint={t('step2.allowPartialHint')}
              checked={allowPartial}
              onChange={onAllowPartialChange}
            />
          )}
          <OptionRow
            id="import-publish-immediately"
            label={t('step3.publishImmediately')}
            hint={t('step3.publishImmediatelyHint')}
            checked={publishImmediately}
            onChange={onPublishImmediatelyChange}
          />
        </div>
      </Card>
    </div>
  );
}

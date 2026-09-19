/**
 * [17.5.3] Step 2 of the import wizard: a status pill per row
 * (`NEW`/`UPDATED`/`UNCHANGED`/`ERROR`), the error text for `ERROR` rows,
 * summary counts, and the "Allow partial" toggle that's only relevant
 * when at least one `ERROR` row exists — the commit step stays disabled
 * until either there are zero `ERROR` rows or the toggle is on.
 *
 * The four-tone pill reuses the same status-token classes
 * `@biddaloy/ui/components`'s `StatusBadge` draws on (never colour
 * alone — text carries the meaning too) rather than adding a new
 * `StatusBadge` domain for a one-screen, non-domain status.
 */
import { Checkbox, Label, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@biddaloy/ui/components';
import type { CalendarImportRow, CalendarImportSummary } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

const PILL_STYLES: Record<CalendarImportRow['status'], string> = {
  NEW: 'bg-status-paid-bg text-status-paid-fg',
  UPDATED: 'bg-status-partial-bg text-status-partial-fg',
  UNCHANGED: 'bg-muted text-muted-foreground',
  ERROR: 'bg-status-overdue-bg text-status-overdue-fg',
};

export interface ImportPreviewTableProps {
  summary: CalendarImportSummary;
  rows: CalendarImportRow[];
  allowPartial: boolean;
  onAllowPartialChange: (value: boolean) => void;
}

export function ImportPreviewTable({
  summary,
  rows,
  allowPartial,
  onAllowPartialChange,
}: ImportPreviewTableProps) {
  const { t } = useTranslation('calendarImport');
  const hasErrors = summary.error > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4 text-sm">
        <span>{t('step2.summaryNew', { count: summary.new })}</span>
        <span>{t('step2.summaryUpdated', { count: summary.updated })}</span>
        <span>{t('step2.summaryUnchanged', { count: summary.unchanged })}</span>
        <span>{t('step2.summaryError', { count: summary.error })}</span>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('step2.columnRow')}</TableHead>
            <TableHead>{t('step2.columnStatus')}</TableHead>
            <TableHead>{t('step2.columnError')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.row}>
              <TableCell>{row.row}</TableCell>
              <TableCell>
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${PILL_STYLES[row.status]}`}
                >
                  {t(`step2.status.${row.status}`)}
                </span>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {row.errors.map((error) => error.message).join('; ')}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {hasErrors && (
        <div className="flex items-center gap-2">
          <Checkbox
            id="import-allow-partial"
            checked={allowPartial}
            onCheckedChange={(checked) => onAllowPartialChange(checked === true)}
          />
          <Label htmlFor="import-allow-partial">{t('step2.allowPartial')}</Label>
        </div>
      )}
      {hasErrors && <p className="text-sm text-muted-foreground">{t('step2.allowPartialHint')}</p>}
    </div>
  );
}

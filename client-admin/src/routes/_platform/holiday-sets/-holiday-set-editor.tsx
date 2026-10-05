import {
  Button,
  Card,
  DatePicker,
  EmptyState,
  Input,
  Label,
  TableCount,
} from '@biddaloy/ui/components';
import type { HolidayEntryInput, PublicHolidaySet } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { parseDate, toIsoDate } from '@biddaloy/ui/utils';
import { CircleAlertIcon, PlusIcon, SaveIcon, Trash2Icon } from 'lucide-react';
import * as React from 'react';

/**
 * [17.3.5/#715] Presentational entries editor for one holiday set —
 * pulled out of `$setId.tsx` so it can be storied
 * (`-holiday-set-editor.stories.tsx`) without a router or live queries,
 * same split `schools/-schools-list-view.tsx` uses for its list page.
 *
 * Entries carry a client-only `rowKey` (not sent to the server) so newly
 * added rows without a server `id` yet still have a stable React key —
 * `HolidayEntryInputDto.id` is optional exactly because the server only
 * sees it on entries that already existed (`public-holidays.dto.ts`).
 *
 * [31.4.platform-3] Publish / unpublish moved to the page header; this card
 * is the table (desktop) or stacked entry cards (phone) plus the footer with
 * the one filled "Save".
 */
export interface HolidaySetEditorProps {
  set: PublicHolidaySet;
  onSave: (entries: HolidayEntryInput[]) => void;
  isSaving: boolean;
  saveError: unknown;
  saveSucceeded: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}

interface EditableEntry {
  rowKey: string;
  id?: string;
  date: string;
  end_date: string;
  name: string;
  name_bn: string;
}

function toEditable(entries: PublicHolidaySet['entries']): EditableEntry[] {
  return entries.map((entry) => ({
    rowKey: entry.id,
    id: entry.id,
    date: entry.date,
    end_date: entry.end_date,
    name: entry.name,
    name_bn: entry.name_bn ?? '',
  }));
}

function toInput(rows: EditableEntry[]): HolidayEntryInput[] {
  return rows.map((row) => ({
    ...(row.id ? { id: row.id } : {}),
    date: row.date,
    end_date: row.end_date,
    name: row.name,
    name_bn: row.name_bn === '' ? null : row.name_bn,
  }));
}

function serialize(rows: EditableEntry[]): string {
  return JSON.stringify(toInput(rows));
}

/** `parseDate` throws on anything that is not a real `YYYY-MM-DD`; a blank
 * (new) row or a stale value just shows the picker empty. */
function safeParseDate(raw: string): Date | undefined {
  if (!raw) return undefined;
  try {
    return parseDate(raw);
  } catch {
    return undefined;
  }
}

/** Phone layout (stacked entry cards) below `md`. jsdom has no `matchMedia`,
 * so tests get the desktop table. Only one layout is ever in the DOM. */
function useIsPhone(): boolean {
  const query = '(max-width: 767px)';
  const [phone, setPhone] = React.useState(
    () => typeof matchMedia === 'function' && matchMedia(query).matches,
  );
  React.useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const media = matchMedia(query);
    const onChange = () => setPhone(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return phone;
}

export function HolidaySetEditor({
  set,
  onSave,
  isSaving,
  saveError,
  saveSucceeded,
  onDirtyChange,
}: HolidaySetEditorProps) {
  const { t } = useTranslation('platform');
  const config = useRegionConfig();
  const phone = useIsPhone();
  const [rows, setRows] = React.useState<EditableEntry[]>(() => toEditable(set.entries));
  const savedSerializedRef = React.useRef(serialize(toEditable(set.entries)));

  React.useEffect(() => {
    const editable = toEditable(set.entries);
    setRows(editable);
    savedSerializedRef.current = serialize(editable);
  }, [set.id, set.entries]);

  const isDirty = serialize(rows) !== savedSerializedRef.current;

  React.useEffect(() => {
    onDirtyChange?.(isDirty);
    return () => onDirtyChange?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onDirtyChange is expected to be stable per caller
  }, [isDirty]);

  function updateRow(rowKey: string, patch: Partial<EditableEntry>) {
    setRows((prev) => prev.map((row) => (row.rowKey === rowKey ? { ...row, ...patch } : row)));
  }

  function addRow() {
    setRows((prev) => [
      ...prev,
      { rowKey: crypto.randomUUID(), date: '', end_date: '', name: '', name_bn: '' },
    ]);
  }

  function removeRow(rowKey: string) {
    setRows((prev) => prev.filter((row) => row.rowKey !== rowKey));
  }

  function handleSave() {
    onSave(toInput(rows));
  }

  React.useEffect(() => {
    if (saveSucceeded) {
      savedSerializedRef.current = serialize(rows);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-sync the saved snapshot on success
  }, [saveSucceeded]);

  const rowName = (row: EditableEntry) => row.name || t('holidaySets.detail.unnamed');

  const dateField = (
    row: EditableEntry,
    field: 'date' | 'end_date',
    label: string,
    id?: string,
  ) => (
    <DatePicker
      {...(id ? { id } : {})}
      aria-label={label}
      value={safeParseDate(row[field])}
      onValueChange={(date) => updateRow(row.rowKey, { [field]: date ? toIsoDate(date) : '' })}
      config={config}
      min={field === 'end_date' ? safeParseDate(row.date) : undefined}
      disabled={isSaving}
    />
  );

  const removeButton = (row: EditableEntry, withText: boolean) => (
    <Button
      type="button"
      variant="ghost"
      className={withText ? 'h-11 text-destructive' : 'size-11 text-destructive'}
      aria-label={t('holidaySets.detail.removeRowNamed', { name: rowName(row) })}
      disabled={isSaving}
      onClick={() => removeRow(row.rowKey)}
    >
      <Trash2Icon aria-hidden="true" />
      {withText && t('holidaySets.detail.removeRow')}
    </Button>
  );

  return (
    <Card className="overflow-hidden" aria-labelledby="holiday-entries-title">
      <div className="p-4 md:px-5">
        <h2 id="holiday-entries-title" className="text-h2">
          {t('holidaySets.detail.entriesTitle')}
        </h2>
        <p className="mt-1 text-text-secondary">{t('holidaySets.detail.entriesHelp')}</p>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={t('holidaySets.detail.emptyTitle')}
          explanation={t('holidaySets.detail.emptyMessage')}
          action={{ label: t('holidaySets.detail.addRow'), onClick: addRow }}
        />
      ) : phone ? (
        <ul className="divide-y divide-border-subtle border-t border-border-subtle">
          {rows.map((row) => (
            <li key={row.rowKey} className="space-y-3 p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="min-w-0 truncate text-h3">{row.name_bn || rowName(row)}</h3>
                {removeButton(row, true)}
              </div>
              <div className="grid gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor={`entry-${row.rowKey}-start`}>
                    {t('holidaySets.detail.columnDate')}
                  </Label>
                  {dateField(
                    row,
                    'date',
                    t('holidaySets.detail.columnDate'),
                    `entry-${row.rowKey}-start`,
                  )}
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`entry-${row.rowKey}-end`}>
                    {t('holidaySets.detail.columnEndDate')}
                  </Label>
                  {dateField(
                    row,
                    'end_date',
                    t('holidaySets.detail.columnEndDate'),
                    `entry-${row.rowKey}-end`,
                  )}
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`entry-${row.rowKey}-name`}>
                    {t('holidaySets.detail.columnName')}
                  </Label>
                  <Input
                    id={`entry-${row.rowKey}-name`}
                    value={row.name}
                    disabled={isSaving}
                    onChange={(event) => updateRow(row.rowKey, { name: event.target.value })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`entry-${row.rowKey}-nameBn`}>
                    {t('holidaySets.detail.columnNameBn')}
                  </Label>
                  <Input
                    id={`entry-${row.rowKey}-nameBn`}
                    value={row.name_bn}
                    placeholder={t('holidaySets.detail.optional')}
                    disabled={isSaving}
                    onChange={(event) => updateRow(row.rowKey, { name_bn: event.target.value })}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <table className="w-full text-left">
          <thead className="border-y border-border-subtle bg-muted text-label text-text-secondary">
            <tr>
              <th className="h-10 px-2 ps-5 font-medium">{t('holidaySets.detail.columnDate')}</th>
              <th className="h-10 px-2 font-medium">{t('holidaySets.detail.columnEndDate')}</th>
              <th className="h-10 px-2 font-medium">{t('holidaySets.detail.columnName')}</th>
              <th className="h-10 px-2 font-medium">{t('holidaySets.detail.columnNameBn')}</th>
              <th className="h-10 px-2 pe-5 text-end font-medium">
                {t('holidaySets.detail.columnActions')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {rows.map((row) => (
              <tr key={row.rowKey}>
                <td className="h-12 px-2 py-2 ps-5">
                  {dateField(row, 'date', t('holidaySets.detail.columnDate'))}
                </td>
                <td className="h-12 px-2 py-2">
                  {dateField(row, 'end_date', t('holidaySets.detail.columnEndDate'))}
                </td>
                <td className="h-12 px-2 py-2">
                  <Input
                    aria-label={t('holidaySets.detail.columnName')}
                    value={row.name}
                    disabled={isSaving}
                    onChange={(event) => updateRow(row.rowKey, { name: event.target.value })}
                  />
                </td>
                <td className="h-12 px-2 py-2">
                  <Input
                    aria-label={t('holidaySets.detail.columnNameBn')}
                    value={row.name_bn}
                    placeholder={t('holidaySets.detail.optional')}
                    disabled={isSaving}
                    onChange={(event) => updateRow(row.rowKey, { name_bn: event.target.value })}
                  />
                </td>
                <td className="h-12 px-2 py-2 pe-5 text-end">{removeButton(row, false)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="sticky bottom-16 flex flex-col gap-3 border-t border-border-subtle bg-surface p-4 md:static md:flex-row md:items-center md:justify-between md:px-5">
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            className="h-11 flex-1 md:flex-none"
            disabled={isSaving}
            onClick={addRow}
          >
            <PlusIcon aria-hidden="true" />
            {t('holidaySets.detail.addRow')}
          </Button>
          <TableCount total={rows.length} />
        </div>
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
          {isDirty && (
            <p className="flex items-center gap-1 text-caption text-status-due-fg">
              <CircleAlertIcon className="size-4 shrink-0" aria-hidden="true" />
              {t('holidaySets.detail.unsavedNotice')}
            </p>
          )}
          <Button
            type="button"
            className="h-11"
            disabled={!isDirty}
            loading={isSaving}
            onClick={handleSave}
          >
            <SaveIcon aria-hidden="true" />
            {isSaving ? t('holidaySets.detail.saving') : t('holidaySets.detail.saveAction')}
          </Button>
        </div>
      </div>

      {saveError !== undefined && saveError !== null && (
        <p
          role="alert"
          className="flex items-center gap-1 px-4 pb-4 text-caption text-destructive md:px-5"
        >
          <CircleAlertIcon className="size-4 shrink-0" aria-hidden="true" />
          {t('holidaySets.detail.saveError')}
        </p>
      )}
    </Card>
  );
}

export type { EditableEntry };

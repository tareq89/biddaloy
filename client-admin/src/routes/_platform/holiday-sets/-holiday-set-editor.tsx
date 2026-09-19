import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@biddaloy/ui/components';
import type { HolidayEntryInput, PublicHolidaySet } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { Trash2 } from 'lucide-react';
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
 */
export interface HolidaySetEditorProps {
  set: PublicHolidaySet;
  onSave: (entries: HolidayEntryInput[]) => void;
  isSaving: boolean;
  saveError: unknown;
  saveSucceeded: boolean;
  onPublish: () => void;
  onUnpublish: () => void;
  isPublishing: boolean;
  isUnpublishing: boolean;
  publishError: unknown;
  unpublishError: unknown;
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

export function HolidaySetEditor({
  set,
  onSave,
  isSaving,
  saveError,
  saveSucceeded,
  onPublish,
  onUnpublish,
  isPublishing,
  isUnpublishing,
  publishError,
  unpublishError,
  onDirtyChange,
}: HolidaySetEditorProps) {
  const { t } = useTranslation('platform');
  const [rows, setRows] = React.useState<EditableEntry[]>(() => toEditable(set.entries));
  const savedSerializedRef = React.useRef(serialize(toEditable(set.entries)));
  const [publishDialogOpen, setPublishDialogOpen] = React.useState(false);
  const [unpublishDialogOpen, setUnpublishDialogOpen] = React.useState(false);

  React.useEffect(() => {
    const editable = toEditable(set.entries);
    setRows(editable);
    savedSerializedRef.current = serialize(editable);
  }, [set.id, set.entries]);

  const isDirty = serialize(rows) !== savedSerializedRef.current;
  const published = set.published_at !== null;

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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">
          <span>
            {t('holidaySets.detail.sourceLabel')}: {set.source}
          </span>
          <span className="mx-2">·</span>
          <span>
            {t('holidaySets.detail.fetchedAtLabel')}: {new Date(set.fetched_at).toLocaleString()}
          </span>
        </div>
        <div className="flex gap-2">
          {published ? (
            <Button
              type="button"
              variant="outline"
              disabled={isDirty || isUnpublishing}
              title={isDirty ? t('holidaySets.detail.publishDisabledHint') : undefined}
              onClick={() => setUnpublishDialogOpen(true)}
            >
              {t('holidaySets.detail.unpublishAction')}
            </Button>
          ) : (
            <Button
              type="button"
              disabled={isDirty || isPublishing}
              title={isDirty ? t('holidaySets.detail.publishDisabledHint') : undefined}
              onClick={() => setPublishDialogOpen(true)}
            >
              {t('holidaySets.detail.publishAction')}
            </Button>
          )}
        </div>
      </div>

      {publishError !== undefined && publishError !== null && (
        <p role="alert" className="text-sm text-destructive">
          {t('holidaySets.detail.publishError')}
        </p>
      )}
      {unpublishError !== undefined && unpublishError !== null && (
        <p role="alert" className="text-sm text-destructive">
          {t('holidaySets.detail.unpublishError')}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('holidaySets.detail.emptyMessage')}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('holidaySets.detail.columnDate')}</TableHead>
              <TableHead>{t('holidaySets.detail.columnEndDate')}</TableHead>
              <TableHead>{t('holidaySets.detail.columnName')}</TableHead>
              <TableHead>{t('holidaySets.detail.columnNameBn')}</TableHead>
              <TableHead className="text-right">{t('holidaySets.detail.columnActions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.rowKey}>
                <TableCell>
                  <Input
                    type="date"
                    aria-label={t('holidaySets.detail.columnDate')}
                    value={row.date}
                    onChange={(event) => updateRow(row.rowKey, { date: event.target.value })}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="date"
                    aria-label={t('holidaySets.detail.columnEndDate')}
                    value={row.end_date}
                    onChange={(event) => updateRow(row.rowKey, { end_date: event.target.value })}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    aria-label={t('holidaySets.detail.columnName')}
                    value={row.name}
                    onChange={(event) => updateRow(row.rowKey, { name: event.target.value })}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    aria-label={t('holidaySets.detail.columnNameBn')}
                    value={row.name_bn}
                    onChange={(event) => updateRow(row.rowKey, { name_bn: event.target.value })}
                  />
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t('holidaySets.detail.removeRow')}
                    onClick={() => removeRow(row.rowKey)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <div className="flex items-center justify-between">
        <Button type="button" variant="outline" size="sm" onClick={addRow}>
          {t('holidaySets.detail.addRow')}
        </Button>
        <Button type="button" disabled={!isDirty} loading={isSaving} onClick={handleSave}>
          {isSaving ? t('holidaySets.detail.saving') : t('holidaySets.detail.saveAction')}
        </Button>
      </div>

      {saveError !== undefined && saveError !== null && (
        <p role="alert" className="text-sm text-destructive">
          {saveError instanceof ApiError ? saveError.message : t('holidaySets.detail.saveError')}
        </p>
      )}

      <Dialog open={publishDialogOpen} onOpenChange={setPublishDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('holidaySets.detail.publishDialog.title')}</DialogTitle>
            <DialogDescription>
              {t('holidaySets.detail.publishDialog.description')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('actions.cancel', { ns: 'common' })}
              </Button>
            </DialogClose>
            <Button
              type="button"
              loading={isPublishing}
              onClick={() => {
                onPublish();
                setPublishDialogOpen(false);
              }}
            >
              {t('holidaySets.detail.publishDialog.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={unpublishDialogOpen} onOpenChange={setUnpublishDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('holidaySets.detail.unpublishDialog.title')}</DialogTitle>
            <DialogDescription>
              {t('holidaySets.detail.unpublishDialog.description')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('actions.cancel', { ns: 'common' })}
              </Button>
            </DialogClose>
            <Button
              type="button"
              variant="destructive"
              loading={isUnpublishing}
              onClick={() => {
                onUnpublish();
                setUnpublishDialogOpen(false);
              }}
            >
              {t('holidaySets.detail.unpublishDialog.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export type { EditableEntry };

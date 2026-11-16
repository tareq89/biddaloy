/**
 * [71.4.09] Call list of one admission list: tap a phone to call, tick "called", write a note.
 * Stacked cards on a phone, one table on a desktop. Each tick and each note saves on its own.
 */
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  toast,
} from '@biddaloy/ui/components';
import { useCallList, useSetCalled, type CallListRow } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatPhone, renderDigits } from '@biddaloy/ui/utils';
import * as React from 'react';

function CallRow({ row }: { row: CallListRow }) {
  const { t } = useTranslation('admission-lists');
  const region = useRegionConfig();
  const set = useSetCalled();
  const [note, setNote] = React.useState(row.note ?? '');

  function save(called: boolean, text: string) {
    set.mutate(
      { applicantId: row.applicant_id, called, ...(text.trim() ? { note: text.trim() } : {}) },
      { onError: () => toast.error(t('call.saveError')) },
    );
  }
  return (
    <li className="flex flex-col gap-2 border-b border-border-subtle p-3 md:grid md:grid-cols-[1fr_10rem_5rem_9rem_1fr] md:items-center">
      <span className="font-medium">{row.name}</span>
      <a
        className="text-primary underline"
        href={`tel:${row.phone}`}
        aria-label={t('call.callLink', { name: row.name })}
      >
        {formatPhone(row.phone, region)}
      </a>
      <span className="tabular-nums">
        {row.roll ? renderDigits(row.roll, region.numerals) : '—'}
      </span>
      <label className="flex items-center gap-2">
        <Checkbox
          aria-label={t('call.calledLabel', { name: row.name })}
          checked={row.called}
          disabled={set.isPending}
          onCheckedChange={(v) => save(v === true, note)}
        />
        <span>{t('call.called')}</span>
      </label>
      <Input
        aria-label={t('call.noteLabel', { name: row.name })}
        value={note}
        maxLength={300}
        // The server keeps a note only on a called row; an uncalled one would be dropped silently.
        disabled={!row.called}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => note !== (row.note ?? '') && save(row.called, note)}
      />
    </li>
  );
}

export function CallListDialog({
  roundId,
  listId,
  open,
  onOpenChange,
}: {
  roundId: string;
  listId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation('admission-lists');
  const list = useCallList(roundId, listId);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{t('call.title')}</DialogTitle>
        </DialogHeader>
        {list.isError ? (
          <p role="alert">{t('call.loadError')}</p>
        ) : !list.data ? (
          <p role="status">{t('call.loading')}</p>
        ) : list.data.length === 0 ? (
          <p>{t('call.empty')}</p>
        ) : (
          <ul className="max-h-[65vh] overflow-auto rounded-md border">
            {list.data.map((r) => (
              <CallRow key={r.applicant_id} row={r} />
            ))}
          </ul>
        )}
        <div>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('call.close')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

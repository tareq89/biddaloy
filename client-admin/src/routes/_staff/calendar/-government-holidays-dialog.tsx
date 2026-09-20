/**
 * [17.4.2] `GET /calendar/public-holidays` suggestions -> tick a subset
 * -> `POST /calendar/public-holidays/add` with only the ticked entry
 * ids. Entries already added as a `HOLIDAY` event this year are shown
 * disabled rather than omitted, so the list stays a stable "everything
 * for this year" view.
 */
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@biddaloy/ui/components';
import type { CalendarEvent, PublicHolidayEntry } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, parseServerDate } from '@biddaloy/ui/utils';
import * as React from 'react';

export interface GovernmentHolidaysDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  suggestions: PublicHolidayEntry[];
  existingEvents: CalendarEvent[];
  isPending: boolean;
  onAdd: (entryIds: string[]) => void;
}

/** Matches the server's own dedupe rule for adding a suggestion twice —
 * by `start_date` alone, not name. A holiday can be renamed or have a
 * `name_bn` set after being added; matching on name too would then miss
 * the existing event and let this dialog show it as addable again, even
 * though the server would silently skip it as a duplicate. */
function isAlreadyAdded(entry: PublicHolidayEntry, existingEvents: CalendarEvent[]): boolean {
  return existingEvents.some((event) => event.start_date === entry.date);
}

export function GovernmentHolidaysDialog({
  open,
  onOpenChange,
  suggestions,
  existingEvents,
  isPending,
  onAdd,
}: GovernmentHolidaysDialogProps) {
  const { t } = useTranslation('calendar');
  const regionConfig = useRegionConfig();
  const [checked, setChecked] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    if (!open) setChecked(new Set());
  }, [open]);

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('governmentHolidaysDialog.title')}</DialogTitle>
          <DialogDescription>{t('governmentHolidaysDialog.description')}</DialogDescription>
        </DialogHeader>

        {suggestions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('governmentHolidaysDialog.empty')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {suggestions.map((entry) => {
              const alreadyAdded = isAlreadyAdded(entry, existingEvents);
              return (
                <li key={entry.id} className="flex items-center gap-2">
                  <Checkbox
                    id={`gov-holiday-${entry.id}`}
                    checked={alreadyAdded || checked.has(entry.id)}
                    disabled={alreadyAdded}
                    onCheckedChange={() => toggle(entry.id)}
                  />
                  <label htmlFor={`gov-holiday-${entry.id}`} className="flex-1 text-sm">
                    {entry.name} — {formatDate(parseServerDate(entry.date), regionConfig)}
                  </label>
                  {alreadyAdded && (
                    <span className="text-xs text-muted-foreground">
                      {t('governmentHolidaysDialog.alreadyAdded')}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <DialogFooter>
          <Button
            type="button"
            loading={isPending}
            disabled={checked.size === 0}
            onClick={() => onAdd(Array.from(checked))}
          >
            {t('governmentHolidaysDialog.add')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

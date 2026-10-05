/**
 * [17.4.2] / [31.4] `GET /calendar/public-holidays` suggestions -> tick a
 * subset -> `POST /calendar/public-holidays/add` with only the ticked entry
 * ids. A full-page modal (`FullPageShell`, D21: a form that contains a list)
 * mounted by `/calendar?panel=holidays`. File and export name kept so
 * `index.tsx` keeps its `open` / `onOpenChange` mount. Entries already added
 * as a `HOLIDAY` event this year are shown disabled rather than omitted, so
 * the list stays a stable "everything for this year" view.
 */
import { Card, Checkbox, ConfirmDialog, EmptyState, StatusBadge } from '@biddaloy/ui/components';
import type { CalendarEvent, PublicHolidayEntry } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { FullPageShell } from '@biddaloy/ui/shells';
import { formatDate, formatNumber } from '@biddaloy/ui/utils';
import { CalendarXIcon } from 'lucide-react';
import * as React from 'react';

export interface GovernmentHolidaysDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  suggestions: PublicHolidayEntry[];
  existingEvents: CalendarEvent[];
  isPending: boolean;
  /** The add request failed: show a translated alert. */
  error?: unknown;
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
  error,
  onAdd,
}: GovernmentHolidaysDialogProps) {
  const { t } = useTranslation('calendar');
  const { t: tCommon } = useTranslation('common');
  const regionConfig = useRegionConfig();
  const [checked, setChecked] = React.useState<Set<string>>(new Set());
  const [discardOpen, setDiscardOpen] = React.useState(false);

  React.useEffect(() => {
    if (!open) setChecked(new Set());
  }, [open]);

  if (!open) return null;

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // A pending add must not be abandoned mid-request (Esc / X / Cancel).
  const close = () => {
    if (!isPending) onOpenChange(false);
  };

  return (
    <>
      <FullPageShell
        title={t('governmentHolidaysDialog.title')}
        size="form"
        dirty={checked.size > 0}
        onClose={close}
        secondary={{
          label: t('eventForm.cancel'),
          // The shell's footer Cancel bypasses its own discard prompt.
          onClick: () => (checked.size > 0 ? setDiscardOpen(true) : close()),
        }}
        primary={{
          label: t('governmentHolidaysDialog.addCount', {
            count: checked.size,
            n: formatNumber(checked.size, regionConfig),
          }),
          onClick: () => onAdd(Array.from(checked)),
          disabled: checked.size === 0,
          busy: isPending,
        }}
      >
        <p className="mt-0.5 text-text-secondary">{t('governmentHolidaysDialog.description')}</p>

        {error != null && (
          <p role="alert" className="text-destructive">
            {t('governmentHolidaysDialog.addFailed')}
          </p>
        )}

        {suggestions.length === 0 ? (
          <EmptyState
            icon={<CalendarXIcon aria-hidden="true" />}
            title={t('governmentHolidaysDialog.emptyTitle')}
            explanation={t('governmentHolidaysDialog.empty')}
          />
        ) : (
          <Card className="p-4 md:p-5">
            <ul className="divide-y divide-border-subtle">
              {suggestions.map((entry) => {
                const alreadyAdded = isAlreadyAdded(entry, existingEvents);
                return (
                  <li key={entry.id} className="flex min-h-11 items-center gap-3 py-2">
                    <Checkbox
                      id={`gov-holiday-${entry.id}`}
                      checked={alreadyAdded || checked.has(entry.id)}
                      disabled={alreadyAdded}
                      onCheckedChange={() => toggle(entry.id)}
                    />
                    <label htmlFor={`gov-holiday-${entry.id}`} className="min-w-0 flex-1">
                      {entry.name}{' '}
                      <span className="text-text-secondary">
                        {formatDate(entry.date, regionConfig)}
                      </span>
                    </label>
                    {alreadyAdded && (
                      <StatusBadge
                        tone="neutral"
                        label={t('governmentHolidaysDialog.alreadyAdded')}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </FullPageShell>
      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title={tCommon('fullPage.discardTitle')}
        description={tCommon('fullPage.discardDescription')}
        confirmLabel={tCommon('fullPage.discardConfirm')}
        cancelLabel={tCommon('fullPage.keepEditing')}
        onConfirm={() => {
          setDiscardOpen(false);
          onOpenChange(false);
        }}
      />
    </>
  );
}

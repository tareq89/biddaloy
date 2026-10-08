/**
 * [66.2] D5: log an extra or double class from the plan (date + period). The
 * period list is the section's shift's CLASS slots; the server owns the rest
 * (7-day window, slot taken, routine period) and answers with a `details.code`.
 */
import { UserRole } from '@biddaloy/shared';
import {
  Button,
  DatePicker,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@biddaloy/ui/components';
import {
  useActiveRole,
  useClass,
  useLogExtraLesson,
  usePeriodSlots,
  type StudyPlanDetail,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber, formatTime, toIsoDate } from '@biddaloy/ui/utils';
import { Link } from '@tanstack/react-router';
import * as React from 'react';

import { subjectName } from '../../homework/-subject-name';

import { DialogError, errorCode } from './action-errors';

const WINDOW_DAYS = 7;
const KNOWN = [
  'LESSON_DELIVERY_SLOT_TAKEN',
  'LESSON_DELIVERY_WINDOW_CLOSED',
  'LESSON_DELIVERY_IS_ROUTINE_PERIOD',
];

export interface ExtraClassDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: StudyPlanDetail;
}

export function ExtraClassDialog({ open, onOpenChange, plan }: ExtraClassDialogProps) {
  const { t, i18n } = useTranslation('studyPlans');
  const { t: tCommon } = useTranslation('common');
  const { t: tRoutines } = useTranslation('routines');
  const config = useRegionConfig();
  const isAdmin = useActiveRole() === UserRole.ADMIN;
  const log = useLogExtraLesson();

  const shiftId = useClass(plan.section.class_id).data?.shift_id ?? undefined;
  const slots = (usePeriodSlots(shiftId).data ?? []).filter((s) => s.kind === 'CLASS');

  const today = React.useMemo(() => new Date(), []);
  const oldest = new Date(today);
  oldest.setDate(oldest.getDate() - WINDOW_DAYS);

  const [date, setDate] = React.useState<Date | undefined>(today);
  const [slotId, setSlotId] = React.useState('');
  const [note, setNote] = React.useState('');

  React.useEffect(() => {
    if (!open) return;
    setDate(new Date());
    setSlotId('');
    setNote('');
    log.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open
  }, [open]);

  const subject = subjectName(plan.subject, i18n.language);
  const iso = date ? toIsoDate(date) : '';
  const code = errorCode(log.error);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!date || slotId === '' || log.isPending) return;
    log.mutate(
      {
        section_id: plan.section.id,
        subject_id: plan.subject.id,
        date: iso,
        period_slot_id: slotId,
        ...(note.trim() !== '' ? { note: note.trim() } : {}),
      },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !log.isPending && onOpenChange(next)}>
      <DialogContent size="md" closeLabel={tCommon('actions.close')}>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('extra.title')}</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="extra-class-date" className="text-label text-text-primary">
              {t('extra.date')}
            </label>
            <DatePicker
              id="extra-class-date"
              aria-label={t('extra.date')}
              value={date}
              onValueChange={setDate}
              config={config}
              max={today}
              min={isAdmin ? undefined : oldest}
              clearable={false}
              disabled={log.isPending}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="extra-class-period" className="text-label text-text-primary">
              {t('extra.period')}
            </label>
            <Select value={slotId} onValueChange={setSlotId} disabled={log.isPending}>
              <SelectTrigger id="extra-class-period">
                <SelectValue placeholder={tCommon('form.selectPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {slots.map((slot) => (
                  <SelectItem key={slot.id} value={slot.id}>
                    {tRoutines('agenda.periodLabel', {
                      sequence: formatNumber(slot.sequence, config),
                    })}{' '}
                    · {formatTime(slot.starts_at, config)} – {formatTime(slot.ends_at, config)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="extra-class-note" className="text-label text-text-primary">
              {t('extra.note')}
            </label>
            <Textarea
              id="extra-class-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              disabled={log.isPending}
            />
          </div>

          {log.isError && (
            <DialogError>
              {code === 'LESSON_DELIVERY_SLOT_TAKEN' && t('extra.taken')}
              {code === 'LESSON_DELIVERY_WINDOW_CLOSED' && t('extra.windowClosed')}
              {code === 'LESSON_DELIVERY_IS_ROUTINE_PERIOD' && (
                <>
                  {t('extra.isRoutine', { subject })}{' '}
                  <Link to={`/routines/my?date=${iso}` as '/routines/my'} className="underline">
                    {t('extra.openMyRoutine')}
                  </Link>
                </>
              )}
              {!KNOWN.includes(code ?? '') && tCommon('status.error')}
            </DialogError>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={log.isPending}>
                {tCommon('actions.cancel')}
              </Button>
            </DialogClose>
            <Button type="submit" loading={log.isPending} disabled={!date || slotId === ''}>
              {t('extra.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

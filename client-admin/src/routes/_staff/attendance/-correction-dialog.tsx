/**
 * [9.7] Turns 9.6's inert "Request correction" affordance into a real,
 * reason-captured edit — `PATCH /attendance/records/:recordId`
 * (`useCorrectRecord`, `ui/src/hooks/attendance.ts`).
 *
 * `reason` is the whole point of this ticket: there is no "skip reason"
 * escape hatch, no default reason, no remembered-last-reason. Save stays
 * disabled until both a real reason (>= 3 characters) *and* an actually
 * different status are present — correcting a mark to the value it
 * already holds would write a reason for a change that never happened.
 *
 * Uses the repo's standard `Form`/`FormField` + react-hook-form + zod
 * plumbing (`-student-form.tsx`'s own pattern), not hand-rolled
 * validation.
 */
import { AttendanceStatus } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import {
  AttendanceStatusControl,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Textarea,
  toast,
} from '@biddaloy/ui/components';
import { useCorrectRecord, type RegisterStudent } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { RecordHistoryPanel } from './-record-history-panel';

export interface CorrectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sectionId: string;
  date: string;
  periodNo?: number | undefined;
  student: RegisterStudent;
}

const schema = z.object({
  status: z.nativeEnum(AttendanceStatus),
  minutes_late: z.number().int().min(0).max(1440).nullable(),
  reason: z.string().trim().min(3).max(280),
});

type FormValues = z.infer<typeof schema>;

export function CorrectionDialog({
  open,
  onOpenChange,
  sectionId,
  date,
  periodNo,
  student,
}: CorrectionDialogProps) {
  const { t } = useTranslation('attendance');
  const correctRecord = useCorrectRecord(sectionId, date, periodNo);
  const [historyOpen, setHistoryOpen] = React.useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onChange',
    defaultValues: {
      status: (student.status as AttendanceStatus | null) ?? AttendanceStatus.PRESENT,
      minutes_late: student.minutes_late,
      reason: '',
    },
  });

  // Re-seeds the form every time a *different* row's dialog opens — the
  // dialog instance is shared across rows in `$sectionId.tsx`, so without
  // this a second student would inherit the first one's leftover status
  // pick and reason text.
  React.useEffect(() => {
    if (!open) return;
    form.reset({
      status: (student.status as AttendanceStatus | null) ?? AttendanceStatus.PRESENT,
      minutes_late: student.minutes_late,
      reason: '',
    });
    setHistoryOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-seed on open/student change only
  }, [open, student.student_id]);

  const statusValue = form.watch('status');
  const reasonValue = form.watch('reason');
  const minutesLateValue = form.watch('minutes_late');

  const statusUnchanged = statusValue === student.status;
  const reasonValid = reasonValue.trim().length >= 3 && reasonValue.length <= 280;
  const canSave = !statusUnchanged && reasonValid && !correctRecord.isPending;

  function handleSave(values: FormValues) {
    if (!student.record_id) return;
    correctRecord.mutate(
      {
        recordId: student.record_id,
        status: values.status,
        ...(values.status === AttendanceStatus.LATE
          ? { minutes_late: values.minutes_late ?? undefined }
          : {}),
        reason: values.reason.trim(),
      },
      {
        onSuccess: () => {
          toast.success(t('correction.savedToast'));
          onOpenChange(false);
        },
        onError: (error) => {
          if (error instanceof ApiError && error.statusCode === 422) {
            form.setError('reason', { type: 'server', message: error.message });
            return;
          }
          toast.error(error instanceof Error ? error.message : t('correction.errorToast'));
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('correction.title')}</DialogTitle>
          <DialogDescription>
            {t('mark.rollNumber', { roll: student.roll_number })} · {student.full_name}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => void form.handleSubmit(handleSave)(event)}
          >
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">
                {t('correction.currentStatus')}
              </span>
              <span className="text-sm">
                {student.status
                  ? t(`statusControl.status.${student.status}`)
                  : t('statusControl.unmarked')}
              </span>
            </div>

            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('correction.newStatusLabel')}</FormLabel>
                  <FormControl>
                    <AttendanceStatusControl
                      value={field.value}
                      onChange={field.onChange}
                      variant="expanded"
                      studentName={student.full_name}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {statusValue === AttendanceStatus.LATE && (
              <FormField
                control={form.control}
                name="minutes_late"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel htmlFor="correction-minutes-late">
                      {t('statusControl.minutesLateLabel')}
                    </FormLabel>
                    <FormControl>
                      <Input
                        id="correction-minutes-late"
                        type="number"
                        min={0}
                        max={1440}
                        inputMode="numeric"
                        value={minutesLateValue ?? ''}
                        onChange={(event) => {
                          const raw = event.target.value;
                          field.onChange(raw === '' ? null : Number(raw));
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="correction-reason">{t('correction.reasonLabel')}</FormLabel>
                  <FormControl>
                    <Textarea
                      id="correction-reason"
                      required
                      minLength={3}
                      maxLength={280}
                      placeholder={t('correction.reasonPlaceholder')}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>{t('correction.reasonHelper')}</FormDescription>
                  <div className="flex items-center justify-between">
                    <FormMessage />
                    <span className="text-xs text-muted-foreground">
                      {t('correction.reasonCharacterCount', { count: field.value.length })}
                    </span>
                  </div>
                </FormItem>
              )}
            />

            {statusUnchanged && (
              <p className="text-xs text-muted-foreground">{t('correction.unchangedStatusHint')}</p>
            )}

            <div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setHistoryOpen((current) => !current)}
              >
                {t('correction.historyDisclosure')}
              </Button>
              {historyOpen && (
                <div className="mt-2 rounded-md border border-border-subtle p-3">
                  <RecordHistoryPanel
                    recordId={student.record_id ?? undefined}
                    studentName={student.full_name}
                  />
                </div>
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                {t('correction.cancel')}
              </Button>
              <Button type="submit" disabled={!canSave} loading={correctRecord.isPending}>
                {correctRecord.isPending ? t('correction.saving') : t('correction.save')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

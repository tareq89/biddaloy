/**
 * [39.3.2] "Record leaving" dialog — replaces the status dropdown (D8).
 * Withdrawn / transferred out / graduated, with a mandatory reason (D19)
 * and a date that cannot be in the future (D18). Unpaid dues only warn
 * (D15), they never block. Not wired into the detail page here (#1197).
 */
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DatePicker,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@biddaloy/ui/components';
import { useLeaveStudent, useStudentFeeSummary, type LeaveStudentInput } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import {
  formatCurrency,
  parseServerDate,
  serverAmountToMinorUnits,
  toIsoDate,
} from '@biddaloy/ui/utils';
import { AlertTriangle } from 'lucide-react';
import * as React from 'react';

type LeaveType = LeaveStudentInput['type'];
const LEAVE_TYPES: readonly LeaveType[] = ['WITHDRAWN', 'TRANSFERRED_OUT', 'GRADUATED'];

export function todayDateInputValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
}

export interface LeaveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studentId: string;
  studentName: string;
}

export function LeaveDialog({ open, onOpenChange, studentId, studentName }: LeaveDialogProps) {
  const { t } = useTranslation('student-lifecycle');
  const config = useRegionConfig();
  const [type, setType] = React.useState<LeaveType>('WITHDRAWN');
  const [occurredOn, setOccurredOn] = React.useState(todayDateInputValue());
  const [reason, setReason] = React.useState('');
  const [destination, setDestination] = React.useState('');
  const [remark, setRemark] = React.useState('');
  const [submitted, setSubmitted] = React.useState(false);

  const leave = useLeaveStudent(studentId);
  const feeSummary = useStudentFeeSummary(open ? studentId : undefined);
  const balance = feeSummary.data?.summary.balance ?? 0;

  React.useEffect(() => {
    if (open) {
      setType('WITHDRAWN');
      setOccurredOn(todayDateInputValue());
      setReason('');
      setDestination('');
      setRemark('');
      setSubmitted(false);
      leave.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open transitions
  }, [open]);

  const dateError =
    occurredOn === ''
      ? t('errors.dateRequired')
      : occurredOn > todayDateInputValue()
        ? t('errors.dateFuture')
        : null;
  const reasonError = reason.trim() === '' ? t('errors.reasonRequired') : null;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (dateError || reasonError || leave.isPending) return;
    leave.mutate(
      {
        type,
        occurred_on: occurredOn,
        reason: reason.trim(),
        ...(type === 'TRANSFERRED_OUT' && destination.trim()
          ? { destination: destination.trim() }
          : {}),
        ...(remark.trim() ? { remark: remark.trim() } : {}),
      },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLFormElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.requestSubmit();
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" closeLabel={t('actions.close', { ns: 'common' })}>
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Ctrl+Enter bubbles from the focused field */}
        <form
          className="flex flex-col gap-4"
          onSubmit={handleSubmit}
          onKeyDown={handleKeyDown}
          noValidate
        >
          <DialogHeader>
            <DialogTitle>{t('leave.title')}</DialogTitle>
            <DialogDescription>{t('leave.description', { name: studentName })}</DialogDescription>
          </DialogHeader>

          {balance > 0 && (
            <div
              role="status"
              className="flex items-start gap-2 rounded-md bg-status-due-bg p-3 text-status-due-fg"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                {t('leave.duesWarning', {
                  amount: formatCurrency(serverAmountToMinorUnits(balance, config), config),
                })}
              </span>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="leave-type" className="font-medium">
              {t('leave.typeLabel')}
            </label>
            <Select value={type} onValueChange={(value) => setType(value as LeaveType)}>
              <SelectTrigger id="leave-type" aria-label={t('leave.typeLabel')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEAVE_TYPES.map((option) => (
                  <SelectItem key={option} value={option}>
                    {t(`leave.type.${option}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="leave-date" className="font-medium">
              {t('leave.dateLabel')}
            </label>
            <DatePicker
              id="leave-date"
              aria-label={t('leave.dateLabel')}
              config={config}
              value={occurredOn ? parseServerDate(occurredOn) : undefined}
              onValueChange={(date) => setOccurredOn(date ? toIsoDate(date) : '')}
              max={new Date()}
              aria-invalid={submitted && dateError !== null}
              aria-describedby={submitted && dateError ? 'leave-date-error' : undefined}
            />
            {submitted && dateError && (
              <p
                id="leave-date-error"
                role="alert"
                className="flex items-center gap-1 text-caption text-destructive"
              >
                {dateError}
              </p>
            )}
          </div>

          {type === 'TRANSFERRED_OUT' && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="leave-destination" className="font-medium">
                {t('leave.destinationLabel')}
              </label>
              <Input
                id="leave-destination"
                value={destination}
                onChange={(event) => setDestination(event.target.value)}
              />
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="leave-reason" className="font-medium">
              {t('leave.reasonLabel')}
            </label>
            <Textarea
              id="leave-reason"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              aria-invalid={submitted && reasonError !== null}
              aria-describedby={submitted && reasonError ? 'leave-reason-error' : undefined}
            />
            {submitted && reasonError && (
              <p
                id="leave-reason-error"
                role="alert"
                className="flex items-center gap-1 text-caption text-destructive"
              >
                {reasonError}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="leave-remark" className="font-medium">
              {t('leave.remarkLabel')}
            </label>
            <Textarea
              id="leave-remark"
              rows={2}
              value={remark}
              onChange={(event) => setRemark(event.target.value)}
            />
          </div>

          {leave.isError && (
            <p role="alert" className="flex items-center gap-1 text-caption text-destructive">
              {t('errors.generic')}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('actions.cancel', { ns: 'common' })}
            </Button>
            <Button type="submit" loading={leave.isPending}>
              {leave.isPending ? t('leave.saving') : t('leave.confirm')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

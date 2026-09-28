/**
 * [36.4] `POST /leave/requests` — self-service by default (staff profile
 * prefilled to the caller's own), or a caller-chosen staff profile when
 * opened from a staff detail page (`staffProfileId` prop), per the
 * ticket's step 5. Mirrors `-edit-user-dialog.tsx`'s form-dialog shape.
 */
import { LeaveType } from '@biddaloy/shared';
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
} from '@biddaloy/ui/components';
import { useCreateLeaveRequest } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export interface LeaveRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  staffProfileId: string;
}

const LEAVE_TYPES = Object.values(LeaveType);

export function LeaveRequestDialog({
  open,
  onOpenChange,
  staffProfileId,
}: LeaveRequestDialogProps) {
  const { t } = useTranslation('leave');
  const createRequest = useCreateLeaveRequest();

  const [leaveType, setLeaveType] = React.useState<LeaveType>(LeaveType.CASUAL);
  const [startDate, setStartDate] = React.useState('');
  const [endDate, setEndDate] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [validationError, setValidationError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setLeaveType(LeaveType.CASUAL);
    setStartDate('');
    setEndDate('');
    setReason('');
    setValidationError(null);
    createRequest.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close
  }, [open]);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (startDate === '' || endDate === '') {
      setValidationError(t('request.errorDateRange'));
      return;
    }
    if (endDate < startDate) {
      setValidationError(t('request.errorDateRange'));
      return;
    }
    setValidationError(null);
    createRequest.mutate(
      {
        staff_profile_id: staffProfileId,
        leave_type: leaveType,
        start_date: startDate,
        end_date: endDate,
        ...(reason.trim() !== '' ? { reason: reason.trim() } : {}),
      },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  const serverErrorMessage =
    createRequest.error instanceof ApiError
      ? createRequest.error.message
      : t('request.errorMessage');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('request.title')}</DialogTitle>
            <DialogDescription>{t('request.description')}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="leave-request-type" className="text-sm font-medium">
              {t('request.typeLabel')}
            </label>
            <select
              id="leave-request-type"
              className="h-8 rounded-md border border-input bg-card px-2.5 text-sm"
              value={leaveType}
              onChange={(event) => setLeaveType(event.target.value as LeaveType)}
            >
              {LEAVE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`type.${type}`)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="leave-request-start" className="text-sm font-medium">
              {t('request.startDateLabel')}
            </label>
            <Input
              id="leave-request-start"
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="leave-request-end" className="text-sm font-medium">
              {t('request.endDateLabel')}
            </label>
            <Input
              id="leave-request-end"
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="leave-request-reason" className="text-sm font-medium">
              {t('request.reasonLabel')}
            </label>
            <Input
              id="leave-request-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>

          {validationError && (
            <p role="alert" className="text-sm text-destructive">
              {validationError}
            </p>
          )}
          {createRequest.isError && (
            <p role="alert" className="text-sm text-destructive">
              {serverErrorMessage}
            </p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('actions.cancel', { ns: 'common' })}
              </Button>
            </DialogClose>
            <Button type="submit" loading={createRequest.isPending}>
              {createRequest.isPending ? t('request.submitting') : t('request.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

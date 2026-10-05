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
  DatePicker,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@biddaloy/ui/components';
import { useCreateLeaveRequest } from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { parseDate, toIsoDate } from '@biddaloy/ui/utils';
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
  const regionConfig = useTenantRegionConfig();
  const createRequest = useCreateLeaveRequest();

  const [leaveType, setLeaveType] = React.useState<LeaveType>(LeaveType.CASUAL);
  // ISO `YYYY-MM-DD` strings (the API shape); the pickers show formatted dates.
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

  // Never the server's own text: a translated sentence, with the balance case spelled out.
  const serverErrorMessage =
    createRequest.error instanceof ApiError &&
    (createRequest.error.details as { code?: string } | undefined)?.code ===
      'LEAVE_BALANCE_EXCEEDED'
      ? t('request.errorBalance')
      : t('request.errorMessage');

  return (
    <Dialog open={open} onOpenChange={(next) => !createRequest.isPending && onOpenChange(next)}>
      <DialogContent size="md" closeLabel={t('actions.close', { ns: 'common' })}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('request.title')}</DialogTitle>
            <DialogDescription>{t('request.description')}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="leave-request-type">{t('request.typeLabel')}</Label>
            <Select value={leaveType} onValueChange={(value) => setLeaveType(value as LeaveType)}>
              <SelectTrigger id="leave-request-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEAVE_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {t(`type.${type}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="leave-request-start">{t('request.startDateLabel')}</Label>
            <DatePicker
              id="leave-request-start"
              aria-label={t('request.startDateLabel')}
              config={regionConfig}
              value={startDate === '' ? undefined : parseDate(startDate)}
              onValueChange={(next) => setStartDate(next ? toIsoDate(next) : '')}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="leave-request-end">{t('request.endDateLabel')}</Label>
            <DatePicker
              id="leave-request-end"
              aria-label={t('request.endDateLabel')}
              config={regionConfig}
              value={endDate === '' ? undefined : parseDate(endDate)}
              min={startDate === '' ? undefined : parseDate(startDate)}
              onValueChange={(next) => setEndDate(next ? toIsoDate(next) : '')}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="leave-request-reason">{t('request.reasonLabel')}</Label>
            <Textarea
              id="leave-request-reason"
              rows={3}
              placeholder={t('request.reasonPlaceholder')}
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
              <Button type="button" variant="outline" disabled={createRequest.isPending}>
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

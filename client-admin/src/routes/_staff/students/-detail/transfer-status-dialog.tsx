import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@biddaloy/ui/components';
import { type EnrollmentStatus, useUpdateStudentEnrollmentStatus } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

const ENROLLMENT_STATUSES: readonly EnrollmentStatus[] = [
  'ACTIVE',
  'INACTIVE',
  'TRANSFERRED',
  'GRADUATED',
];

export interface TransferStatusDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studentId: string;
  studentName: string;
  currentStatus: EnrollmentStatus;
}

export function TransferStatusDialog({
  open,
  onOpenChange,
  studentId,
  studentName,
  currentStatus,
}: TransferStatusDialogProps) {
  const { t } = useTranslation('students');
  const [status, setStatus] = React.useState<EnrollmentStatus>(currentStatus);
  const updateStatus = useUpdateStudentEnrollmentStatus(studentId);

  React.useEffect(() => {
    if (open) {
      setStatus(currentStatus);
      updateStatus.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [open, currentStatus]);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    updateStatus.mutate(status, { onSuccess: () => onOpenChange(false) });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{t('detail.transferDialog.title')}</DialogTitle>
            <DialogDescription>
              {t('detail.transferDialog.description', { name: studentName })}
            </DialogDescription>
          </DialogHeader>
          <Select value={status} onValueChange={(value) => setStatus(value as EnrollmentStatus)}>
            <SelectTrigger aria-label={t('detail.transferDialog.statusLabel')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ENROLLMENT_STATUSES.map((option) => (
                <SelectItem key={option} value={option}>
                  {t(`detail.transferDialog.status.${option}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {updateStatus.isError && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {t('detail.transferDialog.errorMessage')}
            </p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('actions.cancel', { ns: 'common' })}
              </Button>
            </DialogClose>
            <Button type="submit" loading={updateStatus.isPending}>
              {updateStatus.isPending
                ? t('detail.transferDialog.saving')
                : t('detail.transferDialog.confirm')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

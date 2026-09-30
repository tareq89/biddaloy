/**
 * [28.4.2] The one "Start ACR" form. Rendered from a staff member's ACR tab
 * (`staffUserId` set, picker hidden) and from the evaluations page when the
 * palette opens it via `?startAcr=1` (staff picker shown). On success it
 * opens the new ACR's form.
 */
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@biddaloy/ui/components';
import { useAcademicYears, useStartAcr } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useNavigate } from '@tanstack/react-router';
import * as React from 'react';

import { StaffSelect } from './staff-select';

export interface StartAcrDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  staffUserId?: string;
}

export function StartAcrDialog({ open, onOpenChange, staffUserId }: StartAcrDialogProps) {
  const { t } = useTranslation('evaluations');
  const navigate = useNavigate();
  const start = useStartAcr();
  const years = useAcademicYears().data?.data ?? [];
  const [staff, setStaff] = React.useState(staffUserId ?? '');
  const [year, setYear] = React.useState('');
  const [errors, setErrors] = React.useState<{ staff?: string; year?: string }>({});

  React.useEffect(() => {
    if (!open) return;
    setStaff(staffUserId ?? '');
    setYear('');
    setErrors({});
    start.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on open only
  }, [open]);

  // Default to the current academic year until the admin picks one.
  const yearId = year || years.find((y) => y.is_current)?.id || '';

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const next: { staff?: string; year?: string } = {};
    if (!staff) next.staff = t('acr.errorStaff');
    if (!yearId) next.year = t('acr.errorYear');
    setErrors(next);
    if (next.staff || next.year) return;
    start.mutate(
      { user_id: staff, academic_year_id: yearId },
      {
        onSuccess: (a) => {
          onOpenChange(false);
          void navigate({
            to: '/staff/$userId/acr/$assessmentId',
            params: { userId: a.user_id, assessmentId: a.id },
          });
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('acr.startTitle')}</DialogTitle>
        </DialogHeader>
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Ctrl+Enter bubbles from the focused field; the form itself is not the target */}
        <form
          className="flex flex-col gap-4"
          onSubmit={submit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              e.currentTarget.requestSubmit();
            }
          }}
        >
          {staffUserId === undefined && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="start-acr-staff" className="text-sm font-medium">
                {t('acr.staffLabel')}
              </label>
              <StaffSelect
                id="start-acr-staff"
                value={staff}
                onValueChange={setStaff}
                {...(errors.staff ? { describedBy: 'start-acr-staff-error' } : {})}
              />
              {errors.staff && (
                <p id="start-acr-staff-error" role="alert" className="text-sm text-destructive">
                  {errors.staff}
                </p>
              )}
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="start-acr-year" className="text-sm font-medium">
              {t('acr.yearLabel')}
            </label>
            <Select value={yearId} onValueChange={setYear}>
              <SelectTrigger
                id="start-acr-year"
                {...(errors.year
                  ? { 'aria-invalid': true as const, 'aria-describedby': 'start-acr-year-error' }
                  : {})}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {years.map((y) => (
                  <SelectItem key={y.id} value={y.id}>
                    {y.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.year && (
              <p id="start-acr-year-error" role="alert" className="text-sm text-destructive">
                {errors.year}
              </p>
            )}
          </div>
          {start.isError && (
            <p role="alert" className="text-sm text-destructive">
              {start.error instanceof ApiError && start.error.statusCode === 409
                ? t('acr.startConflict')
                : t('acr.startError')}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('actions.cancel', { ns: 'common' })}
            </Button>
            <Button type="submit" loading={start.isPending}>
              {start.isPending ? t('acr.starting') : t('acr.start')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

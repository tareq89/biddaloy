/**
 * [17.5.3] Clone dialog, opened from the calendar toolbar. Picks a source
 * and target academic year, submits `POST /calendar/clone`, and hands the
 * returned staging preview to the caller — the caller navigates to
 * `/calendar/import` with it, so the clone reuses the exact same
 * preview/commit UI a manual upload goes through (nothing writes until
 * that screen's "Commit import" step).
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
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@biddaloy/ui/components';
import type { AcademicYear } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export interface CloneDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  academicYears: AcademicYear[];
  isPending: boolean;
  error?: unknown;
  onSubmit: (input: { sourceYearId: string; targetYearId: string }) => void;
}

export function CloneDialog({
  open,
  onOpenChange,
  academicYears,
  isPending,
  error,
  onSubmit,
}: CloneDialogProps) {
  const { t } = useTranslation('calendarImport');
  const [sourceYearId, setSourceYearId] = React.useState<string | undefined>(undefined);
  const [targetYearId, setTargetYearId] = React.useState<string | undefined>(undefined);
  // `include_holidays` isn't wired to the request — `CloneCalendarDto`
  // has no such field (server-side decision: cloning always skips
  // HOLIDAY events). Rendered as a disabled, permanently-unchecked control
  // so the UI states the actual behaviour rather than promising a toggle
  // the API can't honour.

  React.useEffect(() => {
    if (!open) {
      setSourceYearId(undefined);
      setTargetYearId(undefined);
    }
  }, [open]);

  const canSubmit = Boolean(sourceYearId && targetYearId && sourceYearId !== targetYearId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('clone.title')}</DialogTitle>
          <DialogDescription>{t('clone.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="clone-source-year">{t('clone.sourceYear')}</Label>
            <Select
              {...(sourceYearId ? { value: sourceYearId } : {})}
              onValueChange={setSourceYearId}
            >
              <SelectTrigger id="clone-source-year">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {academicYears.map((year) => (
                  <SelectItem key={year.id} value={year.id}>
                    {year.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="clone-target-year">{t('clone.targetYear')}</Label>
            <Select
              {...(targetYearId ? { value: targetYearId } : {})}
              onValueChange={setTargetYearId}
            >
              <SelectTrigger id="clone-target-year">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {academicYears.map((year) => (
                  <SelectItem key={year.id} value={year.id}>
                    {year.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox id="clone-include-holidays" checked={false} disabled />
            <Label htmlFor="clone-include-holidays" className="text-muted-foreground">
              {t('clone.includeHolidays')}
            </Label>
          </div>

          {error !== undefined && (
            <p className="text-sm text-destructive" role="alert">
              {t('clone.cloneFailed')}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('clone.cancel')}
          </Button>
          <Button
            type="button"
            disabled={!canSubmit || isPending}
            onClick={() => {
              if (sourceYearId && targetYearId) {
                onSubmit({ sourceYearId, targetYearId });
              }
            }}
          >
            {t('clone.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

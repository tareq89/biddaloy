/**
 * [66.2] D6: ADMIN overrides the owner. `null` means "the routine's teacher".
 */
import {
  Button,
  Combobox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  RadioGroup,
  RadioGroupItem,
} from '@biddaloy/ui/components';
import { useTeachers, useUpdateStudyPlan, type StudyPlanDetail } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

import { DialogError } from './action-errors';

export interface ChangeOwnerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: StudyPlanDetail;
}

export function ChangeOwnerDialog({ open, onOpenChange, plan }: ChangeOwnerDialogProps) {
  const { t } = useTranslation('studyPlans');
  const { t: tCommon } = useTranslation('common');
  const update = useUpdateStudyPlan();
  const teachers = useTeachers({ limit: 100 }).data?.data ?? [];

  const [mode, setMode] = React.useState<'routine' | 'specific'>('routine');
  const [teacherId, setTeacherId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setMode(plan.owner_override_teacher_id === null ? 'routine' : 'specific');
    setTeacherId(plan.owner_override_teacher_id);
    update.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open
  }, [open]);

  const names = plan.owners.map((o) => o.full_name).join(', ') || '—';
  const canSave = mode === 'routine' || teacherId !== null;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSave || update.isPending) return;
    update.mutate(
      { id: plan.id, input: { owner_override_teacher_id: mode === 'routine' ? null : teacherId } },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !update.isPending && onOpenChange(next)}>
      <DialogContent size="md" closeLabel={tCommon('actions.close')}>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('owner.title')}</DialogTitle>
          </DialogHeader>
          <p className="text-text-secondary">{t('owner.explain')}</p>

          <RadioGroup
            value={mode}
            onValueChange={(value) => setMode(value as 'routine' | 'specific')}
            aria-label={t('owner.title')}
            disabled={update.isPending}
          >
            <label className="flex items-center gap-2">
              <RadioGroupItem value="routine" />
              {t('owner.routineTeacher', { names })}
            </label>
            <label className="flex items-center gap-2">
              <RadioGroupItem value="specific" />
              {t('owner.specific')}
            </label>
          </RadioGroup>

          {mode === 'specific' && (
            <Combobox
              aria-label={t('owner.specific')}
              options={teachers.map((teacher) => ({
                value: teacher.id,
                label: teacher.user.full_name,
              }))}
              value={teacherId}
              onValueChange={setTeacherId}
              disabled={update.isPending}
            />
          )}

          {update.isError && <DialogError>{tCommon('status.error')}</DialogError>}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={update.isPending}>
                {tCommon('actions.cancel')}
              </Button>
            </DialogClose>
            <Button type="submit" loading={update.isPending} disabled={!canSave}>
              {tCommon('actions.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

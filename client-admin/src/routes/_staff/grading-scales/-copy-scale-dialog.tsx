/**
 * Copy a scale's bands onto a different class or academic year —
 * [20.3.1]. Picks a target (academic year, and optionally a class — no
 * class means "that year's default scale"), shows what will be created,
 * and refuses an occupied target: a scale already exists for that target
 * *and* already has bands.
 *
 * The server (`GradingController.copy`) only refuses when the *target*
 * scale itself already has bands — it never refuses on a missing target,
 * so a target scale that doesn't exist yet is created here first, then
 * copied into.
 */
import { apiClient } from '@biddaloy/ui/api';
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
import {
  gradingScaleKeys,
  useAcademicYears,
  useClasses,
  useCreateGradingScale,
  useGradingScales,
  type GradingBand,
  type GradingScale,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';

const NO_CLASS_VALUE = '__year_default__';

export interface CopyScaleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceScale: GradingScale;
  onCopied: () => void;
}

export function CopyScaleDialog({
  open,
  onOpenChange,
  sourceScale,
  onCopied,
}: CopyScaleDialogProps) {
  const { t } = useTranslation('grading');
  const academicYearsQuery = useAcademicYears();
  const classesQuery = useClasses();
  const scalesQuery = useGradingScales();

  const [academicYearId, setAcademicYearId] = React.useState('');
  const [classId, setClassId] = React.useState(NO_CLASS_VALUE);
  const [occupiedError, setOccupiedError] = React.useState(false);
  const createScale = useCreateGradingScale();

  React.useEffect(() => {
    if (!open) return;
    setAcademicYearId(sourceScale.academic_year_id);
    setClassId(sourceScale.class_id ?? NO_CLASS_VALUE);
    setOccupiedError(false);
  }, [open, sourceScale]);

  const targetScale = scalesQuery.data?.find(
    (scale) =>
      scale.academic_year_id === academicYearId &&
      (scale.class_id ?? NO_CLASS_VALUE) === classId &&
      scale.id !== sourceScale.id,
  );

  const queryClient = useQueryClient();
  // The target scale's id isn't known until it's (possibly) created
  // below, so this can't use the shared `useCopyGradingScale(id)` hook
  // (bound to a fixed id at render time) — a plain mutation, with the
  // target id passed in `mutate()`'s variables instead, same endpoint.
  const copyScale = useMutation({
    mutationFn: async ({ targetId }: { targetId: string }) => {
      const res = await apiClient.post<GradingBand[]>(`/grading/scales/${targetId}/copy`, {
        source_scale_id: sourceScale.id,
      });
      return res.data;
    },
    onSuccess: (_data, { targetId }) => {
      void queryClient.invalidateQueries({ queryKey: gradingScaleKeys.detail(targetId) });
      void queryClient.invalidateQueries({ queryKey: gradingScaleKeys.lists() });
    },
  });

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setOccupiedError(false);

    if (targetScale && targetScale.bands.length > 0) {
      setOccupiedError(true);
      return;
    }

    const targetId =
      targetScale?.id ??
      (
        await createScale.mutateAsync({
          academic_year_id: academicYearId,
          class_id: classId === NO_CLASS_VALUE ? null : classId,
          name: sourceScale.name,
        })
      ).id;

    copyScale.mutate({ targetId }, { onSuccess: onCopied });
  }

  const isPending = createScale.isPending || copyScale.isPending;
  const isError = createScale.isError || copyScale.isError;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('copyDialog.title')}</DialogTitle>
            <DialogDescription>
              {t('copyDialog.description', { name: sourceScale.name })}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('copyDialog.academicYearLabel')}</span>
            <Select value={academicYearId} onValueChange={setAcademicYearId}>
              <SelectTrigger aria-label={t('copyDialog.academicYearLabel')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {academicYearsQuery.data?.data.map((year) => (
                  <SelectItem key={year.id} value={year.id}>
                    {year.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('copyDialog.classLabel')}</span>
            <Select value={classId} onValueChange={setClassId}>
              <SelectTrigger aria-label={t('copyDialog.classLabel')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CLASS_VALUE}>{t('copyDialog.yearDefault')}</SelectItem>
                {classesQuery.data?.data.map((klass) => (
                  <SelectItem key={klass.id} value={klass.id}>
                    {klass.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <p className="text-sm text-muted-foreground">
            {t('copyDialog.willCreate', { count: sourceScale.bands.length })}
          </p>

          {occupiedError && (
            <p role="alert" className="text-sm text-destructive">
              {t('copyDialog.occupiedError')}
            </p>
          )}
          {isError && (
            <p role="alert" className="text-sm text-destructive">
              {t('copyDialog.errorMessage')}
            </p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('actions.cancel', { ns: 'common' })}
              </Button>
            </DialogClose>
            <Button type="submit" loading={isPending}>
              {isPending ? t('copyDialog.copying') : t('copyDialog.copy')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

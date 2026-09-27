/**
 * Create/edit a program — [34.4.1]. Clone of `-copy-scale-dialog.tsx`'s
 * dialog-around-a-form shape. Edit mode adds Archive/Unarchive and Delete
 * (D23): delete is disabled with the server's own 409 message once the
 * program has any enrolments — archiving is the alternative offered
 * instead of trying (and failing) the delete.
 */
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  Checkbox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Textarea,
} from '@biddaloy/ui/components';
import {
  useCreateProgram,
  useDeleteProgram,
  useUpdateProgram,
  type Program,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export interface ProgramFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  program?: Program;
  onSaved: () => void;
}

export function ProgramFormDialog({
  open,
  onOpenChange,
  mode,
  program,
  onSaved,
}: ProgramFormDialogProps) {
  const { t } = useTranslation('programs');
  const { t: tCommon } = useTranslation('common');
  const createProgram = useCreateProgram();
  const updateProgram = useUpdateProgram(program?.id ?? '');
  const deleteProgram = useDeleteProgram();

  const [name, setName] = React.useState(program?.name ?? '');
  const [description, setDescription] = React.useState(program?.description ?? '');
  const [showOnReportCard, setShowOnReportCard] = React.useState(
    program?.show_on_report_card ?? false,
  );
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setName(program?.name ?? '');
    setDescription(program?.description ?? '');
    setShowOnReportCard(program?.show_on_report_card ?? false);
    setConfirmDelete(false);
  }, [open, program]);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    const values = {
      name: name.trim(),
      description: description.trim() ? description.trim() : null,
      show_on_report_card: showOnReportCard,
    };
    if (mode === 'edit' && program) {
      updateProgram.mutate(values, { onSuccess: onSaved });
    } else {
      createProgram.mutate(values, { onSuccess: onSaved });
    }
  }

  function toggleActive() {
    if (!program) return;
    updateProgram.mutate({ is_active: !program.is_active }, { onSuccess: onSaved });
  }

  function handleDelete() {
    if (!program) return;
    deleteProgram.mutate(program.id, { onSuccess: onSaved });
  }

  const isPending = createProgram.isPending || updateProgram.isPending;
  const isError = createProgram.isError || updateProgram.isError;
  const deleteConflict =
    deleteProgram.isError &&
    deleteProgram.error instanceof ApiError &&
    deleteProgram.error.statusCode === 409;
  const hasEnrolments = (program?.active_enrollment_count ?? 0) > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>
              {mode === 'edit' ? t('formDialog.editTitle') : t('formDialog.createTitle')}
            </DialogTitle>
            <DialogDescription>{t('formDialog.description')}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="program-name" className="text-sm font-medium">
              {t('formDialog.nameLabel')}
            </label>
            <Input id="program-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="program-description" className="text-sm font-medium">
              {t('formDialog.descriptionLabel')}
            </label>
            <Textarea
              id="program-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <label className="flex items-center gap-2 text-sm font-medium">
            <Checkbox
              checked={showOnReportCard}
              onCheckedChange={(checked) => setShowOnReportCard(checked === true)}
            />
            {t('formDialog.showOnReportCard')}
          </label>

          {isError && (
            <p role="alert" className="text-sm text-destructive">
              {t('formDialog.errorMessage')}
            </p>
          )}

          {mode === 'edit' && program && (
            <div className="flex flex-col gap-2 border-t border-border pt-3">
              <Button
                type="button"
                variant="outline"
                onClick={toggleActive}
                loading={updateProgram.isPending}
              >
                {program.is_active ? t('formDialog.archive') : t('formDialog.unarchive')}
              </Button>

              {!confirmDelete && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={hasEnrolments}
                  onClick={() => setConfirmDelete(true)}
                >
                  {t('formDialog.delete')}
                </Button>
              )}
              {hasEnrolments && (
                <p className="text-xs text-muted-foreground">
                  {t('formDialog.deleteDisabledHint')}
                </p>
              )}
              {confirmDelete && (
                <div className="flex flex-col gap-2">
                  <p className="text-sm">{t('formDialog.deleteConfirm')}</p>
                  {deleteConflict && (
                    <p role="alert" className="text-sm text-destructive">
                      {t('formDialog.deleteConflict')}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={handleDelete}
                      loading={deleteProgram.isPending}
                    >
                      {t('formDialog.deleteConfirmButton')}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setConfirmDelete(false)}>
                      {tCommon('actions.cancel')}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {tCommon('actions.cancel')}
              </Button>
            </DialogClose>
            <Button type="submit" loading={isPending}>
              {isPending ? t('formDialog.saving') : t('formDialog.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

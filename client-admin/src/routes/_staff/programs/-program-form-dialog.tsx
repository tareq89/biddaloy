/**
 * Create/edit a program — [34.4.1]. Clone of `-copy-scale-dialog.tsx`'s
 * dialog-around-a-form shape. Archive / Delete live in the detail page's
 * header More menu (31.4.programs-2a), not here.
 */
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
import { useCreateProgram, useUpdateProgram, type Program } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

import { LabelledField } from './-labelled-field';

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

  const [name, setName] = React.useState(program?.name ?? '');
  const [description, setDescription] = React.useState(program?.description ?? '');
  const [showOnReportCard, setShowOnReportCard] = React.useState(
    program?.show_on_report_card ?? false,
  );

  React.useEffect(() => {
    if (!open) return;
    setName(program?.name ?? '');
    setDescription(program?.description ?? '');
    setShowOnReportCard(program?.show_on_report_card ?? false);
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

  const isPending = createProgram.isPending || updateProgram.isPending;
  const isError = createProgram.isError || updateProgram.isError;

  return (
    <Dialog open={open} onOpenChange={(o) => !isPending && onOpenChange(o)}>
      <DialogContent size="sm">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>
              {mode === 'edit' ? t('formDialog.editTitle') : t('formDialog.createTitle')}
            </DialogTitle>
            <DialogDescription>{t('formDialog.description')}</DialogDescription>
          </DialogHeader>

          <LabelledField id="program-name" label={t('formDialog.nameLabel')} required>
            <Input
              id="program-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </LabelledField>

          <LabelledField id="program-description" label={t('formDialog.descriptionLabel')}>
            <Textarea
              id="program-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </LabelledField>

          <label className="flex min-h-11 items-center gap-3 md:min-h-8">
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

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={isPending}>
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

/**
 * Create/edit a program — [34.4.1]. Clone of `-copy-scale-dialog.tsx`'s
 * dialog-around-a-form shape. Archive / Delete live in the detail page's
 * header More menu (31.4.programs-2a), not here.
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
import { useCreateProgram, useUpdateProgram, type Program } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { parseValidationFieldErrors } from '@biddaloy/ui/utils';
import * as React from 'react';

import { LabelledField } from './-labelled-field';

/** Mirrors `server/src/modules/programs/dto/programs.dto.ts`. */
export const PROGRAM_NAME_MAX = 200;

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

  const [nameError, setNameError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setNameError(null);
    setName(program?.name ?? '');
    setDescription(program?.description ?? '');
    setShowOnReportCard(program?.show_on_report_card ?? false);
  }, [open, program]);

  // [2622] A sync double-click can fire before `isPending` re-renders; this closes the gap.
  const inFlight = React.useRef(false);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError(t('formDialog.nameRequired'));
      return;
    }
    if (trimmed.length > PROGRAM_NAME_MAX) {
      setNameError(t('formDialog.nameTooLong', { max: PROGRAM_NAME_MAX }));
      return;
    }
    setNameError(null);
    inFlight.current = true;
    const settle = { onSettled: () => (inFlight.current = false), onSuccess: onSaved };
    const values = {
      name: trimmed,
      description: description.trim() ? description.trim() : null,
      show_on_report_card: showOnReportCard,
    };
    if (mode === 'edit' && program) {
      updateProgram.mutate(values, settle);
    } else {
      createProgram.mutate(values, settle);
    }
  }

  const isPending = createProgram.isPending || updateProgram.isPending;
  const isError = createProgram.isError || updateProgram.isError;
  const error = createProgram.error ?? updateProgram.error;
  const isDuplicate = error instanceof ApiError && error.statusCode === 409;
  // A 400 that names `name`: show our own sentence under the field, never the server's English.
  const serverNameInvalid =
    error instanceof ApiError &&
    error.statusCode === 400 &&
    'name' in parseValidationFieldErrors(error.messages, ['name']);
  const nameMessage = nameError ?? (serverNameInvalid ? t('formDialog.nameInvalid') : null);

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
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={nameMessage !== null}
              aria-describedby={nameMessage ? 'program-name-error' : undefined}
            />
            {nameMessage && (
              <p id="program-name-error" role="alert" className="text-sm text-destructive">
                {nameMessage}
              </p>
            )}
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

          {isError && !serverNameInvalid && (
            <p role="alert" className="text-sm text-destructive">
              {isDuplicate ? t('formDialog.duplicateMessage') : t('formDialog.errorMessage')}
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

/**
 * [35.4.5] Create-template dialog (name + kind). Cloned from
 * `-exam-form-dialog.tsx`, minus the year/class fields a template does not
 * have. Owns its own mutation; surfaces server messages (e.g. the 409
 * duplicate-name text) inline.
 */
import { ExamKind } from '@biddaloy/shared';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

import { type ExamTemplateDetail, useCreateExamTemplate } from './use-exam-templates';

export const TEMPLATE_NAME_MAX = 200;
const EXAM_KINDS = Object.values(ExamKind);

export interface TemplateFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (template: ExamTemplateDetail) => void;
}

export function TemplateFormDialog({ open, onOpenChange, onSaved }: TemplateFormDialogProps) {
  const { t } = useTranslation('examTemplates');
  const create = useCreateExamTemplate();
  const [name, setName] = React.useState('');
  const [kind, setKind] = React.useState<ExamKind>(ExamKind.TERM);
  const [validationError, setValidationError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setName('');
    setKind(ExamKind.TERM);
    setValidationError(null);
    create.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [open]);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setValidationError(t('form.errorNameRequired'));
      return;
    }
    if (trimmed.length > TEMPLATE_NAME_MAX) {
      setValidationError(t('form.errorNameTooLong', { max: TEMPLATE_NAME_MAX }));
      return;
    }
    setValidationError(null);
    create.mutate({ name: trimmed, kind }, { onSuccess: onSaved });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('form.title')}</DialogTitle>
            <DialogDescription>{t('form.description')}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="template-form-name" className="text-sm font-medium">
              {t('form.nameLabel')}
            </label>
            <Input
              id="template-form-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('form.namePlaceholder')}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('form.kindLabel')}</span>
            <Select value={kind} onValueChange={(value) => setKind(value as ExamKind)}>
              <SelectTrigger aria-label={t('form.kindLabel')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXAM_KINDS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`kind.${value}`, { ns: 'exams' })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {validationError && (
            <p role="alert" className="text-sm text-destructive">
              {validationError}
            </p>
          )}
          {create.isError && (
            <p role="alert" className="text-sm text-destructive">
              {create.error instanceof Error ? create.error.message : t('form.errorMessage')}
            </p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('actions.cancel', { ns: 'common' })}
              </Button>
            </DialogClose>
            <Button type="submit" loading={create.isPending}>
              {create.isPending ? t('form.saving') : t('form.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

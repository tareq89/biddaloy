/**
 * [35.4.5] Create / edit exam-structure dialog (name + type). Cloned from
 * `-exam-form-dialog.tsx`, minus the year/class fields a structure does not
 * have. Owns its own mutation; a 409 shows a translated duplicate-name line,
 * any other failure the generic one — never the server text.
 */
import { ExamKind } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
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
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { CircleAlert } from 'lucide-react';
import * as React from 'react';

import {
  type ExamTemplateDetail,
  useCreateExamTemplate,
  useUpdateExamTemplate,
} from './-use-exam-templates';

export const TEMPLATE_NAME_MAX = 200;
const EXAM_KINDS = Object.values(ExamKind);

export interface TemplateFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (template: ExamTemplateDetail) => void;
  /** Default `'create'`. Edit mode changes name + type only (`PATCH`). */
  mode?: 'create' | 'edit';
  initial?: { id: string; name: string; kind: ExamKind };
}

// Asterisk drawn by CSS, so the label text stays exactly the field name.
const REQUIRED = "after:ms-0.5 after:text-destructive after:content-['*']";

export function TemplateFormDialog({
  open,
  onOpenChange,
  onSaved,
  mode = 'create',
  initial,
}: TemplateFormDialogProps) {
  const { t } = useTranslation('examTemplates');
  const createMutation = useCreateExamTemplate();
  const updateMutation = useUpdateExamTemplate(initial?.id ?? '');
  const create = mode === 'edit' ? updateMutation : createMutation;
  const [name, setName] = React.useState(initial?.name ?? '');
  const [kind, setKind] = React.useState<ExamKind>(initial?.kind ?? ExamKind.TERM);
  const [validationError, setValidationError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? '');
    setKind(initial?.kind ?? ExamKind.TERM);
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
      <DialogContent size="sm">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{mode === 'edit' ? t('form.editTitle') : t('form.title')}</DialogTitle>
            {mode === 'create' && <DialogDescription>{t('form.description')}</DialogDescription>}
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="template-form-name" className={REQUIRED}>
              {t('form.nameLabel')}
            </Label>
            <Input
              id="template-form-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('form.namePlaceholder')}
              aria-invalid={validationError !== null}
              aria-describedby={validationError ? 'template-form-error' : undefined}
              className={validationError ? 'border-destructive' : undefined}
            />
            {validationError && (
              <p
                id="template-form-error"
                role="alert"
                className="flex items-center gap-1.5 text-sm text-destructive"
              >
                <CircleAlert aria-hidden className="size-4 shrink-0" />
                {validationError}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="template-form-kind">{t('form.kindLabel')}</Label>
            <Select value={kind} onValueChange={(value) => setKind(value as ExamKind)}>
              <SelectTrigger id="template-form-kind" className="w-full">
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

          {create.isError && (
            <p role="alert" className="text-sm text-destructive">
              {create.error instanceof ApiError && create.error.statusCode === 409
                ? t('form.errorDuplicate')
                : t('form.errorMessage')}
            </p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('actions.cancel', { ns: 'common' })}
              </Button>
            </DialogClose>
            <Button type="submit" loading={create.isPending}>
              {mode === 'edit'
                ? t('form.saveEdit')
                : create.isPending
                  ? t('form.saving')
                  : t('form.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

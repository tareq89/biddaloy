/**
 * [22.4.3] Create/edit dialog for one syllabus topic — same weight class
 * as `academic-years/-year-form-dialog.tsx` (a handful of fields, local
 * `useState`, no FormShell). `sequence` isn't a field here: create appends
 * to the end of the current list (caller passes the next sequence), and
 * edit never changes it — reordering is the list page's up/down buttons,
 * which call the bulk `reorder` endpoint directly.
 */
import { SyllabusTopicStatus } from '@biddaloy/shared';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export interface SyllabusTopicFormPayload {
  name: string;
  description?: string;
  status: SyllabusTopicStatus;
}

export interface SyllabusTopicFormInitialValues {
  name: string;
  description: string | null;
  status: SyllabusTopicStatus;
}

export interface SyllabusTopicFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  initialValues?: SyllabusTopicFormInitialValues;
  isPending: boolean;
  isError: boolean;
  onSubmit: (payload: SyllabusTopicFormPayload) => void;
}

const EMPTY_VALUES: SyllabusTopicFormInitialValues = {
  name: '',
  description: null,
  status: SyllabusTopicStatus.PLANNED,
};

export function SyllabusTopicFormDialog({
  open,
  onOpenChange,
  mode,
  initialValues,
  isPending,
  isError,
  onSubmit,
}: SyllabusTopicFormDialogProps) {
  const { t } = useTranslation('syllabus');

  const [name, setName] = React.useState(initialValues?.name ?? '');
  const [description, setDescription] = React.useState(initialValues?.description ?? '');
  const [status, setStatus] = React.useState<SyllabusTopicStatus>(
    initialValues?.status ?? SyllabusTopicStatus.PLANNED,
  );
  const [validationError, setValidationError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const values = initialValues ?? EMPTY_VALUES;
    setName(values.name);
    setDescription(values.description ?? '');
    setStatus(values.status);
    setValidationError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [open]);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (name.trim() === '') {
      setValidationError(t('form.errorRequired'));
      return;
    }

    setValidationError(null);
    onSubmit({
      name: name.trim(),
      ...(description.trim() !== '' ? { description: description.trim() } : {}),
      status,
    });
  }

  const title = mode === 'create' ? t('form.addTitle') : t('form.editTitle');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="syllabus-topic-name" className="text-sm font-medium">
              {t('form.nameLabel')}
            </label>
            <Input
              id="syllabus-topic-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="syllabus-topic-description" className="text-sm font-medium">
              {t('form.descriptionLabel')}
            </label>
            <Textarea
              id="syllabus-topic-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('form.statusLabel')}</span>
            <Select
              value={status}
              onValueChange={(value) => setStatus(value as SyllabusTopicStatus)}
            >
              <SelectTrigger aria-label={t('form.statusLabel')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.values(SyllabusTopicStatus).map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`status.syllabusTopic.${value}`, { ns: 'common' })}
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
          {isError && (
            <p role="alert" className="text-sm text-destructive">
              {t('form.genericError')}
            </p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('form.cancel')}
              </Button>
            </DialogClose>
            <Button type="submit" loading={isPending}>
              {isPending ? t('form.submitting') : t('form.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

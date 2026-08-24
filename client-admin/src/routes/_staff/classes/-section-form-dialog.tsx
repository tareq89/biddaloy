/**
 * Create/edit section dialog — [8.11.2]. Two fields (name, capacity), so
 * this owns its own mutation directly (`useCreateSection`/
 * `useUpdateSection`) rather than splitting submit-vs-mutation across a
 * caller like `-year-form-dialog.tsx` does — that split exists there
 * because `SetCurrentDialog` needs to intercept the same payload's
 * `is_current` flip; there's no equivalent cross-dialog choreography
 * here, so the simpler self-contained shape wins.
 */
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
} from '@biddaloy/ui/components';
import { useCreateSection, useUpdateSection } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export interface SectionFormInitialValues {
  sectionName: string;
  capacity: number | undefined;
}

export interface SectionFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  classId: string;
  /** Required in edit mode — which section `useUpdateSection` targets. */
  sectionId?: string;
  initialValues?: SectionFormInitialValues;
  onSaved: () => void;
}

const EMPTY_VALUES: SectionFormInitialValues = { sectionName: '', capacity: undefined };

export function SectionFormDialog({
  open,
  onOpenChange,
  mode,
  classId,
  sectionId,
  initialValues,
  onSaved,
}: SectionFormDialogProps) {
  const { t } = useTranslation('classes');
  const createSection = useCreateSection(classId);
  const updateSection = useUpdateSection(classId, sectionId ?? '');
  const mutation = mode === 'create' ? createSection : updateSection;

  const [sectionName, setSectionName] = React.useState(initialValues?.sectionName ?? '');
  const [capacity, setCapacity] = React.useState(
    initialValues?.capacity !== undefined ? String(initialValues.capacity) : '',
  );
  const [validationError, setValidationError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const values = initialValues ?? EMPTY_VALUES;
    setSectionName(values.sectionName);
    setCapacity(values.capacity !== undefined ? String(values.capacity) : '');
    setValidationError(null);
    mutation.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [open]);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!sectionName.trim()) {
      setValidationError(t('sectionForm.errorNameRequired'));
      return;
    }
    const parsedCapacity = capacity.trim() === '' ? undefined : Number(capacity);
    if (
      parsedCapacity !== undefined &&
      (!Number.isInteger(parsedCapacity) || parsedCapacity <= 0)
    ) {
      setValidationError(t('sectionForm.errorCapacityInvalid'));
      return;
    }
    setValidationError(null);

    if (mode === 'create') {
      // `exactOptionalPropertyTypes` — see `-class-form-dialog.tsx`'s
      // identical comment on why this is a conditional spread, not an
      // `undefined` assignment. No "clear a previous value" case exists
      // on create.
      createSection.mutate(
        {
          section_name: sectionName.trim(),
          ...(parsedCapacity !== undefined ? { capacity: parsedCapacity } : {}),
        },
        { onSuccess: onSaved },
      );
    } else {
      // Always sent, as `parsedCapacity ?? null` — see
      // `-class-form-dialog.tsx`'s identical comment on why omitting the
      // key on clear would silently leave the old value in place.
      // `UpdateSectionDto.capacity?: number | null` accepts the explicit
      // `null`.
      updateSection.mutate(
        { section_name: sectionName.trim(), capacity: parsedCapacity ?? null },
        { onSuccess: onSaved },
      );
    }
  }

  const title = mode === 'create' ? t('sectionForm.createTitle') : t('sectionForm.editTitle');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{t('sectionForm.description')}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="section-form-name" className="text-sm font-medium">
              {t('sectionForm.nameLabel')}
            </label>
            <Input
              id="section-form-name"
              value={sectionName}
              onChange={(event) => setSectionName(event.target.value)}
              placeholder={t('sectionForm.namePlaceholder')}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="section-form-capacity" className="text-sm font-medium">
              {t('sectionForm.capacityLabel')}
            </label>
            <Input
              id="section-form-capacity"
              type="number"
              value={capacity}
              onChange={(event) => setCapacity(event.target.value)}
              placeholder={t('sectionForm.capacityPlaceholder')}
            />
          </div>

          {validationError && (
            <p role="alert" className="text-sm text-destructive">
              {validationError}
            </p>
          )}
          {mutation.isError && (
            <p role="alert" className="text-sm text-destructive">
              {mutation.error instanceof Error
                ? mutation.error.message
                : t('sectionForm.errorMessage')}
            </p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('actions.cancel', { ns: 'common' })}
              </Button>
            </DialogClose>
            <Button type="submit" loading={mutation.isPending}>
              {mutation.isPending ? t('sectionForm.saving') : t('sectionForm.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

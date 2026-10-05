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
import { useCreateSection, useOrganisationVocabulary, useUpdateSection } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { toLatinDigits } from '@biddaloy/ui/utils';
import * as React from 'react';

import { ErrorText, Field, useCloseGuard } from './-dialog-kit';

export interface SectionFormInitialValues {
  sectionName: string;
  capacity: number | undefined;
  /** [33.4.1] `undefined` on create, `null` means "not set" on edit —
   * same three-state shape `-class-form-dialog.tsx`'s `shift`/`version`
   * use. */
  groupName?: string | null;
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

/** Radix `Select.Item` rejects an empty-string `value` — same sentinel
 * `-class-form-dialog.tsx`'s `NONE_VALUE` uses, including the leading
 * space (see that file's comment: the organisation vocabulary's own
 * validator rejects any entry where `entry.trim() !== entry`, which is
 * what makes this sentinel structurally impossible to collide with a
 * real group name). Don't "clean up" the leading space. */
const NONE_VALUE = ' __none__';

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
  const vocabularyQuery = useOrganisationVocabulary();
  const createSection = useCreateSection(classId);
  const updateSection = useUpdateSection(classId, sectionId ?? '');
  const mutation = mode === 'create' ? createSection : updateSection;

  const initial = initialValues ?? EMPTY_VALUES;
  const initialCapacity = initial.capacity !== undefined ? String(initial.capacity) : '';
  const initialGroup = initial.groupName ?? NONE_VALUE;
  // Callers mount this dialog only while it is open (fresh state each open).
  const [sectionName, setSectionName] = React.useState(initial.sectionName);
  const [capacity, setCapacity] = React.useState(initialCapacity);
  const [groupName, setGroupName] = React.useState(initialGroup);
  const [validationError, setValidationError] = React.useState<string | null>(null);
  const isDirty =
    sectionName !== initial.sectionName ||
    capacity !== initialCapacity ||
    groupName !== initialGroup;
  const { requestClose, discardDialog } = useCloseGuard(isDirty, mutation.isPending, onOpenChange);

  // [D5] Only rendered once the tenant has 2+ groups configured.
  const groups = vocabularyQuery.data?.groups ?? [];
  const showGroup = groups.length >= 2;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (mutation.isPending) return;

    if (!sectionName.trim()) {
      setValidationError(t('sectionForm.errorNameRequired'));
      return;
    }
    const parsedCapacity =
      capacity.trim() === '' ? undefined : Number(toLatinDigits(capacity.trim()));
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
          ...(showGroup && groupName !== NONE_VALUE ? { group_name: groupName } : {}),
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
        {
          section_name: sectionName.trim(),
          capacity: parsedCapacity ?? null,
          ...(showGroup ? { group_name: groupName === NONE_VALUE ? null : groupName } : {}),
        },
        { onSuccess: onSaved },
      );
    }
  }

  const title = mode === 'create' ? t('sectionForm.createTitle') : t('sectionForm.editTitle');

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : requestClose())}>
        <DialogContent size="md" onInteractOutside={(e) => e.preventDefault()}>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>{t('sectionForm.description')}</DialogDescription>
            </DialogHeader>

            <Field id="section-form-name" label={t('sectionForm.nameLabel')} required>
              <Input
                id="section-form-name"
                value={sectionName}
                onChange={(event) => setSectionName(event.target.value)}
                placeholder={t('sectionForm.namePlaceholder')}
              />
            </Field>

            <Field id="section-form-capacity" label={t('sectionForm.capacityLabel')}>
              <Input
                id="section-form-capacity"
                inputMode="numeric"
                value={capacity}
                onChange={(event) => setCapacity(event.target.value)}
                placeholder={t('sectionForm.capacityPlaceholder')}
              />
            </Field>

            {showGroup && (
              <Field id="section-form-group" label={t('sectionForm.groupLabel')}>
                <Select value={groupName} onValueChange={setGroupName}>
                  <SelectTrigger id="section-form-group">
                    <SelectValue placeholder={t('sectionForm.groupPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>{t('classForm.noneOption')}</SelectItem>
                    {groups.map((value) => (
                      <SelectItem key={value} value={value}>
                        {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}

            {validationError && <ErrorText>{validationError}</ErrorText>}
            {mutation.isError && <ErrorText>{t('sectionForm.errorMessage')}</ErrorText>}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={mutation.isPending}
                onClick={requestClose}
              >
                {t('actions.cancel', { ns: 'common' })}
              </Button>
              <Button type="submit" loading={mutation.isPending}>
                {mutation.isPending ? t('sectionForm.saving') : t('sectionForm.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {discardDialog}
    </>
  );
}

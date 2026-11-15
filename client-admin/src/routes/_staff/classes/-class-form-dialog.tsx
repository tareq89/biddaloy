/**
 * Create/edit class dialog — [8.11.2]. Same "owns its own mutation"
 * shape as `-section-form-dialog.tsx` (see that file's header comment for
 * why, versus `academic-years/-year-form-dialog.tsx`'s caller-owns-
 * mutation split).
 *
 * Academic year is only editable at create time — `UpdateClassDto`
 * (`classes.dto.ts`) has no `academic_year_id` field, so an existing
 * class can't be moved to a different year through this form.
 */
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@biddaloy/ui/components';
import {
  useAcademicYears,
  useCreateClass,
  useOrganisationVocabulary,
  useUpdateClass,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { toLatinDigits } from '@biddaloy/ui/utils';
import * as React from 'react';
import { useForm } from 'react-hook-form';

import { ErrorText, Field, useCloseGuard } from './-dialog-kit';

export interface ClassFormInitialValues {
  name: string;
  numericGrade: number | undefined;
  /** [33.4.1] `undefined` on create (no previous value); on edit, `null`
   * means "not set" — same three-state shape `UpdateClassDto.shift`/
   * `.version` accept. */
  shift?: string | null;
  version?: string | null;
}

export interface ClassFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  /** Required in edit mode — which class `useUpdateClass` targets. */
  classId?: string;
  initialValues?: ClassFormInitialValues;
  /** Create-mode only — which academic year the dialog's Select starts
   * on. Callers pass the list page's own current filter, so "Add class"
   * from an already-filtered list attaches to that year by default
   * instead of forcing a re-pick. */
  defaultAcademicYearId?: string;
  onSaved: () => void;
}

const EMPTY_VALUES: ClassFormInitialValues = { name: '', numericGrade: undefined };

/** Radix `Select.Item` rejects an empty-string `value` — same sentinel
 * convention `classes/index.tsx`'s `ALL_VALUE` uses, for "no shift/version
 * chosen" rather than "all".
 *
 * [CodeRabbit, PR #916] Leading space, not a plain `'__none__'` — the
 * organisation vocabulary (`UniqueLabelListConstraint`,
 * `server/src/modules/schools/settings/unique-labels.validator.ts`)
 * accepts any trimmed, non-empty, ≤50-char string, so an admin really
 * could name a shift `__none__`, which would then be indistinguishable
 * from "no shift chosen" in this Select. A leading space makes the
 * sentinel structurally impossible for a real vocabulary entry to equal
 * — the validator rejects `entry.trim() !== entry` outright — so the
 * collision is ruled out by construction, not by convention. Don't
 * "clean up" this leading space; it's load-bearing. */
const NONE_VALUE = ' __none__';

export function ClassFormDialog({
  open,
  onOpenChange,
  mode,
  classId,
  initialValues,
  defaultAcademicYearId,
  onSaved,
}: ClassFormDialogProps) {
  const { t } = useTranslation('classes');
  const academicYearsQuery = useAcademicYears();
  const vocabularyQuery = useOrganisationVocabulary();
  const createClass = useCreateClass();
  const updateClass = useUpdateClass(classId ?? '');
  const mutation = mode === 'create' ? createClass : updateClass;

  // Snapshot once: a background refetch changing the props must not read as an edit.
  const [initial] = React.useState(() => initialValues ?? EMPTY_VALUES);
  const [initialYear] = React.useState(() => defaultAcademicYearId ?? '');
  const initialGrade = initial.numericGrade !== undefined ? String(initial.numericGrade) : '';
  const initialShift = initial.shift ?? NONE_VALUE;
  const initialVersion = initial.version ?? NONE_VALUE;
  // Callers mount this dialog only while it is open, so state starts fresh
  // on every open (no reset effect needed).
  // The three validated fields go through react-hook-form; shift/version stay plain state.
  const form = useForm<{ name: string; numericGrade: string; academicYearId: string }>({
    defaultValues: { name: initial.name, numericGrade: initialGrade, academicYearId: initialYear },
  });
  const { name, numericGrade, academicYearId } = form.watch();
  const [shift, setShift] = React.useState(initialShift);
  const [version, setVersion] = React.useState(initialVersion);

  const isDirty =
    name !== initial.name ||
    numericGrade !== initialGrade ||
    academicYearId !== initialYear ||
    shift !== initialShift ||
    version !== initialVersion;

  const { requestClose, discardDialog } = useCloseGuard(isDirty, mutation.isPending, onOpenChange);

  // [D5] Each select only renders once its vocabulary has 2+ entries — a
  // single-shift school sees nothing new, same rule the list filters use.
  const shifts = vocabularyQuery.data?.shifts ?? [];
  const versions = vocabularyQuery.data?.versions ?? [];
  const showShift = shifts.length >= 2;
  const showVersion = versions.length >= 2;

  function handleValid() {
    if (mutation.isPending) return;
    const parsedGrade =
      numericGrade.trim() === '' ? undefined : Number(toLatinDigits(numericGrade.trim()));

    if (mode === 'create') {
      // `exactOptionalPropertyTypes` — `CreateClassDto.numeric_grade?:
      // number` means "may be omitted", not "may be `undefined`";
      // conditionally spreading it in rather than assigning `undefined`
      // directly is what satisfies that (same pattern as
      // `toStudentListFilters` elsewhere in this app). There is no
      // "clear a previously-set grade" case on create — a new class has
      // no previous value — so omitting is the right shape here, unlike
      // update below.
      createClass.mutate(
        {
          name: name.trim(),
          ...(parsedGrade !== undefined ? { numeric_grade: parsedGrade } : {}),
          academic_year_id: academicYearId,
          // Omitted (not `null`) on create, same reasoning as
          // `numeric_grade` above — there is no previous value to clear.
          ...(showShift && shift !== NONE_VALUE ? { shift } : {}),
          ...(showVersion && version !== NONE_VALUE ? { version } : {}),
        },
        { onSuccess: onSaved },
      );
    } else {
      // Always sent, as `parsedGrade ?? null` — never conditionally
      // omitted. Omitting the key when the field was cleared (the create
      // branch's shape) would leave the class's existing `numeric_grade`
      // untouched server-side (`ClassService.update` passes the DTO
      // straight into `repo.update()`, which only touches keys actually
      // present), so a user clearing Grade and saving would see "saved"
      // while the old value silently survived. `UpdateClassDto.
      // numeric_grade?: number | null` accepts the explicit `null`.
      updateClass.mutate(
        {
          name: name.trim(),
          numeric_grade: parsedGrade ?? null,
          // Always sent when the select is shown, same "explicit null
          // clears it" reasoning as `numeric_grade` — omitting it would
          // leave a previously-set shift/version untouched server-side.
          ...(showShift ? { shift: shift === NONE_VALUE ? null : shift } : {}),
          ...(showVersion ? { version: version === NONE_VALUE ? null : version } : {}),
        },
        { onSuccess: onSaved },
      );
    }
  }

  const title = mode === 'create' ? t('classForm.createTitle') : t('classForm.editTitle');

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : requestClose())}>
        <DialogContent size="md" onInteractOutside={(e) => e.preventDefault()}>
          <Form {...form}>
            <form
              onSubmit={(event) =>
                void form.handleSubmit(handleValid, () => {
                  const [first] = Object.keys(form.formState.errors);
                  if (first) form.setFocus(first as 'name');
                })(event)
              }
              className="flex flex-col gap-4"
            >
              <DialogHeader>
                <DialogTitle>{title}</DialogTitle>
                <DialogDescription>{t('classForm.description')}</DialogDescription>
              </DialogHeader>

              <FormField
                control={form.control}
                name="name"
                rules={{ validate: (v) => v.trim() !== '' || t('classForm.errorNameRequired') }}
                render={({ field }) => (
                  <FormItem>
                    <Field id="class-form-name" label={t('classForm.nameLabel')} required>
                      <FormControl>
                        <Input
                          id="class-form-name"
                          placeholder={t('classForm.namePlaceholder')}
                          {...field}
                        />
                      </FormControl>
                    </Field>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="numericGrade"
                rules={{
                  validate: (v) => {
                    if (v.trim() === '') return true;
                    const n = Number(toLatinDigits(v.trim()));
                    return (Number.isInteger(n) && n > 0) || t('classForm.errorGradeInvalid');
                  },
                }}
                render={({ field }) => (
                  <FormItem>
                    <Field
                      id="class-form-grade"
                      label={t('classForm.gradeLabel')}
                      helpId="academics.classes.field.grade"
                    >
                      <FormControl>
                        <Input
                          id="class-form-grade"
                          inputMode="numeric"
                          placeholder={t('classForm.gradePlaceholder')}
                          {...field}
                        />
                      </FormControl>
                    </Field>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {mode === 'create' && (
                <FormField
                  control={form.control}
                  name="academicYearId"
                  rules={{ required: t('classForm.errorAcademicYearRequired') }}
                  render={({ field }) => (
                    <FormItem>
                      <Field id="class-form-year" label={t('classForm.academicYearLabel')} required>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger id="class-form-year">
                              <SelectValue placeholder={t('classForm.academicYearPlaceholder')} />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {academicYearsQuery.data?.data.map((year) => (
                              <SelectItem key={year.id} value={year.id}>
                                {year.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {showShift && (
                <Field
                  id="class-form-shift"
                  label={t('classForm.shiftLabel')}
                  helpId="academics.classes.field.shift"
                >
                  <Select value={shift} onValueChange={setShift}>
                    <SelectTrigger id="class-form-shift">
                      <SelectValue placeholder={t('classForm.shiftPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE_VALUE}>{t('classForm.noneOption')}</SelectItem>
                      {shifts.map((value) => (
                        <SelectItem key={value} value={value}>
                          {value}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}

              {showVersion && (
                <Field
                  id="class-form-version"
                  label={t('classForm.versionLabel')}
                  helpId="academics.classes.field.version"
                >
                  <Select value={version} onValueChange={setVersion}>
                    <SelectTrigger id="class-form-version">
                      <SelectValue placeholder={t('classForm.versionPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE_VALUE}>{t('classForm.noneOption')}</SelectItem>
                      {versions.map((value) => (
                        <SelectItem key={value} value={value}>
                          {value}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}

              {mutation.isError && <ErrorText>{t('classForm.errorMessage')}</ErrorText>}

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
                  {mutation.isPending ? t('classForm.saving') : t('classForm.save')}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
      {discardDialog}
    </>
  );
}

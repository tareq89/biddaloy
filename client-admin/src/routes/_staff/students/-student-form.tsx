/**
 * The shared Add/Edit Student form — [8.10.3]. A grouped single form
 * (Identity → Placement → Guardians → Preferences) on `FormShell`, not a
 * wizard, per the issue's own context note: the field count here is low
 * enough that steps would add friction, not remove it.
 *
 * Identical fields/validation for create and edit — the caller supplies
 * `initialValues`/`initialGuardians`, the mutation to run, and how to turn
 * form values into that mutation's input (`buildPayload`). Enrollment
 * status is deliberately not a field here: [8.10.2]'s Transfer/Change
 * Status dialog already owns that change, and duplicating it here would
 * give staff two different places to do the same thing. No student-level
 * email/phone fields either — see `-student-form-schema.ts`'s own header
 * comment on why (`Student` has no such columns; that's `Guardian`'s job).
 */
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  DatePicker,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@biddaloy/ui/components';
import { useClasses, useClassSections, type Guardian, type Student } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import {
  FormSection,
  FormShell,
  applyServerFieldErrors,
  buildFormShellErrors,
  useFormAutosave,
  useFormShellMode,
  useWarnUnsavedChanges,
} from '@biddaloy/ui/shells';
import { parseValidationFieldErrors } from '@biddaloy/ui/utils';
import { zodResolver } from '@hookform/resolvers/zod';
import type { UseMutationResult } from '@tanstack/react-query';
import { useBlocker } from '@tanstack/react-router';
import * as React from 'react';
import { useForm } from 'react-hook-form';

import { MutationErrorMessage } from '../../../components/MutationErrorMessage';

import { GuardianPicker } from './-guardian-picker';
import {
  PREFERRED_COMMUNICATION_VALUES,
  STUDENT_FORM_SERVER_FIELDS,
  buildStudentFormSchema,
  type StudentFormValues,
} from './-student-form-schema';

export interface StudentFormProps<TInput> {
  initialValues: StudentFormValues;
  initialGuardians?: Guardian[];
  autosaveKey: string;
  submitLabel: string;
  // `TError` is `unknown`, not `Error` — every mutation hook here passes
  // `shouldRetryQuery` (`(failureCount, error: unknown) => boolean`) as
  // its `retry` option, which widens the inferred `TError` generic to
  // `unknown` (see that function's own call sites' comments in
  // `students.ts`). `error instanceof ApiError` below still narrows fine
  // regardless of the declared type.
  mutation: UseMutationResult<Student, unknown, TInput>;
  buildPayload: (values: StudentFormValues) => TInput;
  onSuccess: (student: Student) => void;
}

function fieldId(field: string): string {
  return `student-form-${field}`;
}

export function StudentForm<TInput>({
  initialValues,
  initialGuardians = [],
  autosaveKey,
  submitLabel,
  mutation,
  buildPayload,
  onSuccess,
}: StudentFormProps<TInput>) {
  const { t } = useTranslation('students');
  const config = useRegionConfig();
  const classesQuery = useClasses();

  const schema = React.useMemo(
    () =>
      buildStudentFormSchema({
        fullNameRequired: t('form.errors.fullNameRequired'),
        classSectionRequired: t('form.errors.classSectionRequired'),
        rollNumberInvalid: t('form.errors.rollNumberInvalid'),
      }),
    [t],
  );

  const form = useForm<StudentFormValues>({
    ...useFormShellMode(),
    resolver: zodResolver(schema),
    defaultValues: initialValues,
  });

  const classId = form.watch('classId');
  const sectionsQuery = useClassSections(classId || undefined);

  const hasUnsavedChanges = form.formState.isDirty && !form.formState.isSubmitSuccessful;
  useWarnUnsavedChanges(hasUnsavedChanges);
  // The router calls `shouldBlockFn` against whatever closure was current
  // at the *last committed* render — calling `navigate()` in the same tick
  // as `form.reset()` (this component's own `onSuccess` below does both)
  // races that commit, so `hasUnsavedChanges` can still read stale/`true`
  // when the blocker fires. A ref sidesteps the render-timing question
  // entirely: it's set synchronously, before `onSuccess(student)` is even
  // called, so the very next `shouldBlockFn` invocation already sees it.
  const submittedSuccessfullyRef = React.useRef(false);
  // `enableBeforeUnload: false` — closing the tab/refreshing is already
  // covered by `useWarnUnsavedChanges`'s own `beforeunload` listener above;
  // this only needs to own in-app navigation (a route link, back button).
  // `withResolver: true` renders a real confirmation `Dialog` below rather
  // than `window.confirm` — this repo's own lint rule
  // (`no-window-alert/no-window-alert`) bans the native dialog precisely
  // so every blocking confirmation looks and behaves the same way.
  const blocker = useBlocker({
    shouldBlockFn: () => !submittedSuccessfullyRef.current && hasUnsavedChanges,
    enableBeforeUnload: false,
    withResolver: true,
  });

  const autosave = useFormAutosave(autosaveKey, form.watch(), {
    enabled: !form.formState.isSubmitSuccessful,
  });
  const [draftBannerVisible, setDraftBannerVisible] = React.useState(autosave.draftAvailable);

  function handleSubmit(values: StudentFormValues) {
    mutation.mutate(buildPayload(values), {
      onSuccess: (student) => {
        submittedSuccessfullyRef.current = true;
        autosave.clearDraft();
        form.reset(values, { keepIsSubmitSuccessful: true });
        onSuccess(student);
      },
      onError: (error) => {
        if (error instanceof ApiError) {
          const fieldErrors = parseValidationFieldErrors(
            error.messages,
            STUDENT_FORM_SERVER_FIELDS,
          );
          applyServerFieldErrors(form.setError, fieldErrors);
        }
      },
    });
  }

  const summaryErrors = buildFormShellErrors(form.formState.errors, fieldId);

  return (
    <Form {...form}>
      <Dialog
        open={blocker.status === 'blocked'}
        onOpenChange={(open) => !open && blocker.reset?.()}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('form.unsavedChangesDialog.title')}</DialogTitle>
            <DialogDescription>{t('form.unsavedChangesDialog.description')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('form.unsavedChangesDialog.stayAction')}
              </Button>
            </DialogClose>
            <Button type="button" variant="destructive" onClick={() => blocker.proceed?.()}>
              {t('form.unsavedChangesDialog.leaveAction')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {draftBannerVisible && (
        <div
          role="status"
          className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/50 p-3 text-sm"
        >
          <span>{t('form.draftAvailable')}</span>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => {
                const draft = autosave.restoreDraft();
                if (draft) form.reset(draft);
                setDraftBannerVisible(false);
              }}
            >
              {t('form.restoreDraftAction')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                autosave.discardDraft();
                setDraftBannerVisible(false);
              }}
            >
              {t('form.discardDraftAction')}
            </Button>
          </div>
        </div>
      )}

      <FormShell
        errors={summaryErrors}
        submitCount={form.formState.submitCount}
        onSubmit={(event) => void form.handleSubmit(handleSubmit)(event)}
      >
        <FormSection legend={t('form.sections.identity')}>
          <FormField
            control={form.control}
            name="full_name"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor={fieldId('full_name')}>{t('form.fields.fullName')}</FormLabel>
                <FormControl>
                  <Input id={fieldId('full_name')} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="date_of_birth"
            render={({ field }) => (
              // No explicit `htmlFor`/`id` here — `DatePicker` doesn't accept
              // a caller `id` (see `form-shell.tsx`'s own note that a
              // composite widget's focusable element isn't a single
              // `id`-bearing input), so both fall back to the auto
              // `formItemId` `FormLabel`/`FormControl` already share.
              <FormItem>
                <FormLabel>{t('form.fields.dateOfBirth')}</FormLabel>
                <FormControl>
                  <DatePicker
                    aria-label={t('form.fields.dateOfBirth')}
                    value={field.value}
                    config={config}
                    onValueChange={field.onChange}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="gender"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor={fieldId('gender')}>{t('form.fields.gender')}</FormLabel>
                <FormControl>
                  <Input id={fieldId('gender')} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </FormSection>

        <FormSection legend={t('form.sections.placement')}>
          <FormField
            control={form.control}
            name="classId"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor={fieldId('classId')}>{t('form.fields.class')}</FormLabel>
                <FormControl>
                  <Select
                    value={field.value}
                    onValueChange={(value) => {
                      field.onChange(value);
                      form.setValue('class_section_id', '', { shouldDirty: true });
                    }}
                  >
                    <SelectTrigger
                      id={fieldId('classId')}
                      aria-label={t('form.fields.class')}
                      className="w-full"
                    >
                      <SelectValue placeholder={t('form.fields.classPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {classesQuery.data?.data.map((klass) => (
                        <SelectItem key={klass.id} value={klass.id}>
                          {klass.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="class_section_id"
            render={({ field, fieldState }) => (
              <FormItem>
                <FormLabel htmlFor={fieldId('class_section_id')}>
                  {t('form.fields.section')}
                </FormLabel>
                <FormControl>
                  <Select value={field.value} onValueChange={field.onChange} disabled={!classId}>
                    <SelectTrigger
                      id={fieldId('class_section_id')}
                      aria-label={t('form.fields.section')}
                      aria-invalid={fieldState.invalid}
                      className="w-full"
                    >
                      <SelectValue placeholder={t('form.fields.sectionPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {sectionsQuery.data?.map((section) => (
                        <SelectItem key={section.id} value={section.id}>
                          {section.section_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="roll_number"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor={fieldId('roll_number')}>
                  {t('form.fields.rollNumber')}
                </FormLabel>
                <FormControl>
                  <Input id={fieldId('roll_number')} type="number" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </FormSection>

        <FormSection legend={t('form.sections.guardians')}>
          <FormField
            control={form.control}
            name="guardian_ids"
            render={({ field }) => (
              <FormItem>
                <GuardianPicker
                  selectedIds={field.value}
                  onSelectedIdsChange={field.onChange}
                  initialGuardians={initialGuardians}
                  config={config}
                />
                <FormMessage />
              </FormItem>
            )}
          />
        </FormSection>

        <FormSection legend={t('form.sections.preferences')}>
          <FormField
            control={form.control}
            name="preferred_communication"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor={fieldId('preferred_communication')}>
                  {t('form.fields.preferredCommunication')}
                </FormLabel>
                <FormControl>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger
                      id={fieldId('preferred_communication')}
                      aria-label={t('form.fields.preferredCommunication')}
                      className="w-full"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PREFERRED_COMMUNICATION_VALUES.map((value) => (
                        <SelectItem key={value} value={value}>
                          {t(`form.preferredCommunicationOptions.${value}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="home_address"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor={fieldId('home_address')}>{t('form.fields.address')}</FormLabel>
                <FormControl>
                  <Textarea id={fieldId('home_address')} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </FormSection>

        <div className="flex items-center gap-2">
          <Button type="submit" loading={mutation.isPending}>
            {submitLabel}
          </Button>
        </div>
        {mutation.isError && <MutationErrorMessage error={mutation.error} />}
      </FormShell>
    </Form>
  );
}

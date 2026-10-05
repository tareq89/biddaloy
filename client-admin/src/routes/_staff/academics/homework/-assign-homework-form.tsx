/**
 * [22.4.1] One form, two modes: `create` builds a new Homework + its first
 * assignment in one submit; `assign` (used from the detail page's dialog)
 * only assigns an existing homework to another section/student. Local
 * `useState`, not FormShell — same reasoning `-year-form-dialog.tsx`'s
 * header gives for a short field count.
 */
import { HomeworkGradingMode } from '@biddaloy/shared';
import {
  Button,
  DatePicker,
  DialogClose,
  Input,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@biddaloy/ui/components';
import {
  useClasses,
  useClassSections,
  useClassSubjects,
  useStudents,
  type AssignHomeworkInput,
  type CreateHomeworkInput,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { CircleAlert } from 'lucide-react';
import * as React from 'react';

import { subjectName } from './-subject-name';

export type AssignHomeworkFormMode = 'create' | 'assign';

export interface AssignHomeworkFormInitial {
  classId?: string;
  sectionId?: string;
  subjectId?: string;
}

export interface AssignHomeworkFormSubmitPayload {
  homework?: CreateHomeworkInput;
  assignment: AssignHomeworkInput;
}

export interface AssignHomeworkFormProps {
  mode: AssignHomeworkFormMode;
  /** create: optional prefill from search params. assign: `classId` is
   * REQUIRED and fixed (the homework's own class). */
  initial?: AssignHomeworkFormInitial;
  isPending: boolean;
  /** Caller-supplied message, rendered in a `role="alert"` block. */
  error?: string;
  onSubmit: (payload: AssignHomeworkFormSubmitPayload) => void;
}

type Target = 'section' | 'student';

/** `date.toISOString().slice(0, 10)` converts to UTC first, which in any
 * timezone ahead of UTC can roll the date back a day — see
 * `-year-form-dialog.tsx:65` for the same fix. Copied per-file rather than
 * extracted, following that file's own precedent. */
function toLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function Required() {
  const { t } = useTranslation('homework');
  return (
    <>
      <span className="text-destructive" aria-hidden="true">
        *
      </span>
      <span className="sr-only">{t('form.required')}</span>
    </>
  );
}

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p id={id} className="flex items-center gap-1 text-caption text-destructive">
      <CircleAlert className="size-3.5" aria-hidden="true" />
      {message}
    </p>
  );
}

export function AssignHomeworkForm({
  mode,
  initial,
  isPending,
  error,
  onSubmit,
}: AssignHomeworkFormProps) {
  const { t, i18n } = useTranslation('homework');
  const { t: tCommon } = useTranslation('common');
  const regionConfig = useRegionConfig();

  const [classId, setClassId] = React.useState(initial?.classId ?? '');
  const [subjectId, setSubjectId] = React.useState(initial?.subjectId ?? '');
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [gradingMode, setGradingMode] = React.useState<string>(HomeworkGradingMode.TICK);

  const [target, setTarget] = React.useState<Target>('section');
  const [sectionId, setSectionId] = React.useState(initial?.sectionId ?? '');
  const [studentId, setStudentId] = React.useState('');

  const today = React.useMemo(() => new Date(), []);
  const [assignedDate, setAssignedDate] = React.useState<Date | undefined>(today);
  const [dueDate, setDueDate] = React.useState<Date | undefined>(() => addDays(today, 7));

  const [validationError, setValidationError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<
    Partial<Record<'section' | 'student' | 'assignedDate' | 'dueDate', string>>
  >({});

  const classesQuery = useClasses();
  const selectedClass = classesQuery.data?.data.find((klass) => klass.id === classId);
  const classSubjectsQuery = useClassSubjects(
    mode === 'create' ? classId || undefined : undefined,
    selectedClass?.academic_year_id,
  );
  const sectionsQuery = useClassSections(classId || undefined);
  const studentsQuery = useStudents(
    sectionId !== '' ? { section_id: sectionId, limit: 100 } : { limit: 100 },
    { enabled: target === 'student' && sectionId !== '' },
  );

  function handleClassChange(value: string) {
    setClassId(value);
    setSubjectId('');
    setSectionId('');
    setStudentId('');
  }

  function handleSectionChange(value: string) {
    setSectionId(value);
    setStudentId('');
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (mode === 'create' && (classId === '' || subjectId === '' || title.trim() === '')) {
      setValidationError(t('form.errorRequired'));
      return;
    }
    const errors: typeof fieldErrors = {};
    if (sectionId === '') errors.section = t('form.errorSection');
    if (target === 'student' && studentId === '') errors.student = t('form.errorStudent');
    if (!assignedDate) errors.assignedDate = t('form.errorDate');
    if (!dueDate) errors.dueDate = t('form.errorDate');
    else if (assignedDate && toLocalDateString(dueDate) < toLocalDateString(assignedDate)) {
      errors.dueDate = t('form.dueBeforeAssigned');
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0 || !assignedDate || !dueDate) return;

    setValidationError(null);

    const assignment: AssignHomeworkInput = {
      ...(target === 'student' ? { student_id: studentId } : { section_id: sectionId }),
      assigned_date: toLocalDateString(assignedDate),
      due_date: toLocalDateString(dueDate),
    };

    if (mode === 'create') {
      onSubmit({
        homework: {
          subject_id: subjectId,
          class_id: classId,
          title: title.trim(),
          ...(description.trim() !== '' ? { description: description.trim() } : {}),
          grading_mode: gradingMode as CreateHomeworkInput['grading_mode'],
        },
        assignment,
      });
      return;
    }

    onSubmit({ assignment });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {mode === 'create' && (
        <>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="homework-form-class" className="text-label text-text-primary">
              {t('form.classLabel')}
            </label>
            <Select value={classId} onValueChange={handleClassChange}>
              <SelectTrigger id="homework-form-class" aria-label={t('form.classLabel')}>
                <SelectValue placeholder={tCommon('form.selectPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {(classesQuery.data?.data ?? []).map((klass) => (
                  <SelectItem key={klass.id} value={klass.id}>
                    {klass.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="homework-form-subject" className="text-label text-text-primary">
              {t('form.subjectLabel')}
            </label>
            <Select value={subjectId} onValueChange={setSubjectId} disabled={classId === ''}>
              <SelectTrigger id="homework-form-subject" aria-label={t('form.subjectLabel')}>
                <SelectValue placeholder={tCommon('form.selectPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {(classSubjectsQuery.data ?? []).map((cs) => (
                  <SelectItem key={cs.subject_id} value={cs.subject_id}>
                    {subjectName(cs.subject, i18n.language)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="homework-form-title" className="text-label text-text-primary">
              {t('form.titleLabel')}
            </label>
            <Input
              id="homework-form-title"
              value={title}
              maxLength={200}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="homework-form-description" className="text-label text-text-primary">
              {t('form.descriptionLabel')}
            </label>
            <Textarea
              id="homework-form-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="homework-form-grading-mode" className="text-label text-text-primary">
              {t('form.gradingModeLabel')}
            </label>
            <Select value={gradingMode} onValueChange={setGradingMode}>
              <SelectTrigger
                id="homework-form-grading-mode"
                aria-label={t('form.gradingModeLabel')}
              >
                <SelectValue placeholder={tCommon('form.selectPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {Object.values(HomeworkGradingMode).map((mode_) => (
                  <SelectItem key={mode_} value={mode_}>
                    {t(`form.gradingMode.${mode_}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </>
      )}

      <div className="flex flex-col gap-1.5">
        <span id="homework-form-target" className="text-label text-text-primary">
          {t('form.targetLabel')}
        </span>
        <RadioGroup
          aria-labelledby="homework-form-target"
          value={target}
          onValueChange={(value) => setTarget(value as Target)}
          className="grid grid-cols-2 gap-2"
        >
          <label className="flex h-11 cursor-pointer items-center gap-3 rounded-md border border-border-functional bg-surface px-3 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-secondary has-[[data-state=checked]]:font-medium has-[[data-state=checked]]:text-secondary-foreground md:h-8">
            <RadioGroupItem value="section" />
            {t('form.target.section')}
          </label>
          <label className="flex h-11 cursor-pointer items-center gap-3 rounded-md border border-border-functional bg-surface px-3 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-secondary has-[[data-state=checked]]:font-medium has-[[data-state=checked]]:text-secondary-foreground md:h-8">
            <RadioGroupItem value="student" />
            {t('form.target.student')}
          </label>
        </RadioGroup>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="homework-form-section" className="text-label text-text-primary">
          {t('form.sectionLabel')} <Required />
        </label>
        <Select value={sectionId} onValueChange={handleSectionChange} disabled={classId === ''}>
          <SelectTrigger
            id="homework-form-section"
            aria-invalid={fieldErrors.section ? true : undefined}
            aria-describedby={fieldErrors.section ? 'homework-form-section-error' : undefined}
          >
            <SelectValue placeholder={tCommon('form.selectPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            {(sectionsQuery.data ?? []).map((section) => (
              <SelectItem key={section.id} value={section.id}>
                {section.section_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldError id="homework-form-section-error" message={fieldErrors.section} />
      </div>

      {target === 'student' && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="homework-form-student" className="text-label text-text-primary">
            {t('form.studentLabel')} <Required />
          </label>
          <Select value={studentId} onValueChange={setStudentId} disabled={sectionId === ''}>
            <SelectTrigger
              id="homework-form-student"
              aria-invalid={fieldErrors.student ? true : undefined}
              aria-describedby={fieldErrors.student ? 'homework-form-student-error' : undefined}
            >
              <SelectValue placeholder={tCommon('form.selectPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {(studentsQuery.data?.data ?? []).map((student) => (
                <SelectItem key={student.id} value={student.id}>
                  {student.full_name} · {student.registration_number}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError id="homework-form-student-error" message={fieldErrors.student} />
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="homework-form-assigned" className="text-label text-text-primary">
            {t('form.assignedDateLabel')} <Required />
          </label>
          <DatePicker
            id="homework-form-assigned"
            aria-label={t('form.assignedDateLabel')}
            config={regionConfig}
            value={assignedDate}
            onValueChange={setAssignedDate}
            aria-invalid={fieldErrors.assignedDate ? true : undefined}
            aria-describedby={fieldErrors.assignedDate ? 'homework-form-assigned-error' : undefined}
          />
          <FieldError id="homework-form-assigned-error" message={fieldErrors.assignedDate} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="homework-form-due" className="text-label text-text-primary">
            {t('form.dueDateLabel')} <Required />
          </label>
          <DatePicker
            id="homework-form-due"
            aria-label={t('form.dueDateLabel')}
            config={regionConfig}
            value={dueDate}
            onValueChange={setDueDate}
            aria-invalid={fieldErrors.dueDate ? true : undefined}
            aria-describedby={fieldErrors.dueDate ? 'homework-form-due-error' : undefined}
          />
          <FieldError id="homework-form-due-error" message={fieldErrors.dueDate} />
        </div>
      </div>

      {validationError && (
        <p role="alert" className="text-sm text-destructive">
          {validationError}
        </p>
      )}
      {error !== undefined && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {mode === 'assign' ? (
        <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={isPending}>
              {tCommon('actions.cancel')}
            </Button>
          </DialogClose>
          <Button type="submit" loading={isPending}>
            {t('form.assignSubmit')}
          </Button>
        </div>
      ) : (
        <div className="flex justify-end">
          <Button type="submit" loading={isPending}>
            {isPending ? t('form.submitting') : t('form.submit')}
          </Button>
        </div>
      )}
    </form>
  );
}

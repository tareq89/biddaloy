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
import * as React from 'react';

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

export function AssignHomeworkForm({
  mode,
  initial,
  isPending,
  error,
  onSubmit,
}: AssignHomeworkFormProps) {
  const { t } = useTranslation('homework');
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
    if (sectionId === '') {
      setValidationError(t('form.errorRequired'));
      return;
    }
    if (target === 'student' && studentId === '') {
      setValidationError(t('form.errorRequired'));
      return;
    }
    if (!assignedDate || !dueDate) {
      setValidationError(t('form.errorRequired'));
      return;
    }
    if (dueDate < assignedDate) {
      setValidationError(t('form.dueBeforeAssigned'));
      return;
    }

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
            <label htmlFor="homework-form-class" className="text-sm font-medium">
              {t('form.classLabel')}
            </label>
            <Select value={classId} onValueChange={handleClassChange}>
              <SelectTrigger id="homework-form-class" aria-label={t('form.classLabel')}>
                <SelectValue />
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
            <label htmlFor="homework-form-subject" className="text-sm font-medium">
              {t('form.subjectLabel')}
            </label>
            <Select value={subjectId} onValueChange={setSubjectId} disabled={classId === ''}>
              <SelectTrigger id="homework-form-subject" aria-label={t('form.subjectLabel')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(classSubjectsQuery.data ?? []).map((cs) => (
                  <SelectItem key={cs.subject_id} value={cs.subject_id}>
                    {cs.subject.name_en}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="homework-form-title" className="text-sm font-medium">
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
            <label htmlFor="homework-form-description" className="text-sm font-medium">
              {t('form.descriptionLabel')}
            </label>
            <Textarea
              id="homework-form-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="homework-form-grading-mode" className="text-sm font-medium">
              {t('form.gradingModeLabel')}
            </label>
            <Select value={gradingMode} onValueChange={setGradingMode}>
              <SelectTrigger
                id="homework-form-grading-mode"
                aria-label={t('form.gradingModeLabel')}
              >
                <SelectValue />
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
        <span className="text-sm font-medium">{t('form.targetLabel')}</span>
        <RadioGroup
          aria-label={t('form.targetLabel')}
          value={target}
          onValueChange={(value) => setTarget(value as Target)}
          className="flex gap-4"
        >
          <span className="flex items-center gap-2 text-sm">
            <RadioGroupItem
              value="section"
              aria-label={`${t('form.targetLabel')}: ${t('form.target.section')}`}
            />
            {t('form.target.section')}
          </span>
          <span className="flex items-center gap-2 text-sm">
            <RadioGroupItem
              value="student"
              aria-label={`${t('form.targetLabel')}: ${t('form.target.student')}`}
            />
            {t('form.target.student')}
          </span>
        </RadioGroup>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="homework-form-section" className="text-sm font-medium">
          {t('form.sectionLabel')}
        </label>
        <Select value={sectionId} onValueChange={handleSectionChange} disabled={classId === ''}>
          <SelectTrigger id="homework-form-section" aria-label={t('form.sectionLabel')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(sectionsQuery.data ?? []).map((section) => (
              <SelectItem key={section.id} value={section.id}>
                {section.section_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {target === 'student' && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="homework-form-student" className="text-sm font-medium">
            {t('form.studentLabel')}
          </label>
          <Select value={studentId} onValueChange={setStudentId} disabled={sectionId === ''}>
            <SelectTrigger id="homework-form-student" aria-label={t('form.studentLabel')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(studentsQuery.data?.data ?? []).map((student) => (
                <SelectItem key={student.id} value={student.id}>
                  {student.full_name} · {student.registration_number}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex gap-3">
        <div className="flex flex-1 flex-col gap-1.5">
          <span className="text-sm font-medium">{t('form.assignedDateLabel')}</span>
          <DatePicker
            aria-label={t('form.assignedDateLabel')}
            config={regionConfig}
            value={assignedDate}
            onValueChange={setAssignedDate}
          />
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <span className="text-sm font-medium">{t('form.dueDateLabel')}</span>
          <DatePicker
            aria-label={t('form.dueDateLabel')}
            config={regionConfig}
            value={dueDate}
            onValueChange={setDueDate}
          />
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

      <div className="flex justify-end">
        <Button type="submit" loading={isPending}>
          {isPending ? t('form.submitting') : t('form.submit')}
        </Button>
      </div>
    </form>
  );
}

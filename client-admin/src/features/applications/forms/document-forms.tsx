import { examsQueryOptions, useAcademicYears, useClassSubjects } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useQuery } from '@tanstack/react-query';
import { useFormContext, useWatch } from 'react-hook-form';

import { SelectField, TextField } from './fields';
import type { ApplicationSubject } from './registry';

export function TestimonialFields() {
  const { t } = useTranslation('applicationForms');
  return (
    <TextField
      name="purpose"
      label={t('fields.purpose')}
      placeholder={t('placeholders.purpose')}
      wide
    />
  );
}

export function IdCardReprintFields() {
  const { t } = useTranslation('applicationForms');
  return <TextField name="reason" label={t('fields.reason')} rows={3} wide />;
}

export function ScriptRecheckFields({ subject }: { subject: ApplicationSubject }) {
  const { t, i18n } = useTranslation('applicationForms');
  const { setValue } = useFormContext();
  const classId = subject.kind === 'STUDENT' ? subject.classId : undefined;
  const examId = useWatch({ name: 'exam_id' }) as string;
  // This year's exams only: names like "Half yearly" repeat every year. No current year →
  // every year (the server lists newest first).
  const years = useAcademicYears({ limit: 100 });
  const yearId = years.data?.data.find((y) => y.is_current)?.id;
  const exams = useQuery({
    ...examsQueryOptions({
      ...(classId ? { class_id: classId } : {}),
      ...(yearId ? { academic_year_id: yearId } : {}),
      limit: 100,
    }),
    enabled: years.isSuccess,
  });
  const examList = exams.data?.data ?? [];
  const examSource = {
    isLoading: years.isLoading || exams.isLoading,
    isError: years.isError || exams.isError,
    refetch: () => (years.isError ? years.refetch() : exams.refetch()),
  };
  // Subjects a class offers are per academic year, so they follow the exam picked.
  const exam = examList.find((e) => e.id === examId);
  const subjects = useClassSubjects(classId, exam?.academic_year_id);

  return (
    <>
      <SelectField
        name="exam_id"
        label={t('fields.exam')}
        source={examSource}
        emptyHint={t('pickers.noExams')}
        options={examList.map((e) => ({ value: e.id, label: e.name }))}
        onChange={() => setValue('subject_id', '', { shouldValidate: false })}
      />
      <SelectField
        name="subject_id"
        label={t('fields.subject')}
        disabled={!exam}
        source={subjects}
        emptyHint={t('pickers.noSubjects')}
        options={(subjects.data ?? []).map((cs) => ({
          value: cs.subject_id,
          label: (i18n.language === 'bn' && cs.subject.name_bn) || cs.subject.name_en,
        }))}
      />
      <TextField name="reason" label={t('fields.reason')} rows={3} wide />
    </>
  );
}

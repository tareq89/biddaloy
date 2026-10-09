import { useClassSubjects, useExams } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
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
  const exams = useExams(classId ? { class_id: classId, limit: 100 } : { limit: 100 });
  const examList = exams.data?.data ?? [];
  // Subjects a class offers are per academic year, so they follow the exam picked.
  const exam = examList.find((e) => e.id === examId);
  const subjects = useClassSubjects(classId, exam?.academic_year_id);

  return (
    <>
      <SelectField
        name="exam_id"
        label={t('fields.exam')}
        options={examList.map((e) => ({ value: e.id, label: e.name }))}
        onChange={() => setValue('subject_id', '', { shouldValidate: false })}
      />
      <SelectField
        name="subject_id"
        label={t('fields.subject')}
        disabled={!exam}
        options={(subjects.data ?? []).map((cs) => ({
          value: cs.subject_id,
          label: (i18n.language === 'bn' && cs.subject.name_bn) || cs.subject.name_en,
        }))}
      />
      <TextField name="reason" label={t('fields.reason')} rows={3} wide />
    </>
  );
}

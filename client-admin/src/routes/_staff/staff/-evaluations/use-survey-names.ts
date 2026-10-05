/** [28.4.2] Survey endpoints return teacher/subject ids only; resolve names once for a screen. */
import { useAllSubjects, useAllTeachers } from '@biddaloy/ui/hooks';
import { useLocale } from '@biddaloy/ui/i18n';

export function useSurveyNames() {
  const { locale } = useLocale();
  const teachers = useAllTeachers();
  const subjects = useAllSubjects();
  return {
    teacherName: (id: string) => teachers.data?.find((x) => x.id === id)?.user.full_name ?? '…',
    subjectName: (id: string) => {
      const subject = subjects.data?.find((x) => x.id === id);
      if (!subject) return '…';
      return locale === 'bn' && subject.name_bn ? subject.name_bn : subject.name_en;
    },
  };
}

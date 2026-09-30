/** [28.4.2] Survey endpoints return teacher/subject ids only; resolve names once for a screen. */
import { useAllSubjects, useAllTeachers } from '@biddaloy/ui/hooks';

export function useSurveyNames() {
  const teachers = useAllTeachers();
  const subjects = useAllSubjects();
  return {
    teacherName: (id: string) => teachers.data?.find((x) => x.id === id)?.user.full_name ?? '…',
    subjectName: (id: string) => subjects.data?.find((x) => x.id === id)?.name_en ?? '…',
  };
}

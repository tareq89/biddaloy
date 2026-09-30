/**
 * [39.3.3] Student detail's "Records" tab — profile fields, public exams,
 * lifecycle timeline. Shell cloned from `fines-tab.tsx` (`TabQueryState`).
 * Not yet wired into `$studentId.tsx`'s tab list (a later ticket does that).
 */
import { useStudent } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

import { LifecycleTimeline } from './-records/lifecycle-timeline';
import { ProfileFieldsForm } from './-records/profile-fields-form';
import { PublicExamsSection } from './-records/public-exams-section';
import { TabQueryState } from './tab-query-state';

export interface RecordsTabProps {
  studentId: string;
}

export function RecordsTab({ studentId }: RecordsTabProps) {
  const { t } = useTranslation('student-records');
  const studentQuery = useStudent(studentId);

  return (
    <div className="flex flex-col gap-8">
      <TabQueryState
        query={studentQuery}
        forbiddenMessage={t('tab.forbidden')}
        errorMessage={t('tab.error')}
      >
        {(student) => (
          // key: re-seed the form's local state if a refetch brings new values.
          <ProfileFieldsForm key={student.updated_at} student={student} />
        )}
      </TabQueryState>
      <PublicExamsSection studentId={studentId} />
      <LifecycleTimeline studentId={studentId} />
    </div>
  );
}

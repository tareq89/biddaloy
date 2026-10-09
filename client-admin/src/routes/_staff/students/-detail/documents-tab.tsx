/**
 * [32.4.2] A student's Documents tab: the photo, a way to print the ID card, and what has
 * already been printed for this student.
 */
import { Permission } from '@biddaloy/shared';
import { Button, Card } from '@biddaloy/ui/components';
import { useHasPermission } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { IdCardIcon } from 'lucide-react';

import { SubjectPrintHistory } from '../../../../components/print/history/subject-print-history';
import { StudentPhotoCard } from '../../../../components/print/student-photo-card';

export function DocumentsTab({ studentId }: { studentId: string }) {
  const { t } = useTranslation('students');
  const navigate = useNavigate();
  const from = useRouterState({ select: (s) => s.location.pathname });
  const canEdit = useHasPermission(Permission.STUDENT_UPDATE);

  return (
    <div className="flex flex-col gap-6">
      <StudentPhotoCard studentId={studentId} canEdit={canEdit} />
      <div>
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            void navigate({
              to: '/print/preview',
              search: {
                kind: 'STUDENT_ID_CARD',
                subject_type: 'STUDENT',
                ids: studentId,
                from,
              },
            })
          }
        >
          <IdCardIcon className="size-4" aria-hidden />
          {t('detail.actions.printIdCard')}
        </Button>
      </div>
      <Card padded>
        <h2 className="text-h2">{t('documents.historyTitle')}</h2>
        <div className="mt-4">
          <SubjectPrintHistory subjectType="STUDENT" subjectId={studentId} />
        </div>
      </Card>
    </div>
  );
}

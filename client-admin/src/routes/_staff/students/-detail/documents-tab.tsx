/**
 * [32.4.2] A student's Documents tab: the photo, a way to print the ID card, and what has
 * already been printed for this student.
 * [48.3.B-01] Issue certificate (the one filled button), the student's issued certificates,
 * and the yearly transcript.
 */
import { Permission } from '@biddaloy/shared';
import {
  Button,
  Card,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@biddaloy/ui/components';
import { useAcademicYears, useHasPermission } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { IdCardIcon } from 'lucide-react';
import * as React from 'react';

import { IssuedCertificates } from '../../../../components/print/certificates/issued-certificates';
import { SubjectPrintHistory } from '../../../../components/print/history/subject-print-history';
import { StudentPhotoCard } from '../../../../components/print/student-photo-card';

/** The "Issue certificate" button: the student page returns focus here when the modal closes. */
export const ISSUE_TRIGGER_ID = 'issue-certificate-trigger';

export function DocumentsTab({ studentId }: { studentId: string }) {
  const { t } = useTranslation('students');
  const { t: tc } = useTranslation('certificates');
  const navigate = useNavigate();
  const from = useRouterState({ select: (s) => s.location.pathname });
  const canEdit = useHasPermission(Permission.STUDENT_UPDATE);
  const canIssue = useHasPermission(Permission.CERTIFICATE_ISSUE);
  const canReadRegister = useHasPermission(Permission.PRINT_HISTORY_READ);
  const canPrint = useHasPermission(Permission.DOCUMENT_PRINT);
  const canReadResults = useHasPermission(Permission.RESULT_READ);
  const canTranscript = canPrint && canReadResults;
  const years = useAcademicYears();
  const [yearId, setYearId] = React.useState<string | undefined>(undefined);
  const yearList = years.data?.data ?? [];
  const selectedYear = yearId ?? yearList.find((y) => y.is_current)?.id ?? yearList[0]?.id;

  return (
    <div className="flex flex-col gap-6">
      <StudentPhotoCard studentId={studentId} canEdit={canEdit} />
      <div className="flex flex-wrap items-center gap-3">
        {canIssue ? (
          <Button
            id={ISSUE_TRIGGER_ID}
            type="button"
            onClick={() =>
              void navigate({
                to: '.',
                search: (p: Record<string, unknown>) => ({ ...p, issue: 'pick' as const }),
              })
            }
          >
            {tc('documentsTab.issue')}
          </Button>
        ) : null}
        {canPrint ? (
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
        ) : null}
        {canTranscript ? (
          <div className="flex items-center gap-2">
            <Select value={selectedYear ?? ''} onValueChange={setYearId}>
              <SelectTrigger aria-label={tc('documentsTab.transcriptYear')} className="w-40">
                <SelectValue placeholder={tc('documentsTab.transcriptYear')} />
              </SelectTrigger>
              <SelectContent>
                {yearList.map((y) => (
                  <SelectItem key={y.id} value={y.id}>
                    {y.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              disabled={!selectedYear}
              onClick={() =>
                void navigate({
                  to: '/print/document',
                  search: {
                    doc: 'transcript',
                    student_id: studentId,
                    academic_year_id: selectedYear,
                    from,
                  },
                })
              }
            >
              {tc('documentsTab.transcript')}
            </Button>
          </div>
        ) : null}
      </div>
      {canReadRegister ? <IssuedCertificates studentId={studentId} /> : null}
      <Card padded>
        <h2 className="text-h2">{t('documents.historyTitle')}</h2>
        <div className="mt-4">
          <SubjectPrintHistory subjectType="STUDENT" subjectId={studentId} />
        </div>
      </Card>
    </div>
  );
}

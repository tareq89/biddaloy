/**
 * [32.4.2] A staff member's Documents tab. The ID-card photo is the PHOTO document on the HR
 * record, so it is only read here; changing it happens in the HR record tab (D18).
 */
import { Button } from '@biddaloy/ui/components';
import { useStaffDocuments } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useNavigate, useRouterState } from '@tanstack/react-router';

import { SubjectPrintHistory } from '../../../../components/print/history/subject-print-history';

export function StaffDocumentsTab({
  userId,
  onOpenHrRecord,
}: {
  userId: string;
  onOpenHrRecord: () => void;
}) {
  const { t } = useTranslation('staff');
  const navigate = useNavigate();
  const from = useRouterState({ select: (s) => s.location.pathname });
  const documents = useStaffDocuments(userId);
  const hasPhoto = (documents.data ?? []).some((d) => d.document_type === 'PHOTO');

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">{t('documents.photoTitle')}</h2>
        <p className="text-sm text-muted-foreground">
          {hasPhoto ? t('documents.photoOnFile') : t('documents.photoMissing')}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={onOpenHrRecord}
        >
          {t('documents.openHrRecord')}
        </Button>
      </section>
      <div>
        <Button
          type="button"
          onClick={() =>
            void navigate({
              to: '/print/preview',
              search: { kind: 'STAFF_ID_CARD', subject_type: 'STAFF', ids: userId, from },
            })
          }
        >
          {t('documents.printButton')}
        </Button>
      </div>
      <section aria-label={t('documents.historyTitle')} className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">{t('documents.historyTitle')}</h2>
        <SubjectPrintHistory subjectType="STAFF" subjectId={userId} />
      </section>
    </div>
  );
}

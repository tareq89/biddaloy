/**
 * [32.4.2] A staff member's Documents tab. The ID-card photo is the PHOTO document on the HR
 * record, so it is only read here; changing it happens in the HR record tab (D18).
 */
import { Button } from '@biddaloy/ui/components';
import { useStaffDocuments } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { PrinterIcon } from 'lucide-react';

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
    <div className="space-y-6">
      <section className="rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-h2">{t('documents.photoTitle')}</h2>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              void navigate({
                to: '/print/preview',
                search: { kind: 'STAFF_ID_CARD', subject_type: 'STAFF', ids: userId, from },
              })
            }
          >
            <PrinterIcon aria-hidden="true" />
            {t('documents.printButton')}
          </Button>
        </div>
        <p className="mt-1 text-text-secondary">
          {hasPhoto ? t('documents.photoOnFile') : t('documents.photoMissing')}
        </p>
        <Button type="button" variant="outline" className="mt-4" onClick={onOpenHrRecord}>
          {t('documents.openHrRecord')}
        </Button>
      </section>
      <section
        aria-label={t('documents.historyTitle')}
        className="rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5"
      >
        <h2 className="text-h2">{t('documents.historyTitle')}</h2>
        <div className="mt-4">
          <SubjectPrintHistory subjectType="STAFF" subjectId={userId} />
        </div>
      </section>
    </div>
  );
}

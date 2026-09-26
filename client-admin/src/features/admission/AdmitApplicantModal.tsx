/**
 * [27.10] Admit confirmation — shows the guardian phone/name the admit call
 * will resolve against before committing (D7/D8). `POST
 * /admission/applicants/:id/admit` (`ApplicantReviewService.admit`) does the
 * actual existing-vs-new guardian lookup server-side and returns only the
 * updated applicant, with no separate "was this new or existing" flag — see
 * the plan-correction note in the `## Plan — 1045` comment. This modal shows
 * the guardian details the lookup will match on ahead of the call, and a
 * plain success/error result after it, rather than a true pre-commit
 * existing-vs-new preview, since no endpoint answers that today.
 */
import { AdmissionApplicantStatus, type AdmissionApplicantDto } from '@biddaloy/shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

import { useAdmitApplicant } from './hooks/useAdmitApplicant';

export function AdmitApplicantModal({
  applicant,
  open,
  onOpenChange,
}: {
  applicant: AdmissionApplicantDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation('admission-staff-applicants');
  const admit = useAdmitApplicant(applicant.id);
  const [admitted, setAdmitted] = React.useState(false);

  function handleClose(next: boolean) {
    onOpenChange(next);
    if (!next) {
      setAdmitted(false);
      admit.reset();
    }
  }

  function handleConfirm() {
    admit.mutate({}, { onSuccess: () => setAdmitted(true) });
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admitModal.title')}</DialogTitle>
        </DialogHeader>

        {admitted ? (
          <p role="status" className="text-sm text-foreground">
            {t('admitModal.successMessage', { name: applicant.applicant_name })}
          </p>
        ) : (
          <div className="flex flex-col gap-2 text-sm">
            <p>{t('admitModal.description')}</p>
            <dl className="flex flex-col gap-1">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{t('admitModal.guardianName')}</dt>
                <dd>{applicant.guardian_name}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{t('admitModal.guardianPhone')}</dt>
                <dd>{applicant.guardian_phone}</dd>
              </div>
            </dl>
            <p className="text-muted-foreground">{t('admitModal.resolutionNote')}</p>
          </div>
        )}

        {admit.isError && (
          <p role="alert" className="text-sm text-destructive">
            {t('admitModal.errorMessage')}
          </p>
        )}

        <DialogFooter>
          {admitted ? (
            <Button type="button" onClick={() => handleClose(false)}>
              {t('admitModal.close')}
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => handleClose(false)}>
                {t('actions.cancel', { ns: 'common' })}
              </Button>
              <Button
                type="button"
                loading={admit.isPending}
                disabled={applicant.status === AdmissionApplicantStatus.ADMITTED}
                onClick={handleConfirm}
              >
                {admit.isPending ? t('admitModal.admitting') : t('admitModal.confirm')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

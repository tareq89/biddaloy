/**
 * [27.10] Applicant detail — fields, uploaded documents, evaluation
 * history, and status-gated Evaluate/Shortlist/Admit/Reject actions.
 * `DetailShell` gives the header/status-badge/tiered-action pattern
 * (cloned from `client-admin/src/routes/_staff/classes/$classId.tsx`); a
 * single "overview" tab is enough here, no need for `DetailShell`'s
 * multi-tab strip.
 */
import { AdmissionApplicantStatus } from '@biddaloy/shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ErrorState,
  RoutePending,
  Textarea,
} from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { DetailShell } from '@biddaloy/ui/shells';
import * as React from 'react';

import { AdmitApplicantModal } from './AdmitApplicantModal';
import { EvaluateApplicantForm } from './EvaluateApplicantForm';
import {
  useApplicant,
  useRejectApplicant,
  type EvaluateApplicantInput,
} from './hooks/useApplicants';

const STATUS_BADGE_CLASS: Record<AdmissionApplicantStatus, string> = {
  [AdmissionApplicantStatus.PENDING]: 'bg-muted text-muted-foreground',
  [AdmissionApplicantStatus.SHORTLISTED]: 'bg-status-pending-bg text-status-pending-fg',
  [AdmissionApplicantStatus.ADMITTED]: 'bg-status-paid-bg text-status-paid-fg',
  [AdmissionApplicantStatus.REJECTED]: 'bg-status-overdue-bg text-status-overdue-fg',
};

export function ApplicantDetail({ applicantId }: { applicantId: string }) {
  const { t } = useTranslation('admission-staff-applicants');
  const applicantQuery = useApplicant(applicantId);
  const rejectApplicant = useRejectApplicant(applicantId);

  const [admitOpen, setAdmitOpen] = React.useState(false);
  const [evaluateOpen, setEvaluateOpen] = React.useState(false);
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [rejectNotes, setRejectNotes] = React.useState('');
  const [evaluateDecision, setEvaluateDecision] =
    React.useState<EvaluateApplicantInput['decision']>(undefined);

  if (applicantQuery.isLoading) {
    return <RoutePending variant="detail" label={t('routePending.label', { ns: 'nav' })} />;
  }

  if (applicantQuery.isError || !applicantQuery.data) {
    return (
      <ErrorState
        message={t('detail.errorMessage')}
        onRetry={() => void applicantQuery.refetch()}
      />
    );
  }

  const { applicant, evaluations } = applicantQuery.data;

  const statusLabel: Record<AdmissionApplicantStatus, string> = {
    [AdmissionApplicantStatus.PENDING]: t('list.statusPending'),
    [AdmissionApplicantStatus.SHORTLISTED]: t('list.statusShortlisted'),
    [AdmissionApplicantStatus.ADMITTED]: t('list.statusAdmitted'),
    [AdmissionApplicantStatus.REJECTED]: t('list.statusRejected'),
  };

  const mutable =
    applicant.status !== AdmissionApplicantStatus.ADMITTED &&
    applicant.status !== AdmissionApplicantStatus.REJECTED;

  function openEvaluate(decision: EvaluateApplicantInput['decision']) {
    setEvaluateDecision(decision);
    setEvaluateOpen(true);
  }

  return (
    <div className="flex flex-col gap-4">
      <DetailShell
        name={applicant.applicant_name}
        identifiers={
          <>
            {applicant.reference_number} · {applicant.guardian_phone}
          </>
        }
        statusBadge={
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS[applicant.status]}`}
          >
            {statusLabel[applicant.status]}
          </span>
        }
        actions={[
          {
            id: 'evaluate',
            label: t('detail.actionShortlist'),
            onClick: () => openEvaluate('SHORTLIST'),
            allowed: mutable,
            priority: 'secondary',
          },
          {
            id: 'admit',
            label: t('detail.actionAdmit'),
            onClick: () => setAdmitOpen(true),
            allowed: mutable,
            priority: 'primary',
          },
          {
            id: 'reject',
            label: t('detail.actionReject'),
            onClick: () => setRejectOpen(true),
            allowed: mutable,
            priority: 'destructive',
          },
        ]}
        tabs={[
          {
            id: 'overview',
            label: t('detail.tabOverview'),
            content: (
              <div className="flex flex-col gap-6">
                <section className="flex flex-col gap-2">
                  <h2 className="text-sm font-semibold">{t('detail.sectionApplicant')}</h2>
                  <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                    <Field label={t('detail.fieldDateOfBirth')} value={applicant.date_of_birth} />
                    <Field label={t('detail.fieldGender')} value={applicant.gender} />
                    <Field label={t('detail.fieldGuardianName')} value={applicant.guardian_name} />
                    <Field
                      label={t('detail.fieldGuardianPhone')}
                      value={applicant.guardian_phone}
                    />
                    <Field
                      label={t('detail.fieldGuardianEmail')}
                      value={applicant.guardian_email ?? t('detail.notProvided')}
                    />
                    <Field
                      label={t('detail.fieldHomeAddress')}
                      value={applicant.home_address ?? t('detail.notProvided')}
                    />
                  </dl>
                </section>

                <section className="flex flex-col gap-2">
                  <h2 className="text-sm font-semibold">{t('detail.sectionDocuments')}</h2>
                  {applicant.documents.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t('detail.noDocuments')}</p>
                  ) : (
                    // ponytail: no storage-serving endpoint exists yet for
                    // admission documents (checked `server/src/modules/admission`
                    // and `homework-submission.controller.ts` for a pattern to
                    // reuse — neither has one), so this lists what was uploaded
                    // without a preview/download link. Add the link once a
                    // signed-URL route for `storage_key` ships.
                    <ul className="flex flex-col gap-1 text-sm">
                      {applicant.documents.map((document) => (
                        <li key={document.storage_key}>{document.type}</li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="flex flex-col gap-2">
                  <h2 className="text-sm font-semibold">{t('detail.sectionHistory')}</h2>
                  {evaluations.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t('detail.noEvaluations')}</p>
                  ) : (
                    <ul className="flex flex-col gap-3 text-sm">
                      {evaluations.map((evaluation) => (
                        <li
                          key={evaluation.id}
                          className="rounded-md border border-border-subtle p-3"
                        >
                          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                            <span>{evaluation.decision ?? t('detail.noteOnly')}</span>
                            <span>{evaluation.created_at.slice(0, 10)}</span>
                          </div>
                          <p className="mt-1">{evaluation.notes}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            ),
          },
        ]}
        activeTab="overview"
        onTabChange={() => {}}
      />

      <AdmitApplicantModal applicant={applicant} open={admitOpen} onOpenChange={setAdmitOpen} />
      <EvaluateApplicantForm
        applicantId={applicant.id}
        {...(evaluateDecision ? { decision: evaluateDecision } : {})}
        open={evaluateOpen}
        onOpenChange={setEvaluateOpen}
      />

      <Dialog
        open={rejectOpen}
        onOpenChange={(next) => {
          setRejectOpen(next);
          if (!next) setRejectNotes('');
        }}
      >
        <DialogContent>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              rejectApplicant.mutate(rejectNotes.trim() || undefined, {
                onSuccess: () => {
                  setRejectOpen(false);
                  setRejectNotes('');
                },
              });
            }}
            className="flex flex-col gap-4"
          >
            <DialogHeader>
              <DialogTitle>{t('detail.rejectTitle')}</DialogTitle>
            </DialogHeader>

            <Textarea
              aria-label={t('evaluate.notesLabel')}
              placeholder={t('evaluate.notesLabel')}
              value={rejectNotes}
              onChange={(event) => setRejectNotes(event.target.value)}
            />

            {rejectApplicant.isError && (
              <p role="alert" className="text-sm text-destructive">
                {t('detail.rejectErrorMessage')}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRejectOpen(false)}>
                {t('actions.cancel', { ns: 'common' })}
              </Button>
              <Button type="submit" variant="destructive" loading={rejectApplicant.isPending}>
                {rejectApplicant.isPending ? t('detail.rejecting') : t('detail.actionReject')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

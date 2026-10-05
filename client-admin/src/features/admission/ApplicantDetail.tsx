/**
 * [27.10] Applicant detail — facts header, applicant/documents/history cards, and
 * status-gated Shortlist/Admit/Add-note/Reject actions. Tab-less `DetailShell`.
 */
import { AdmissionApplicantStatus } from '@biddaloy/shared';
import {
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ErrorState,
  Label,
  RoutePending,
  StatusBadge,
  Textarea,
  type StatusTone,
} from '@biddaloy/ui/components';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { DetailShell } from '@biddaloy/ui/shells';
import { formatDate, formatDateTime, formatPhone } from '@biddaloy/ui/utils';
import { FileTextIcon, ImageIcon, ListChecksIcon, UserCheckIcon } from 'lucide-react';
import * as React from 'react';

import { AdmitApplicantModal } from './AdmitApplicantModal';
import { APPLICANT_STATUS } from './applicantStatus';
import { EvaluateApplicantForm } from './EvaluateApplicantForm';
import {
  useApplicant,
  useRejectApplicant,
  type EvaluateApplicantInput,
} from './hooks/useApplicants';
import { useIntake } from './hooks/useIntakes';

const DECISION_TONE: Record<string, StatusTone> = {
  NOTE: 'neutral',
  SHORTLIST: 'info',
  ADMIT: 'success',
  REJECT: 'danger',
};

export function ApplicantDetail({ applicantId }: { applicantId: string }) {
  const { t } = useTranslation('admission-staff-applicants');
  const applicantQuery = useApplicant(applicantId);
  const regionConfig = useRegionConfig();
  const intakeQuery = useIntake(applicantQuery.data?.applicant.intake_id);
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

  const mutable =
    applicant.status !== AdmissionApplicantStatus.ADMITTED &&
    applicant.status !== AdmissionApplicantStatus.REJECTED;
  // Shortlist only makes sense from PENDING — the server rejects a second
  // SHORTLIST decision on an already-SHORTLISTED applicant (it would
  // re-notify the guardian for no real status change).
  const shortlistable = applicant.status === AdmissionApplicantStatus.PENDING;

  function openEvaluate(decision: EvaluateApplicantInput['decision']) {
    setEvaluateDecision(decision);
    setEvaluateOpen(true);
  }

  const sortedEvaluations = [...evaluations].sort((x, y) =>
    y.created_at.localeCompare(x.created_at),
  );
  const genderKey = ['MALE', 'FEMALE', 'OTHER'].includes(applicant.gender)
    ? `detail.genderOptions.${applicant.gender}`
    : null;

  return (
    <div className="flex flex-col gap-4">
      <DetailShell
        name={applicant.applicant_name}
        facts={[
          { label: t('detail.factReference'), value: applicant.reference_number },
          { label: t('detail.factApplied'), value: formatDate(applicant.created_at, regionConfig) },
          { label: t('detail.factIntake'), value: intakeQuery.data?.title ?? '—' },
        ]}
        statusBadge={
          <StatusBadge
            tone={APPLICANT_STATUS[applicant.status].tone}
            label={t(APPLICANT_STATUS[applicant.status].labelKey)}
          />
        }
        actions={[
          {
            id: 'shortlist',
            label: t('detail.actionShortlist'),
            icon: <ListChecksIcon aria-hidden />,
            onClick: () => openEvaluate('SHORTLIST'),
            allowed: shortlistable,
            priority: 'secondary',
          },
          {
            id: 'admit',
            label: t('detail.actionAdmit'),
            icon: <UserCheckIcon aria-hidden />,
            onClick: () => setAdmitOpen(true),
            allowed: mutable,
            priority: 'primary',
          },
          {
            id: 'note',
            label: t('detail.actionAddNote'),
            onClick: () => openEvaluate(undefined),
            allowed: mutable,
            priority: 'tertiary',
          },
          {
            id: 'reject',
            label: t('detail.actionReject'),
            onClick: () => setRejectOpen(true),
            allowed: mutable,
            priority: 'destructive',
          },
        ]}
      >
        <div className="grid gap-6 md:grid-cols-3 md:items-start">
          <div className="flex flex-col gap-6 md:col-span-2">
            <Card padded>
              <h2 className="text-h2">{t('detail.sectionApplicant')}</h2>
              <dl className="mt-4 grid gap-4 md:grid-cols-3">
                <Field
                  label={t('detail.fieldDateOfBirth')}
                  value={formatDate(applicant.date_of_birth, regionConfig)}
                />
                <Field
                  label={t('detail.fieldGender')}
                  value={genderKey ? t(genderKey) : t('detail.notProvided')}
                />
                <Field label={t('detail.fieldGuardianName')} value={applicant.guardian_name} />
                <Field
                  label={t('detail.fieldGuardianPhone')}
                  value={formatPhone(applicant.guardian_phone, regionConfig)}
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
            </Card>

            <Card padded>
              <h2 className="text-h2">{t('detail.sectionDocuments')}</h2>
              {applicant.documents.length === 0 ? (
                <p className="mt-2 text-text-secondary">{t('detail.noDocuments')}</p>
              ) : (
                // ponytail: no storage-serving endpoint exists yet for
                // admission documents (checked `server/src/modules/admission`
                // and `homework-submission.controller.ts` for a pattern to
                // reuse — neither has one), so this lists what was uploaded
                // without a preview/download link. Add the link once a
                // signed-URL route for `storage_key` ships.
                <ul className="mt-2 divide-y divide-border-subtle">
                  {applicant.documents.map((document) => {
                    const Icon = document.type === 'PHOTO' ? ImageIcon : FileTextIcon;
                    return (
                      <li key={document.storage_key} className="flex items-center gap-3 py-3">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-text-secondary">
                          <Icon className="size-4" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1 font-medium">
                          {t(`detail.documentTypes.${document.type}`, {
                            defaultValue: t('detail.notProvided'),
                          })}
                        </span>
                        <span className="text-text-secondary">{t('detail.uploaded')}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>

          <Card padded>
            <h2 className="text-h2">{t('detail.sectionHistory')}</h2>
            <p className="mt-1 text-text-secondary">{t('detail.historySubtitle')}</p>
            {sortedEvaluations.length === 0 ? (
              <p className="mt-2 text-text-secondary">{t('detail.noEvaluations')}</p>
            ) : (
              <ul className="mt-2 divide-y divide-border-subtle">
                {sortedEvaluations.map((evaluation) => {
                  const decision = evaluation.decision ?? 'NOTE';
                  return (
                    <li key={evaluation.id} className="py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <StatusBadge
                          tone={DECISION_TONE[decision] ?? 'neutral'}
                          label={t(`detail.decision.${decision}`, {
                            defaultValue: t('detail.decision.NOTE'),
                          })}
                        />
                        <span className="text-caption text-text-secondary">
                          {formatDateTime(evaluation.created_at, regionConfig)}
                        </span>
                      </div>
                      <p className="mt-1.5">{evaluation.notes}</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </DetailShell>

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
        <DialogContent size="sm">
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
              <DialogDescription>
                {t('detail.rejectDescription', { name: applicant.applicant_name })}
              </DialogDescription>
            </DialogHeader>

            <Label htmlFor="reject-notes">{t('detail.rejectNotesLabel')}</Label>
            <Textarea
              id="reject-notes"
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
              <Button type="submit" variant="danger" loading={rejectApplicant.isPending}>
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

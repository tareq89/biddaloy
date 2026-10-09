/**
 * [52.6.1] A family files an application for a linked child: the staff flow (52.5.3) with no
 * tag step (the tag list names school staff, which a family must not browse) and only the types
 * about a student. Never sends `on_behalf_of_user_id` or `tags`.
 */
import {
  APPLICATION_TYPES,
  ApplicationAddressee,
  ApplicationSubjectKind,
  ApplicationType,
} from '@biddaloy/shared';
import { captureNotificationTenant, notifyOutcome } from '@biddaloy/ui/api';
import { Card, ChoiceCards, ConfirmDialog, StepIndicator } from '@biddaloy/ui/components';
import {
  useActiveRole,
  useApplicationAddressees,
  useMyStudents,
  type CreateApplicationInput,
} from '@biddaloy/ui/hooks';
import { RegionConfigProvider, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { FullPageShell, useCloseFullPage } from '@biddaloy/ui/shells';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { CircleAlert } from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

import { ApplicationTypeForm } from '../../../features/applications/application-type-form';
import type { ApplicationPayload } from '../../../features/applications/application-type-form';
import { DraftLetterPreview } from '../../../features/applications/draft-letter-preview';
import { canFillApplicationType } from '../../../features/applications/forms/registry';
import { loadRouteNamespaces } from '../../../route-loaders';
import { AttachmentsStep } from '../../_staff/applications/-new/attachments-step';
import { useSubmitNewApplication } from '../../_staff/applications/-new/use-submit-new-application';

const FORM_ID = 'portal-new-application-form';
const STEPS = ['type', 'details', 'attachments', 'preview'] as const;

/** Same search keys as the staff form. */
const portalNewApplicationSearchSchema = z.object({
  type: z.nativeEnum(ApplicationType).optional().catch(undefined),
  student: z.string().uuid().optional().catch(undefined),
});

export const Route = createFileRoute('/portal/applications/new')({
  validateSearch: portalNewApplicationSearchSchema,
  loader: () =>
    loadRouteNamespaces(
      'portalApplications',
      'applications',
      'applicationsNew',
      'applicationForms',
      'leave',
      'feeStructures',
      'common',
    ),
  component: PortalNewApplicationPage,
});

function PortalNewApplicationPage() {
  const search = Route.useSearch();
  const { t } = useTranslation('portalApplications');
  const { t: tApp } = useTranslation('applications');
  const { t: tCommon } = useTranslation('common');
  const navigate = useNavigate();
  const regionConfig = useTenantRegionConfig();
  const role = useActiveRole();
  const submitter = useSubmitNewApplication();
  const studentsQuery = useMyStudents();
  const student = studentsQuery.data?.find((s) => s.id === search.student);

  const backToList = () =>
    void navigate({
      to: '/portal/applications',
      ...(search.student ? { search: { student: search.student } } : {}),
    });
  const close = useCloseFullPage(backToList);

  // The child must be one of mine; anything else goes back to the list, which picks one.
  React.useEffect(() => {
    if (studentsQuery.isSuccess && !student)
      void navigate({ to: '/portal/applications', replace: true });
  }, [studentsQuery.isSuccess, student, navigate]);

  const allowed = (type: ApplicationType) =>
    APPLICATION_TYPES[type].subject.includes(ApplicationSubjectKind.STUDENT) &&
    canFillApplicationType(type, role);
  const startType = search.type && allowed(search.type) ? search.type : undefined;
  const [type, setType] = React.useState<ApplicationType | undefined>(startType);
  const [stepIndex, setStepIndex] = React.useState(startType ? 1 : 0);
  const [payload, setPayload] = React.useState<ApplicationPayload | undefined>(undefined);
  const [addressee, setAddressee] = React.useState<ApplicationAddressee | ''>('');
  const [files, setFiles] = React.useState<File[]>([]);
  const [formDirty, setFormDirty] = React.useState(false);
  const [showErrors, setShowErrors] = React.useState(false);
  const [discardOpen, setDiscardOpen] = React.useState(false);

  const step = STEPS[stepIndex] ?? 'type';
  const needsAddressee = type === ApplicationType.GENERAL;
  const dirty =
    formDirty ||
    payload !== undefined ||
    files.length > 0 ||
    addressee !== '' ||
    (type !== undefined && type !== startType);
  const pending = submitter.pending;

  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const firstRender = React.useRef(true);
  React.useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [stepIndex]);

  function buildBody(): CreateApplicationInput | undefined {
    if (!type || !payload || !student) return undefined;
    const body: CreateApplicationInput = {
      type,
      subject_student_id: student.id,
      payload: { ...payload },
    };
    if (needsAddressee && addressee) body.addressee = addressee;
    return body;
  }

  // Built once the flow reaches the preview, so the letter is asked for once, not per keystroke.
  const previewBody = React.useMemo(
    () => (step === 'preview' ? buildBody() : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the inputs are frozen on this step
    [step],
  );

  const go = (delta: number) => {
    submitter.reset();
    setShowErrors(false);
    setStepIndex((i) => Math.min(STEPS.length - 1, Math.max(0, i + delta)));
  };

  async function submit() {
    const body = buildBody();
    if (!body) return;
    const tenantId = captureNotificationTenant();
    const app = await submitter.run(body, files);
    if (!app) return;
    notifyOutcome({
      tenantId,
      variant: 'success',
      message: t('new.success', { serial: app.serial }),
    });
    void navigate({ to: '/portal/applications/$applicationId', params: { applicationId: app.id } });
  }

  function onPrimary() {
    if (step === 'type') {
      if (type) go(1);
    } else if (step === 'details') {
      setShowErrors(true);
      if (needsAddressee && !addressee) return;
      (document.getElementById(FORM_ID) as HTMLFormElement | null)?.requestSubmit();
    } else if (step === 'attachments') {
      go(1);
    } else {
      void submit();
    }
  }

  const lastStep = stepIndex === STEPS.length - 1;
  const typeOptions = (Object.keys(APPLICATION_TYPES) as ApplicationType[])
    .filter(allowed)
    .map((value) => ({
      value,
      title: tApp(`types.${value}`),
      description: t(`new.typeHelp.${value}`, { defaultValue: '' }),
    }));

  return (
    <RegionConfigProvider value={regionConfig}>
      <FullPageShell
        title={t('new.title')}
        size="form"
        dirty={dirty && !pending}
        onClose={() => {
          if (!pending) close();
        }}
        secondary={{
          label: stepIndex === 0 ? t('new.actions.cancel') : t('new.actions.back'),
          onClick: () => {
            if (pending) return;
            if (stepIndex > 0) go(-1);
            else if (dirty) setDiscardOpen(true);
            else close();
          },
        }}
        primary={{
          label: lastStep ? t('new.actions.submit') : t('new.actions.next'),
          busy: pending,
          disabled: (step === 'type' && !type) || !student,
          onClick: onPrimary,
        }}
      >
        <div className="flex flex-col gap-6">
          <StepIndicator
            steps={STEPS.map((id) => ({ id, label: t(`new.steps.${id}`) }))}
            current={step}
            progressLabel={t('new.progress', { current: stepIndex + 1, total: STEPS.length })}
          />
          <h2 ref={headingRef} tabIndex={-1} className="text-h2 outline-none">
            {step === 'type' ? t('new.typeHeading') : t(`new.steps.${step}`)}
          </h2>

          {submitter.created && submitter.message && (
            <Card padded role="alert" className="flex items-start gap-2">
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
              <p>
                {t('new.partial')} {submitter.message}{' '}
                <Link
                  to="/portal/applications/$applicationId"
                  params={{ applicationId: submitter.created.id }}
                  className="underline"
                >
                  {t('new.view')}
                </Link>
              </p>
            </Card>
          )}
          {!submitter.created && submitter.message && (
            <p role="alert" className="text-sm text-destructive">
              {submitter.message}
            </p>
          )}

          {step === 'type' && (
            <ChoiceCards
              label={t('new.typeLabel')}
              columns={2}
              value={type}
              options={typeOptions}
              onValueChange={(v) => {
                const next = v as ApplicationType;
                if (next !== type) setPayload(undefined);
                setType(next);
                setAddressee('');
              }}
            />
          )}

          {step === 'details' && type && student && (
            <>
              {needsAddressee && (
                <AddresseeChoice
                  studentId={student.id}
                  value={addressee}
                  onChange={setAddressee}
                  error={showErrors && !addressee}
                />
              )}
              <ApplicationTypeForm
                type={type}
                subject={{
                  kind: 'STUDENT',
                  studentId: student.id,
                  classId: student.class_section.class_id,
                  sectionId: student.class_section_id,
                }}
                formId={FORM_ID}
                {...(payload ? { defaultValues: payload } : {})}
                onDirtyChange={setFormDirty}
                disabled={pending}
                onSubmit={(values) => {
                  if (needsAddressee && !addressee) return;
                  setPayload(values);
                  go(1);
                }}
              />
            </>
          )}

          {step === 'attachments' && <AttachmentsStep files={files} onChange={setFiles} />}

          {step === 'preview' && type && (
            <div className="flex flex-col gap-4">
              {previewBody && <DraftLetterPreview input={previewBody} />}
              <Card padded>
                <h3 className="text-h3">{t('new.summary')}</h3>
                <dl className="mt-2 grid gap-1 sm:grid-cols-[auto_1fr] sm:gap-x-4">
                  <dt className="text-text-secondary">{t('new.type')}</dt>
                  <dd>{tApp(`types.${type}`)}</dd>
                  <dt className="text-text-secondary">{t('new.for')}</dt>
                  <dd>{student?.full_name}</dd>
                  {needsAddressee && addressee && (
                    <>
                      <dt className="text-text-secondary">{t('new.to')}</dt>
                      <dd>{tApp(`addressees.${addressee}`)}</dd>
                    </>
                  )}
                  <dt className="text-text-secondary">{t('new.files')}</dt>
                  <dd>{files.map((f) => f.name).join(', ') || t('new.none')}</dd>
                </dl>
              </Card>
            </div>
          )}
        </div>
      </FullPageShell>
      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title={tCommon('fullPage.discardTitle')}
        description={tCommon('fullPage.discardDescription')}
        confirmLabel={tCommon('fullPage.discardConfirm')}
        cancelLabel={tCommon('fullPage.keepEditing')}
        tone="danger"
        onConfirm={() => {
          if (!pending) close();
        }}
      />
    </RegionConfigProvider>
  );
}

/** GENERAL only (D16): class teacher / headmaster / office. A named staff member is never offered. */
function AddresseeChoice({
  studentId,
  value,
  onChange,
  error,
}: {
  studentId: string;
  value: ApplicationAddressee | '';
  onChange: (value: ApplicationAddressee) => void;
  error: boolean;
}) {
  const { t } = useTranslation('portalApplications');
  const { t: tApp } = useTranslation('applications');
  const addressees = useApplicationAddressees(studentId);
  return (
    <Card padded className="flex flex-col gap-3">
      {addressees.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t('new.loadError')}
        </p>
      )}
      <ChoiceCards
        label={t('new.addresseeLabel')}
        value={value || undefined}
        onValueChange={(v) => onChange(v as ApplicationAddressee)}
        options={(addressees.data ?? [])
          .filter((o) => o.addressee !== 'STAFF_USER')
          .map((o) => ({ value: o.addressee, title: tApp(`addressees.${o.addressee}`) }))}
      />
      {error && (
        <p role="alert" className="text-caption text-destructive">
          {t('new.addresseeRequired')}
        </p>
      )}
    </Card>
  );
}

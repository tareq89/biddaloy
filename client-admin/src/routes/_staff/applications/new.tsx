/**
 * [52.5.2] New application: type, details, addressee and tags, attachments, letter preview,
 * submit. Staff file for themselves; `APPLICATION_MANAGE` also enters paper applications for
 * a student's guardian or another staff member (D8, D46).
 */
import {
  APPLICATION_TYPES,
  ApplicationAddressee,
  ApplicationSubjectKind,
  ApplicationType,
  Permission,
} from '@biddaloy/shared';
import { captureNotificationTenant, notifyOutcome } from '@biddaloy/ui/api';
import { Card, ConfirmDialog, StepIndicator } from '@biddaloy/ui/components';
import {
  useActiveRole,
  useCurrentUser,
  useHasPermission,
  useStudent,
  useUser,
  type CreateApplicationInput,
} from '@biddaloy/ui/hooks';
import { RegionConfigProvider, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { FullPageShell, useCloseFullPage } from '@biddaloy/ui/shells';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { CircleAlert } from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

import { ApplicationTypeForm } from '../../../features/applications/application-type-form';
import type {
  ApplicationPayload,
  ApplicationSubject,
} from '../../../features/applications/application-type-form';
import { DraftLetterPreview } from '../../../features/applications/draft-letter-preview';
import { loadRouteNamespaces } from '../../../route-loaders';

import {
  AddresseeStep,
  EMPTY_ADDRESSEE,
  addresseeError,
  tagInputs,
  type AddresseeState,
} from './-new/addressee-step';
import { AttachmentsStep } from './-new/attachments-step';
import {
  EMPTY_SUBJECT,
  NO_LOGIN,
  SubjectCard,
  subjectErrors,
  type SubjectState,
} from './-new/subject-card';
import { TypeStep } from './-new/type-step';
import { useSubmitNewApplication } from './-new/use-submit-new-application';

const FORM_ID = 'new-application-form';
const STEPS = ['type', 'details', 'addressee', 'attachments', 'preview'] as const;
type StepId = (typeof STEPS)[number];

const newApplicationSearchSchema = z.object({
  type: z.nativeEnum(ApplicationType).optional().catch(undefined),
  student: z.string().uuid().optional().catch(undefined),
  staff: z.string().uuid().optional().catch(undefined),
});

export const Route = createFileRoute('/_staff/applications/new')({
  validateSearch: newApplicationSearchSchema,
  loader: () =>
    loadRouteNamespaces(
      'applicationsNew',
      'applications',
      'applicationsDetail',
      'applicationForms',
      'common',
      'nav',
      'leave',
      'feeStructures',
    ),
  component: NewApplicationPage,
});

function NewApplicationPage() {
  const search = Route.useSearch();
  const { t } = useTranslation('applicationsNew');
  const { t: tCommon } = useTranslation('common');
  const navigate = useNavigate();
  const close = useCloseFullPage(() => void navigate({ to: '/applications' }));
  const regionConfig = useTenantRegionConfig();
  const role = useActiveRole();
  const canManage = useHasPermission(Permission.APPLICATION_MANAGE);
  const meQuery = useCurrentUser();
  const me = meQuery.data;
  const myProfileId = me?.staff_profile_id ?? null;
  const submitter = useSubmitNewApplication();

  // `?type=` is honoured only when this user may file it; then the flow starts at step 2.
  const typeAllowed = (type: ApplicationType | undefined) => {
    if (!type) return false;
    const staff = APPLICATION_TYPES[type].subject.includes(ApplicationSubjectKind.STAFF);
    return staff ? myProfileId !== null || canManage : canManage;
  };
  const [type, setType] = React.useState<ApplicationType | undefined>(undefined);
  const [stepIndex, setStepIndex] = React.useState(0);
  // Applied once, when the user's profile has loaded (it decides what is allowed).
  const seeded = React.useRef(false);
  React.useEffect(() => {
    if (seeded.current || !(meQuery.isSuccess || meQuery.isError)) return;
    seeded.current = true;
    if (search.type && typeAllowed(search.type)) {
      setType(search.type);
      setStepIndex(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seeds once from the URL
  }, [meQuery.isSuccess, meQuery.isError]);
  const [subject, setSubject] = React.useState<SubjectState>({
    ...EMPTY_SUBJECT,
    ...(canManage && search.student ? { studentId: search.student, forStudent: true } : {}),
    ...(canManage && search.staff ? { staffUserId: search.staff, paperStaff: true } : {}),
  });
  const [payload, setPayload] = React.useState<ApplicationPayload | undefined>(undefined);
  const [addressee, setAddressee] = React.useState<AddresseeState>(EMPTY_ADDRESSEE);
  const [files, setFiles] = React.useState<File[]>([]);
  const [formDirty, setFormDirty] = React.useState(false);
  const [showErrors, setShowErrors] = React.useState(false);
  const [discardOpen, setDiscardOpen] = React.useState(false);

  const step: StepId = STEPS[stepIndex] ?? 'type';
  const kinds = type ? APPLICATION_TYPES[type].subject : [];
  const dual =
    kinds.includes(ApplicationSubjectKind.STUDENT) && kinds.includes(ApplicationSubjectKind.STAFF);
  const subjectKind =
    kinds.includes(ApplicationSubjectKind.STUDENT) && (!dual || subject.forStudent)
      ? 'STUDENT'
      : 'STAFF';
  const student = useStudent(subject.studentId || undefined).data;
  const staffUser = useUser(subject.staffUserId || undefined).data;
  const errors = subjectErrors(subjectKind, subject, student, staffUser);
  const paperStaff = subject.paperStaff || myProfileId === null;

  const dirty =
    formDirty ||
    payload !== undefined ||
    files.length > 0 ||
    addressee !== EMPTY_ADDRESSEE ||
    subject.applicant !== '' ||
    subject.applicantName !== '' ||
    (type !== undefined && type !== search.type);

  // Moving between steps lands keyboard / screen-reader users on the new step's heading.
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const firstRender = React.useRef(true);
  React.useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [stepIndex]);

  // The form's subject; absent until the picked student / staff profile has loaded.
  const formSubject: ApplicationSubject | undefined = (() => {
    if (subjectKind === 'STUDENT') {
      return student
        ? {
            kind: 'STUDENT',
            studentId: student.id,
            classId: student.class_section.class_id,
            sectionId: student.class_section_id,
          }
        : undefined;
    }
    const id = paperStaff ? staffUser?.staff_profile_id : myProfileId;
    return id ? { kind: 'STAFF', staffProfileId: id } : undefined;
  })();

  function buildBody(): CreateApplicationInput | undefined {
    if (!type || !payload || !formSubject) return undefined;
    const body: CreateApplicationInput = { type, payload: { ...payload } };
    if (formSubject.kind === 'STUDENT') {
      body.subject_student_id = formSubject.studentId;
      if (subject.applicant === NO_LOGIN) body.applicant_name = subject.applicantName.trim();
      else body.on_behalf_of_user_id = subject.applicant;
    } else {
      body.subject_staff_profile_id = formSubject.staffProfileId;
      if (paperStaff) body.on_behalf_of_user_id = subject.staffUserId;
    }
    if (type === ApplicationType.GENERAL && addressee.addressee) {
      body.addressee = addressee.addressee;
      if (addressee.addressee === ApplicationAddressee.STAFF_USER)
        body.addressee_user_id = addressee.userId;
    }
    return body;
  }

  // Built once the flow reaches the preview, so the letter is asked for once, not per keystroke.
  const previewBody = React.useMemo(
    () => (step === 'preview' ? buildBody() : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the inputs are frozen on this step
    [step],
  );

  const pending = submitter.pending;
  const guardedClose = () => {
    if (!pending) close();
  };

  function goBack() {
    setShowErrors(false);
    setStepIndex((i) => Math.max(0, i - 1));
  }
  function goNext() {
    setShowErrors(false);
    setStepIndex((i) => Math.min(STEPS.length - 1, i + 1));
  }

  async function submit() {
    const body = buildBody();
    if (!body) return;
    const tenantId = captureNotificationTenant();
    const app = await submitter.run(
      { ...body, tags: tagInputs(addressee.tags) } as CreateApplicationInput,
      files,
    );
    if (!app) return;
    notifyOutcome({
      tenantId,
      variant: 'success',
      message: t('submit.success', { serial: app.serial }),
    });
    void navigate({ to: '/applications/$applicationId', params: { applicationId: app.id } });
  }

  function onPrimary() {
    if (step === 'type') {
      if (type) goNext();
    } else if (step === 'details') {
      setShowErrors(true);
      (document.getElementById(FORM_ID) as HTMLFormElement | null)?.requestSubmit();
    } else if (step === 'addressee') {
      if (type && addresseeError(type, addressee)) setShowErrors(true);
      else goNext();
    } else if (step === 'attachments') {
      goNext();
    } else {
      void submit();
    }
  }

  const stepLabels = STEPS.map((id) => ({ id, label: t(`steps.${id}`) }));
  const lastStep = stepIndex === STEPS.length - 1;

  return (
    <RegionConfigProvider value={regionConfig}>
      <FullPageShell
        title={t('title')}
        size="form"
        dirty={dirty && !pending}
        onClose={guardedClose}
        secondary={{
          label: stepIndex === 0 ? t('actions.cancel') : t('actions.back'),
          onClick: () => {
            if (pending) return;
            if (stepIndex > 0) goBack();
            else if (dirty) setDiscardOpen(true);
            else close();
          },
        }}
        primary={{
          label: lastStep ? t('actions.submit') : t('actions.next'),
          busy: pending,
          disabled: step === 'type' && !type,
          onClick: onPrimary,
        }}
      >
        <div className="flex flex-col gap-6">
          <StepIndicator
            steps={stepLabels}
            current={step}
            progressLabel={t('progress', { current: stepIndex + 1, total: STEPS.length })}
          />
          <h2 ref={headingRef} tabIndex={-1} className="text-h2 outline-none">
            {step === 'type' ? t('type.heading') : t(`steps.${step}`)}
          </h2>

          {submitter.created && submitter.message && (
            <Card padded role="alert" className="flex items-start gap-2">
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
              <p>
                {t('submit.partial')} {submitter.message}{' '}
                <Link
                  to="/applications/$applicationId"
                  params={{ applicationId: submitter.created.id }}
                  className="underline"
                >
                  {t('submit.view')}
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
            <TypeStep
              value={type}
              onChange={(next) => {
                if (next !== type) setPayload(undefined);
                setType(next);
                setAddressee(EMPTY_ADDRESSEE);
              }}
              role={role}
              canManage={canManage}
              hasProfile={myProfileId !== null}
            />
          )}

          {step === 'details' && type && (
            <>
              <SubjectCard
                kind={subjectKind}
                state={subject}
                onChange={(patch) => {
                  if (
                    patch.studentId !== undefined ||
                    patch.staffUserId !== undefined ||
                    patch.forStudent !== undefined
                  ) {
                    setPayload(undefined);
                  }
                  setSubject((s) => ({ ...s, ...patch }));
                }}
                student={student}
                canManage={canManage}
                hasProfile={myProfileId !== null}
                dual={dual}
                showErrors={showErrors}
                errors={errors}
              />
              {formSubject && (
                <ApplicationTypeForm
                  type={type}
                  subject={formSubject}
                  formId={FORM_ID}
                  {...(payload ? { defaultValues: payload } : {})}
                  onDirtyChange={setFormDirty}
                  disabled={pending}
                  onSubmit={(values) => {
                    if (Object.keys(errors).length > 0) return;
                    setPayload(values);
                    goNext();
                  }}
                />
              )}
            </>
          )}

          {step === 'addressee' && type && (
            <AddresseeStep
              type={type}
              studentId={subjectKind === 'STUDENT' ? subject.studentId : undefined}
              state={addressee}
              onChange={(patch) => setAddressee((a) => ({ ...a, ...patch }))}
              showErrors={showErrors}
            />
          )}

          {step === 'attachments' && <AttachmentsStep files={files} onChange={setFiles} />}

          {step === 'preview' && type && (
            <div className="flex flex-col gap-4">
              {previewBody && <DraftLetterPreview input={previewBody} />}
              <Card padded>
                <h3 className="text-h3">{t('preview.summary')}</h3>
                <dl className="mt-2 grid gap-1 sm:grid-cols-[auto_1fr] sm:gap-x-4">
                  <SummaryRow label={t('preview.type')} value={<TypeName type={type} />} />
                  <SummaryRow
                    label={t('preview.for')}
                    value={
                      subjectKind === 'STUDENT'
                        ? (student?.full_name ?? '')
                        : paperStaff
                          ? (staffUser?.full_name ?? '')
                          : (me?.full_name ?? '')
                    }
                  />
                  {type === ApplicationType.GENERAL && addressee.addressee && (
                    <SummaryRow
                      label={t('preview.to')}
                      value={<AddresseeName a={addressee.addressee} />}
                    />
                  )}
                  <SummaryRow
                    label={t('preview.tags')}
                    value={addressee.tags.map((x) => x.label).join(', ') || t('preview.none')}
                  />
                  <SummaryRow
                    label={t('preview.files')}
                    value={files.map((f) => f.name).join(', ') || t('preview.none')}
                  />
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
        onConfirm={guardedClose}
      />
    </RegionConfigProvider>
  );
}

function TypeName({ type }: { type: ApplicationType }) {
  const { t } = useTranslation('applications');
  return <>{t(`types.${type}`)}</>;
}

function AddresseeName({ a }: { a: string }) {
  const { t } = useTranslation('applications');
  return <>{t(`addressees.${a}`)}</>;
}

function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <dt className="text-text-secondary">{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

/**
 * [48.3.B-01] "Issue certificate": kind -> details -> preview -> print, in a full-page shell (D12)
 * addressed by `?issue=<kind>&step=`. Printing goes through `/certificates` (serial, D6), never
 * `/print-jobs`. Layout is cloned from the bulk reminder wizard.
 */
import {
  boundIssueFields,
  DocumentKind,
  EnrollmentStatus,
  Permission,
  STUDENT_CERTIFICATE_KINDS,
  validateIssueValues,
  type StudentCertificateKind,
} from '@biddaloy/shared';
import { getActiveTenant } from '@biddaloy/ui/api';
import { ConfirmDialog, Skeleton } from '@biddaloy/ui/components';
import {
  useCertificatePreview,
  useCertificateRegister,
  useCertificateTemplates,
  useHasPermission,
  useLifecycleEvents,
  useSchoolSettings,
  useStudent,
  useStudents,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { FullPageShell, StepIndicator, useWizardShellStep } from '@biddaloy/ui/shells';
import { formatNumber } from '@biddaloy/ui/utils';
import * as React from 'react';

import { currentYear } from '../history/certificate-register';

import { DetailsStep, prefixOfSerial } from './details-step';
import { kindAvailability, type KindAvailability } from './kind-eligibility';
import { KindStep } from './kind-step';
import { PreviewStep, PrintStep, usePrintRun, type IneligibleStudent } from './print-step';

const STEP_IDS = ['kind', 'details', 'preview', 'print'] as const;
type StepId = (typeof STEP_IDS)[number];

export interface IssueCertificateModalProps {
  studentId: string;
  initialKind?: StudentCertificateKind | undefined;
  onClose: () => void;
  /** "Record leaving" fix link of the TC card: the host closes this and opens the Leave dialog. */
  onRecordLeaving: () => void;
}

export function IssueCertificateModal({
  studentId,
  initialKind,
  onClose,
  onRecordLeaving,
}: IssueCertificateModalProps) {
  const { t } = useTranslation('certificates');
  const { t: tKind } = useTranslation('printHistory');
  const { t: tEditor } = useTranslation('printEditor');
  const { t: tc } = useTranslation('common');
  const region = useRegionConfig();
  const canManageTemplates = useHasPermission(Permission.PRINT_TEMPLATE_MANAGE);
  const canManageSettings = useHasPermission(Permission.SETTINGS_MANAGE);

  const studentQuery = useStudent(studentId);
  const student = studentQuery.data;
  const events = useLifecycleEvents(studentId);
  const [stepId, setStepId] = useWizardShellStep(STEP_IDS);

  // --- step 1: which kind ---------------------------------------------------------------
  const [kind, setKind] = React.useState<DocumentKind | undefined>(initialKind);
  const tplTC = useCertificateTemplates(DocumentKind.TRANSFER_CERTIFICATE);
  const tplTM = useCertificateTemplates(DocumentKind.TESTIMONIAL);
  const tplCH = useCertificateTemplates(DocumentKind.CHARACTER_CERTIFICATE);
  const tplST = useCertificateTemplates(DocumentKind.STUDY_CERTIFICATE);
  const tplPA = useCertificateTemplates(DocumentKind.PARTICIPATION_CERTIFICATE);
  const templatesByKind: Record<string, typeof tplTC> = {
    [DocumentKind.TRANSFER_CERTIFICATE]: tplTC,
    [DocumentKind.TESTIMONIAL]: tplTM,
    [DocumentKind.CHARACTER_CERTIFICATE]: tplCH,
    [DocumentKind.STUDY_CERTIFICATE]: tplST,
    [DocumentKind.PARTICIPATION_CERTIFICATE]: tplPA,
  };
  const availability: Record<string, KindAvailability> = {};
  for (const k of STUDENT_CERTIFICATE_KINDS) {
    availability[k] = kindAvailability(k, {
      enrollmentStatus: student?.enrollment_status ?? EnrollmentStatus.ACTIVE,
      events: events.data ?? [],
      hasTemplate: (templatesByKind[k]?.data?.length ?? 0) > 0,
    });
  }
  const kindOk = kind !== undefined && availability[kind]?.ok === true;
  const loadingKinds =
    studentQuery.isPending ||
    events.isPending ||
    Object.values(templatesByKind).some((q) => q.isPending);

  // --- step 2: template, typed values -----------------------------------------------------
  const templates = React.useMemo(
    () =>
      [...(kind ? (templatesByKind[kind]?.data ?? []) : [])].sort(
        (a, b) => Number(b.is_default) - Number(a.is_default),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kind, tplTC.data, tplTM.data, tplCH.data, tplST.data, tplPA.data],
  );
  const [pickedTemplateId, setPickedTemplateId] = React.useState<string | undefined>(undefined);
  const template = templates.find((x) => x.id === pickedTemplateId) ?? templates[0];
  const templateId = template?.id;
  const [rawValues, setValues] = React.useState<Record<string, string>>({});

  const detailsPreview = useCertificatePreview();
  const { mutate: loadDetails } = detailsPreview;
  React.useEffect(() => {
    if (!templateId) return;
    loadDetails({ template_id: templateId, subject_type: 'STUDENT', subject_ids: [studentId] });
  }, [templateId, studentId, loadDetails]);
  const definition = detailsPreview.data?.template.version.definition;
  const fields = React.useMemo(
    () => (definition && kind ? boundIssueFields(definition, kind) : []),
    [definition, kind],
  );
  // Only the keys this template binds go on the wire (a value typed under another template is dropped).
  const values = React.useMemo(
    () =>
      Object.fromEntries(fields.map((f) => [f.key, rawValues[f.key] ?? ''] as const)) as Record<
        string,
        string
      >,
    [fields, rawValues],
  );
  const fieldLabel = (key: string) => tEditor(`fields.${key}`, { defaultValue: key });

  const [attempted, setAttempted] = React.useState(false);
  const errors: Record<string, string> = {};
  if (definition && kind) {
    for (const e of validateIssueValues(definition, kind, values)) {
      const key = e.slice(0, e.indexOf(':'));
      const f = fields.find((x) => x.key === key);
      if (!f || errors[key]) continue;
      errors[key] = e.includes('required')
        ? t('fields.required', { field: fieldLabel(key) })
        : t('fields.tooLong', { max: formatNumber(f.issueTime?.maxLength ?? 0, region) });
    }
  }
  const valid = Object.keys(errors).length === 0;

  const profileValues = (
    detailsPreview.data?.items[0] ? Object.entries(detailsPreview.data.items[0].values) : []
  )
    .filter(
      ([k, v]) =>
        k.startsWith('student.') && k !== 'student.photo' && typeof v === 'string' && v !== '',
    )
    .map(([key, v]) => ({ key, value: v as string }));

  // --- serial card -------------------------------------------------------------------------
  // The school's calendar year, the same one the register defaults to (the server uses Dhaka's).
  const year = currentYear(region);
  const register = useCertificateRegister({
    ...(kind ? { document_kind: kind } : {}),
    year,
    limit: 1,
  });
  // Newest serial first: its number is how many certificates (copy 1) this kind has this year,
  // since serials are max + 1. The register's `total` also counts reprinted copies.
  const latest = register.data?.data[0];
  const issuedCount = latest?.serial_no ?? 0;
  // The prefix comes from the settings; only someone who cannot read them gets the last serial's.
  const settings = useSchoolSettings(canManageSettings ? (getActiveTenant() ?? '') : '');
  const serialPrefix = settings.data
    ? settings.data.documents?.serialPrefix || undefined
    : prefixOfSerial(latest?.serial);

  // --- bulk (D22) ----------------------------------------------------------------------------
  const [bulk, setBulk] = React.useState(false);
  const classId = student?.class_section?.class_id;
  const className = student?.class_section?.class?.name ?? '';
  const wantsGraduated = kind === DocumentKind.TESTIMONIAL;
  const classActive = useStudents(
    { ...(classId ? { class_id: classId } : {}), enrollment_status: 'ACTIVE', limit: 1000 },
    { enabled: bulk && Boolean(classId) },
  );
  const classGraduated = useStudents(
    { ...(classId ? { class_id: classId } : {}), enrollment_status: 'GRADUATED', limit: 1000 },
    { enabled: bulk && Boolean(classId) && wantsGraduated },
  );
  const [excluded, setExcluded] = React.useState<ReadonlySet<string>>(new Set());
  const [ineligible, setIneligible] = React.useState<IneligibleStudent[]>([]);
  const classmates = React.useMemo(
    () =>
      [
        ...(classActive.data?.data ?? []),
        ...(wantsGraduated ? (classGraduated.data?.data ?? []) : []),
      ].sort(
        (a, b) =>
          a.class_section.section_name.localeCompare(b.class_section.section_name) ||
          a.roll_number - b.roll_number,
      ),
    [classActive.data, classGraduated.data, wantsGraduated],
  );
  const bulkLoading =
    bulk && (classActive.isPending || (wantsGraduated && classGraduated.isPending));
  // The list call is one page of 1000 (the server has no cap); a bigger class must not be issued short.
  const bulkTooMany =
    bulk &&
    !bulkLoading &&
    ((classActive.data?.total ?? 0) > (classActive.data?.data.length ?? 0) ||
      (wantsGraduated &&
        (classGraduated.data?.total ?? 0) > (classGraduated.data?.data.length ?? 0)));
  // The student whose page this is always stays in: a TC or character certificate is often for
  // someone who already left, so they are not among the class's ACTIVE students.
  const subjectIds = (
    bulk
      ? classmates.some((s) => s.id === studentId)
        ? classmates.map((s) => s.id)
        : [studentId, ...classmates.map((s) => s.id)]
      : [studentId]
  ).filter((id) => !excluded.has(id));
  const nameOf = (id: string) =>
    id === studentId
      ? (student?.full_name ?? id)
      : (classmates.find((s) => s.id === id)?.full_name ?? id);

  // --- step 3: the preview with the typed values -----------------------------------------------
  const renderPreview = useCertificatePreview();
  const { mutate: loadRender } = renderPreview;
  const valuesKey = JSON.stringify(values);
  // Preview and print need valid details: a step click or a `?step=print` link must not skip them.
  const detailsOk =
    valid && Boolean(definition) && subjectIds.length > 0 && !bulkLoading && !bulkTooMany;
  const requestedStepId: StepId =
    kind && kindOk ? ((STEP_IDS.includes(stepId as StepId) ? stepId : 'kind') as StepId) : 'kind';
  const blockedAhead = STEP_IDS.indexOf(requestedStepId) > 1 && !detailsOk;
  const currentStepId: StepId = blockedAhead ? 'details' : requestedStepId;
  const currentIndex = STEP_IDS.indexOf(currentStepId);
  // Move the URL back too, so the wizard does not jump ahead the moment the details become valid.
  React.useEffect(() => {
    if (blockedAhead) setStepId('details');
  }, [blockedAhead, setStepId]);
  React.useEffect(() => {
    if (currentStepId !== 'preview' || !templateId) return;
    loadRender({
      template_id: templateId,
      subject_type: 'STUDENT',
      subject_ids: [studentId],
      issue_values: JSON.parse(valuesKey) as Record<string, string>,
    });
  }, [currentStepId, templateId, studentId, valuesKey, loadRender]);

  // --- step 4: print ---------------------------------------------------------------------------
  const run = usePrintRun({
    templateId,
    subjectIds,
    issueValues: values,
    batchSize: detailsPreview.data?.template.batch_size ?? 1,
    title: kind ? tKind(`kind.${kind}`) : t('issue.titleNoKind'),
    onIneligible: (students) => {
      setIneligible(students);
      setExcluded((prev) => new Set([...prev, ...students.map((s) => s.id)]));
      setStepId('details');
    },
  });

  // --- shell -----------------------------------------------------------------------------------
  const announcementRef = React.useRef<HTMLHeadingElement>(null);
  // Focus the step heading on open and on every step change (the footer button is the same
  // element across steps, so focus would otherwise stay at the bottom). A tick later, so it
  // wins over the dialog's own first-focus.
  React.useEffect(() => {
    const id = window.setTimeout(() => announcementRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [currentStepId]);

  const [discardOpen, setDiscardOpen] = React.useState(false);
  const dirty =
    !run.done && (Object.values(values).some((v) => v !== '') || run.pending || run.confirmed > 0);
  const goTo = (id: StepId) => setStepId(id);
  const next = STEP_IDS[currentIndex + 1];
  const previous = STEP_IDS[currentIndex - 1];

  const stepLabels: Record<StepId, string> = {
    kind: t('steps.kind'),
    details: t('steps.details'),
    preview: t('steps.preview'),
    print: t('steps.print'),
  };

  let primary: React.ComponentProps<typeof FullPageShell>['primary'];
  if (run.done) {
    primary = { label: t('actions.close'), onClick: onClose };
  } else if (currentStepId === 'kind') {
    primary = { label: t('actions.next'), onClick: () => goTo('details'), disabled: !kindOk };
  } else if (currentStepId === 'details') {
    primary = {
      label: t('actions.preview'),
      disabled: subjectIds.length === 0 || bulkLoading || bulkTooMany,
      onClick: () => {
        setAttempted(true);
        if (valid && definition) goTo('preview');
      },
    };
  } else if (currentStepId === 'preview') {
    primary = {
      label: t('actions.next'),
      onClick: () => next && goTo(next),
      disabled: !renderPreview.data,
    };
  } else {
    primary = {
      label: t('actions.print'),
      onClick: run.print,
      busy: run.printing,
      disabled: !run.canPrint,
    };
  }
  const secondary = run.done
    ? undefined
    : previous
      ? { label: t('actions.back'), onClick: () => goTo(previous), disabled: run.pending }
      : { label: tc('actions.cancel'), onClick: () => (dirty ? setDiscardOpen(true) : onClose()) };

  const header = student ? (
    <div>
      <p className="text-h2">{student.full_name}</p>
      <p className="text-text-secondary">
        {t('header.line', {
          class: className,
          section: student.class_section?.section_name ?? '',
          roll: formatNumber(student.roll_number, region),
          reg: student.registration_number,
        })}
      </p>
    </div>
  ) : null;

  return (
    <FullPageShell
      title={kind ? t('issue.title', { kind: tKind(`kind.${kind}`) }) : t('issue.titleNoKind')}
      size="wide"
      onClose={onClose}
      dirty={dirty}
      primary={primary}
      {...(secondary ? { secondary } : {})}
    >
      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        tone="danger"
        title={tc('fullPage.discardTitle')}
        description={tc('fullPage.discardDescription')}
        confirmLabel={tc('fullPage.discardConfirm')}
        cancelLabel={tc('fullPage.keepEditing')}
        onConfirm={() => {
          setDiscardOpen(false);
          onClose();
        }}
      />
      <div className="flex flex-col gap-6">
        {header}
        <StepIndicator
          label={t('steps.label')}
          steps={STEP_IDS.map((id) => ({ id, label: stepLabels[id] }))}
          currentStepId={currentStepId}
          onStepChange={(id) => {
            if (run.pending) return;
            if (STEP_IDS.indexOf(id as StepId) > 1 && !detailsOk) {
              setAttempted(true);
              return;
            }
            goTo(id as StepId);
          }}
        />
        <h2 ref={announcementRef} tabIndex={-1} className="sr-only">
          {t('steps.counter', {
            n: formatNumber(currentIndex + 1, region),
            total: formatNumber(STEP_IDS.length, region),
          })}{' '}
          {stepLabels[currentStepId]}
        </h2>

        {currentStepId === 'kind' ? (
          loadingKinds ? (
            <Skeleton role="status" aria-label={tc('loading')} className="h-40 w-full" />
          ) : (
            <KindStep
              value={kind}
              onChange={(k) => {
                setKind(k);
                setPickedTemplateId(undefined);
                setAttempted(false);
                setBulk(false);
                setExcluded(new Set());
                setIneligible([]);
              }}
              availability={availability}
              canManageTemplates={canManageTemplates}
              onRecordLeaving={onRecordLeaving}
            />
          )
        ) : null}

        {currentStepId === 'details' && kind ? (
          <DetailsStep
            studentId={studentId}
            studentName={student?.full_name ?? ''}
            kind={kind}
            kindLabel={tKind(`kind.${kind}`)}
            templates={templates}
            templateId={templateId}
            onTemplateChange={(id) => setPickedTemplateId(id)}
            fields={fields}
            values={values}
            onValueChange={(key, value) => setValues((prev) => ({ ...prev, [key]: value }))}
            errors={attempted ? errors : {}}
            fieldLabel={fieldLabel}
            profileValues={profileValues}
            year={year}
            latest={latest}
            serialPrefix={serialPrefix}
            issuedCount={issuedCount}
            bulk={
              // A TC is one leaving student, never a whole class.
              classId && kind !== DocumentKind.TRANSFER_CERTIFICATE
                ? {
                    className,
                    count: subjectIds.length,
                    enabled: bulk,
                    loading: bulkLoading,
                    tooMany: bulkTooMany,
                    onToggle: () => setBulk((b) => !b),
                  }
                : undefined
            }
            ineligible={ineligible.map((s) => ({ ...s, name: nameOf(s.id) }))}
          />
        ) : null}

        {currentStepId === 'preview' ? (
          <PreviewStep
            preview={renderPreview.data}
            loading={renderPreview.isPending}
            error={renderPreview.isError}
            onRetry={() =>
              templateId &&
              loadRender({
                template_id: templateId,
                subject_type: 'STUDENT',
                subject_ids: [studentId],
                issue_values: values,
              })
            }
          />
        ) : null}

        {currentStepId === 'print' ? (
          <PrintStep run={run} canManageSettings={canManageSettings} />
        ) : null}
      </div>
    </FullPageShell>
  );
}

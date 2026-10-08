/**
 * [66.3.04] Create a study plan: Scope → Start → Preview, as a `FullPageShell` over the
 * Syllabus page (`?tab=plans&new=1`). Nothing is saved before Save; every start point ends on
 * the new plan's page. `?template=<id>` opens the Start step on that library template.
 */
import { apiClient, captureNotificationTenant, notifyOutcome } from '@biddaloy/ui/api';
import { ConfirmDialog, NoticeBar, Stepper } from '@biddaloy/ui/components';
import {
  invalidateStudyPlanViews,
  studyPlanListQueryOptions,
  useAcademicYears,
  useClasses,
  useClassSections,
  useCopyStudyPlanTemplate,
  useCreateStudyPlan,
  useStudyPlanCapacity,
  useStudyPlanCarryOver,
  useSubjects,
  useTerms,
  type SaveStudyPlanLessonsInput,
  type StudyPlanDetail,
  type StudyPlanTemplateDetail,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { FullPageShell, useCloseFullPage, useWizardShellStep } from '@biddaloy/ui/shells';
import { toIsoDate } from '@biddaloy/ui/utils';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import * as React from 'react';

import { subjectName } from '../../homework/-subject-name';

import { PreviewStep, type PreviewRow } from './preview-step';
import { ScopeStep, WHOLE_YEAR, emptyScope, type Scope } from './scope-step';
import { StartStep, type CsvController, type StartSource } from './start-step';

const STEP_IDS = ['scope', 'start', 'preview'] as const;
type StepId = (typeof STEP_IDS)[number];

interface LessonSource {
  id?: string | undefined;
  title: string;
  periods: number;
  topic_id?: string | undefined;
  notes?: string | undefined;
}
type LessonInput = SaveStudyPlanLessonsInput['lessons'][number];

const lessonInput = (l: LessonSource): LessonInput => ({
  ...(l.id ? { id: l.id } : {}),
  title: l.title,
  periods: l.periods,
  ...(l.topic_id ? { topic_id: l.topic_id } : {}),
  ...(l.notes ? { notes: l.notes } : {}),
});

export interface CreatePlanWizardProps {
  /** Closes the overlay when there is no in-app history to go back to. */
  onCloseFallback: () => void;
  /** `?template=` */
  template?: string | undefined;
  /** The plans tab's filters, used to prefill the scope. */
  prefill: {
    classId?: string | undefined;
    subjectId?: string | undefined;
    termId?: string | undefined;
  };
}

export function CreatePlanWizard({ onCloseFallback, template, prefill }: CreatePlanWizardProps) {
  const { t, i18n } = useTranslation('studyPlans');
  const { t: tCommon } = useTranslation('common');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const close = useCloseFullPage(onCloseFallback);
  const [step, setStep] = useWizardShellStep(STEP_IDS);
  const stepId = step as StepId;

  const years = useAcademicYears();
  const yearList = years.data?.data ?? [];
  const yearId = (yearList.find((y) => y.is_current) ?? yearList[0])?.id;
  const termsQuery = useTerms(yearId);
  const terms = React.useMemo(() => termsQuery.data ?? [], [termsQuery.data]);
  const classes = useClasses();
  const subjects = useSubjects({ limit: 100 });

  const [scope, setScopeState] = React.useState<Scope>({
    ...emptyScope,
    classId: prefill.classId ?? '',
    subjectId: prefill.subjectId ?? '',
    termId: prefill.termId && prefill.termId !== WHOLE_YEAR ? prefill.termId : '',
  });
  const [touched, setTouched] = React.useState(false);
  const [source, setSource] = React.useState<StartSource>('empty');
  const [templateId, setTemplateId] = React.useState('');
  const [carryOn, setCarryOn] = React.useState(false);
  const [controller, setController] = React.useState<CsvController | undefined>(undefined);
  const [dropped, setDropped] = React.useState<ReadonlySet<string>>(new Set());
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<{
    code?: string | undefined;
    existingId?: string | null | undefined;
  } | null>(null);
  const [discardOpen, setDiscardOpen] = React.useState(false);

  // Default term: the one containing today (only once the terms have loaded).
  React.useEffect(() => {
    if (scope.termId) return;
    if (terms.length === 0) {
      if (termsQuery.isSuccess) setScopeState((s) => ({ ...s, termId: WHOLE_YEAR }));
      return;
    }
    const today = toIsoDate(new Date());
    const current = terms.find((x) => x.start_date <= today && today <= x.end_date);
    if (current) setScopeState((s) => (s.termId ? s : { ...s, termId: current.id }));
  }, [terms, termsQuery.isSuccess, scope.termId]);

  function setScope(next: Scope) {
    setTouched(true);
    setScopeState(next);
    // A different scope makes the chosen start point stale.
    setTemplateId('');
    setCarryOn(false);
    setDropped(new Set());
    setController(undefined);
  }

  // Rows from another start point are a different list: forget what was unticked.
  const stagingId = controller?.result?.staging_id;
  React.useEffect(() => {
    setDropped(new Set());
  }, [templateId, source, stagingId]);

  // Leaving for step 1 unmounts the CSV picker, so forget its result.
  React.useEffect(() => {
    if (stepId === 'scope') setController(undefined);
  }, [stepId]);

  const klass = (classes.data?.data ?? []).find((c) => c.id === scope.classId);
  const sections = useClassSections(scope.classId || undefined);
  const section = (sections.data ?? []).find((s) => s.id === scope.sectionId);
  const subject = (subjects.data?.data ?? []).find((s) => s.id === scope.subjectId);
  const term = terms.find((x) => x.id === scope.termId);
  const scopeValid = !!(scope.sectionId && scope.subjectId && scope.termId);
  const termValue = scope.termId === WHOLE_YEAR ? null : scope.termId;
  const sectionLabel = `${klass?.name ?? ''}-${section?.section_name ?? ''}`;
  const subjectLabel = subjectName(subject, i18n.language);
  const termLabel = term?.name ?? t('list.filters.wholeYear');

  // D27: the earlier term's plan for the same section × subject.
  const plansForScope = useQuery({
    ...studyPlanListQueryOptions({ section_id: scope.sectionId, subject_id: scope.subjectId }),
    enabled: scopeValid,
  });
  const prevPlanId = React.useMemo(() => {
    if (!term) return undefined;
    const candidates = (plansForScope.data?.data ?? [])
      .map((p) => ({ id: p.id, end: terms.find((x) => x.id === p.term?.id)?.end_date }))
      .filter((p): p is { id: string; end: string } => !!p.end && p.end < term.start_date)
      .sort((a, b) => b.end.localeCompare(a.end));
    return candidates[0]?.id;
  }, [plansForScope.data, term, terms]);
  const carryQuery = useStudyPlanCarryOver(prevPlanId ?? '', { enabled: !!prevPlanId });
  const carryLessons = prevPlanId ? (carryQuery.data?.lessons ?? []) : [];
  const carry =
    carryLessons.length > 0
      ? { termName: carryQuery.data?.from_term?.name ?? '', count: carryLessons.length }
      : null;

  const templateQuery = useQuery({
    queryKey: ['study-plan-templates', 'preview', templateId],
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<StudyPlanTemplateDetail>(`/study-plan-templates/${templateId}`, {
          signal,
        })
      ).data,
    enabled: source === 'library' && templateId !== '',
  });

  const carryRows: PreviewRow[] =
    carryOn && carry
      ? carryLessons.map((l, i) => ({
          key: `c-${i}`,
          title: l.title,
          periods: l.periods,
          fromTerm: carry.termName,
        }))
      : [];
  const sourceRows: PreviewRow[] =
    source === 'library'
      ? (templateQuery.data?.lessons ?? []).map((l, i) => ({
          key: `s-${i}`,
          title: l.title,
          periods: l.periods,
        }))
      : source === 'csv'
        ? (controller?.result?.summary.preview ?? []).map((r, i) => ({
            key: `s-${i}`,
            title: r.title,
            periods: r.periods,
          }))
        : [];
  const rows = [...carryRows, ...sourceRows];
  const keptPeriods = rows.filter((r) => !dropped.has(r.key)).reduce((n, r) => n + r.periods, 0);

  const capacityQuery = useStudyPlanCapacity(
    {
      section_id: scope.sectionId,
      subject_id: scope.subjectId,
      ...(termValue ? { academic_term_id: termValue } : {}),
    },
    { enabled: scopeValid && stepId !== 'scope' && rows.length > 0 },
  );
  // The CSV preview is capped by the server, so its period total would undercount.
  const hiddenRows =
    source === 'csv'
      ? Math.max(0, (controller?.result?.summary.rows_to_create ?? 0) - sourceRows.length)
      : 0;
  const capacity =
    capacityQuery.data && keptPeriods > 0 && hiddenRows === 0
      ? { term: termLabel, available: capacityQuery.data.periods_left, needed: keptPeriods }
      : null;

  const csvReady = !!controller?.result && controller.result.hard_error_count === 0;
  const startValid =
    source === 'empty' ||
    (source === 'library' && templateId !== '') ||
    (source === 'csv' && controller?.status === 'preview' && csvReady);

  const createPlan = useCreateStudyPlan();
  const copyTemplate = useCopyStudyPlanTemplate(templateId);

  async function save() {
    setSaving(true);
    setError(null);
    const plan = {
      section_id: scope.sectionId,
      subject_id: scope.subjectId,
      academic_term_id: termValue,
    };
    const keptCarry = carryRows.flatMap((r) => {
      const l = carryLessons[Number(r.key.slice(2))];
      return l && !dropped.has(r.key)
        ? [
            lessonInput({
              title: l.title,
              periods: l.periods,
              topic_id: l.topic_id,
              notes: l.notes,
            }),
          ]
        : [];
    });
    try {
      let created: StudyPlanDetail;
      if (source === 'empty') {
        created = await createPlan.mutateAsync({ ...plan, lessons: keptCarry });
      } else {
        created =
          source === 'library'
            ? await copyTemplate.mutateAsync(plan)
            : // Direct call: the hook's error wrapper drops `ApiError.details`, which the 409 needs.
              (
                await apiClient.post<StudyPlanDetail>('/study-plans/import/commit', {
                  staging_id: controller?.result?.staging_id ?? '',
                  plan,
                })
              ).data;
        invalidateStudyPlanViews(queryClient, { plans: true });
        const keptSource = created.lessons.filter((_, i) => !dropped.has(`s-${i}`));
        if (keptCarry.length > 0 || keptSource.length !== created.lessons.length) {
          try {
            await apiClient.put(`/study-plans/${created.id}/lessons`, {
              lessons: [...keptCarry, ...keptSource.map(lessonInput)],
            });
            invalidateStudyPlanViews(queryClient, { plans: true });
          } catch {
            // The plan exists, so go to it rather than leaving a retry that would 409.
            notifyOutcome({
              tenantId: captureNotificationTenant(),
              variant: 'error',
              message: t('create.errors.partial'),
            });
          }
        }
      }
      // ponytail: the plan page route (3-06) is not in the typed route tree yet.
      void navigate({ to: `/academics/study-plans/${created.id}` as never });
    } catch (e) {
      const details = (e as { details?: { code?: string; existing_id?: string | null } }).details;
      setError({ code: details?.code, existingId: details?.existing_id });
      setSaving(false);
    }
  }

  const stepper = (
    <Stepper
      steps={[
        { id: 'scope', label: t('create.steps.scope') },
        { id: 'start', label: t('create.steps.start') },
        { id: 'preview', label: t('create.steps.preview') },
        { id: 'save', label: t('create.steps.save') },
      ]}
      current={saving ? 'save' : stepId}
      progressLabel={t('create.stepOf', {
        current: saving ? 4 : STEP_IDS.indexOf(stepId) + 1,
        total: 4,
      })}
      label={t('create.title')}
    />
  );

  const dirty = touched || stepId !== 'scope' || source !== 'empty';
  const guardedClose = () => {
    if (!saving) close();
  };
  const onBack = () => {
    if (stepId === 'start') setStep('scope');
    else if (stepId === 'preview') setStep('start');
    else if (dirty) setDiscardOpen(true);
    else close();
  };

  const errorText = (() => {
    if (!error) return null;
    if (error.code === 'STUDY_PLAN_EXISTS')
      return t('create.errors.duplicate', {
        section: sectionLabel,
        subject: subjectLabel,
        term: termLabel,
      });
    if (error.code === 'STUDY_PLAN_OUT_OF_SCOPE')
      return t('create.errors.notYourSubject', { subject: subjectLabel, section: sectionLabel });
    if (error.code === 'STUDY_PLAN_SUBJECT_NOT_OFFERED')
      return t('create.errors.notOffered', { class: klass?.name ?? '', subject: subjectLabel });
    return t('create.errors.generic');
  })();

  const primary =
    stepId === 'preview'
      ? { label: t('create.save'), onClick: () => void save(), busy: saving }
      : {
          label: t('create.next'),
          onClick: () => setStep(stepId === 'scope' ? 'start' : 'preview'),
          disabled: stepId === 'scope' ? !scopeValid : !startValid,
        };

  return (
    <>
      <FullPageShell
        title={t('create.title')}
        size="wide"
        onClose={guardedClose}
        dirty={dirty}
        primary={primary}
        secondary={{ label: t('create.back'), onClick: onBack, disabled: saving }}
      >
        {stepper}
        {errorText && (
          <NoticeBar tone="danger">
            {errorText}{' '}
            {error?.code === 'STUDY_PLAN_EXISTS' && error.existingId && (
              <a
                className="underline"
                href={`/academics/study-plans/${error.existingId}`}
                onClick={(e) => {
                  e.preventDefault();
                  void navigate({ to: `/academics/study-plans/${error.existingId}` as never });
                }}
              >
                {t('create.errors.openExisting')}
              </a>
            )}
          </NoticeBar>
        )}
        {stepId === 'scope' && <ScopeStep scope={scope} onChange={setScope} terms={terms} />}
        {/* Mounted from Start on and only hidden afterwards, so a validated CSV survives Back. */}
        {scopeValid && stepId !== 'scope' && (
          <div hidden={stepId !== 'start'}>
            <StartStep
              summary={`${sectionLabel} · ${subjectLabel} · ${termLabel}`}
              onChangeScope={() => setStep('scope')}
              classId={scope.classId}
              subjectId={scope.subjectId}
              classGrade={klass?.numeric_grade ?? null}
              subjectCode={subject?.code}
              classLabel={klass?.name ?? ''}
              subjectLabel={subjectLabel}
              source={source}
              onSource={setSource}
              templateId={templateId}
              onTemplate={setTemplateId}
              preselectTemplate={template}
              carry={carry}
              carryOn={carryOn}
              onCarryOn={setCarryOn}
              onController={setController}
              capacity={capacity}
            />
          </div>
        )}
        {stepId === 'preview' && (
          <PreviewStep
            rows={rows}
            dropped={dropped}
            onToggle={(key) =>
              setDropped((prev) => {
                const next = new Set(prev);
                if (!next.delete(key)) next.add(key);
                return next;
              })
            }
            capacity={capacity}
            empty={rows.length === 0 && source === 'empty'}
            hiddenRows={hiddenRows}
          />
        )}
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
          setDiscardOpen(false);
          close();
        }}
      />
    </>
  );
}

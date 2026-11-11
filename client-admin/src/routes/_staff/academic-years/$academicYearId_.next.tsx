/**
 * [69.4.03] `/academic-years/$academicYearId/next`: "Create next year" (S1, T1). Name + dates
 * prefilled from the source year, a preview of what will be copied (tick blocks off), Create,
 * then a Done step. Nothing is made before Create; the server runs it all-or-nothing (D13).
 *
 * The file is `$academicYearId_.next` (trailing underscore) so the wizard is its own chromeless
 * page, not a child of the year detail page, which has no outlet.
 */
import { YEAR_ROLLOVER_BLOCKS, type YearRolloverBlock } from '@biddaloy/shared';
import { isNotFoundError } from '@biddaloy/ui/api';
import {
  ErrorState,
  NoticeBar,
  RecordNotFoundState,
  RoutePending,
  Stepper,
} from '@biddaloy/ui/components';
import {
  academicYearQueryOptions,
  useAcademicYear,
  useCreateNextYear,
  useYearRolloverPreview,
  type YearRolloverResult,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { FullPageShell, useCloseFullPage, useWizardShellStep } from '@biddaloy/ui/shells';
import { toIsoDate } from '@biddaloy/ui/utils';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import * as React from 'react';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';

import { DoneStep } from './-next-year/done-step';
import { NameStep, nextYearDates, nextYearName, type NameStepValues } from './-next-year/name-step';
import { PreviewStep } from './-next-year/preview-step';

export const Route = createFileRoute('/_staff/academic-years/$academicYearId_/next')({
  staticData: { chromeless: true },
  loader: ({ context: { queryClient }, params }) =>
    Promise.all([
      queryClient
        .ensureQueryData(academicYearQueryOptions(params.academicYearId))
        .catch(swallowUnlessOffline),
      // 'fees': the Done step's fine-rule copy dialog reads its copy from that namespace.
      loadRouteNamespaces('academicYears', 'common', 'fees'),
    ]),
  pendingComponent: NextYearPending,
  component: NextYearPage,
});

const STEP_IDS = ['name', 'preview', 'done'] as const;
type StepId = (typeof STEP_IDS)[number];

function NextYearPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="form" label={t('routePending.label', { ns: 'nav' })} />;
}

function NextYearPage() {
  const { academicYearId } = Route.useParams();
  const { t } = useTranslation('academicYears');
  const { t: tCommon } = useTranslation('common');
  const navigate = useNavigate();
  const yearQuery = useAcademicYear(academicYearId);

  if (isNotFoundError(yearQuery.error)) {
    return <RecordNotFoundState onBack={() => void navigate({ to: '/academic-years' })} />;
  }
  if (yearQuery.isError) {
    return (
      <ErrorState
        message={t('list.errorMessage')}
        retryLabel={tCommon('actions.retry')}
        onRetry={() => void yearQuery.refetch()}
      />
    );
  }
  if (!yearQuery.data) return <NextYearPending />;
  return <NextYearWizard source={yearQuery.data} />;
}

function NextYearWizard({ source }: { source: { id: string; name: string; end_date: string } }) {
  const { t } = useTranslation('academicYears');
  const navigate = useNavigate();
  const close = useCloseFullPage(() => void navigate({ to: '/academic-years' }));
  const [step, setStep] = useWizardShellStep(STEP_IDS);
  const stepId = step as StepId;

  const [values, setValues] = React.useState<NameStepValues>(() => ({
    name: nextYearName(source.name),
    ...nextYearDates(source.end_date),
  }));
  const [touched, setTouched] = React.useState(false);
  const [nameError, setNameError] = React.useState<string | null>(null);
  const [included, setIncluded] = React.useState<ReadonlySet<YearRolloverBlock>>(
    () => new Set(YEAR_ROLLOVER_BLOCKS),
  );
  const [created, setCreated] = React.useState<
    { id: string; name: string; result: YearRolloverResult } | undefined
  >(undefined);

  const datesOk = values.startDate !== undefined && values.endDate !== undefined;
  const input =
    values.startDate && values.endDate
      ? {
          name: values.name.trim(),
          start_date: toIsoDate(values.startDate),
          end_date: toIsoDate(values.endDate),
        }
      : undefined;

  // The preview always asks for every block, so an unticked block still shows its numbers and
  // can be ticked again; only Create sends the ticked subset.
  const preview = useYearRolloverPreview(source.id, stepId === 'preview' ? input : undefined);
  const createNext = useCreateNextYear(source.id);

  function validateName(): boolean {
    if (values.name.trim() === '') return fail(t('nextYear.errorNameRequired'));
    if (!datesOk) return fail(t('nextYear.errorDatesRequired'));
    if (values.endDate! <= values.startDate!) return fail(t('nextYear.errorEndBeforeStart'));
    setNameError(null);
    return true;
  }
  function fail(message: string) {
    setNameError(message);
    return false;
  }

  function create() {
    if (!input || included.size === 0) return;
    createNext.mutate(
      { ...input, include: YEAR_ROLLOVER_BLOCKS.filter((b) => included.has(b)) },
      {
        onSuccess: (result) => {
          setCreated({ id: result.target_year_id ?? '', name: input.name, result });
          setStep('done');
        },
      },
    );
  }

  const stepper = (
    <Stepper
      steps={STEP_IDS.map((id) => ({ id, label: t(`nextYear.steps.${id}`) }))}
      current={stepId}
      progressLabel={`${STEP_IDS.indexOf(stepId) + 1} / ${STEP_IDS.length}`}
      label={t('nextYear.title')}
    />
  );

  const primary =
    stepId === 'name'
      ? {
          label: t('nextYear.next'),
          onClick: () => {
            if (validateName()) setStep('preview');
          },
        }
      : stepId === 'preview'
        ? {
            label: createNext.isPending ? t('nextYear.creating') : t('nextYear.create'),
            busy: createNext.isPending,
            disabled: included.size === 0 || !preview.isSuccess,
            onClick: create,
          }
        : {
            label: t('nextYear.done.finish'),
            onClick: () =>
              void navigate({
                to: '/academic-years/$academicYearId',
                params: { academicYearId: created?.id ?? source.id },
              }),
          };

  // A deep link to ?step=done with nothing created has nothing to show: start over.
  React.useEffect(() => {
    if (stepId === 'done' && !created) setStep('name');
  }, [stepId, created, setStep]);

  // Focus lands on the content after each step change so Enter goes on to the next step.
  const bodyRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (stepId !== 'name') bodyRef.current?.focus();
  }, [stepId]);
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    const el = e.target as HTMLElement;
    if (el.closest('button, a, textarea, [role="combobox"]')) return;
    e.preventDefault();
    if (!primary.disabled) primary.onClick();
  }

  return (
    <FullPageShell
      title={t('nextYear.title')}
      size="wide"
      onClose={close}
      dirty={touched && stepId !== 'done'}
      primary={primary}
      {...(stepId === 'done'
        ? {}
        : {
            secondary: {
              label: t('nextYear.back'),
              disabled: createNext.isPending,
              onClick: () => (stepId === 'preview' ? setStep('name') : close()),
            },
          })}
    >
      {stepper}
      {/* Enter is a shortcut for the footer's primary button, which stays the accessible control. */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div ref={bodyRef} tabIndex={-1} onKeyDown={onKeyDown} className="space-y-6 outline-none">
        {createNext.isError && <NoticeBar tone="danger">{t('nextYear.createFailed')}</NoticeBar>}
        {stepId === 'name' && (
          <NameStep
            values={values}
            error={nameError}
            onChange={(next) => {
              setTouched(true);
              setValues(next);
            }}
          />
        )}
        {stepId === 'preview' && (
          <PreviewStep
            yearName={source.name}
            preview={preview.data}
            isPending={preview.isPending}
            isError={preview.isError}
            onRetry={() => void preview.refetch()}
            included={included}
            onToggle={(block) =>
              setIncluded((prev) => {
                const next = new Set(prev);
                if (!next.delete(block)) next.add(block);
                return next;
              })
            }
          />
        )}
        {stepId === 'done' && created && (
          <DoneStep yearName={created.name} newYearId={created.id} result={created.result} />
        )}
      </div>
    </FullPageShell>
  );
}

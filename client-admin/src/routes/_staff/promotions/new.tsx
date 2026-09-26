/**
 * [26.6.1] `/promotions/new` — draft a promotion run: source class, target
 * year, target class (D13, suggested + editable), published exams to
 * average (D21), BLOCK/SNAKE (D8), with D14's blocking-reason handling.
 *
 * See the `## Plan — #1003` GitHub comment for the full design. Two
 * points worth restating here since they're easy to get wrong by
 * pattern-matching a different form:
 * - No `useEffect` syncing target year/class to the source class. Each is
 *   a suggested default the user can override, and changing the source
 *   clears the overrides (`changeSource` below).
 * - There is no selectable "Graduate" option. It only ever appears as a
 *   read-only state when the suggestion has `target_class: null` and no
 *   `blocking_reason` — see `2.4` in the plan.
 */
import { PlacementAlgorithm } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  Checkbox,
  Label,
  RadioGroup,
  RadioGroupItem,
  RoutePending,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@biddaloy/ui/components';
import {
  examsQueryOptions,
  useAcademicYears,
  useClasses,
  useCreatePromotionRun,
  useSuggestPromotionTarget,
  type BlockingReason,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import * as React from 'react';
import { z } from 'zod';

import { MutationErrorMessage } from '../../../components/MutationErrorMessage';
import { loadRouteNamespaces } from '../../../route-loaders';

const searchSchema = z.object({ classId: z.string().optional().catch(undefined) });

export const Route = createFileRoute('/_staff/promotions/new')({
  validateSearch: searchSchema,
  loader: () => loadRouteNamespaces('promotions', 'common'),
  pendingComponent: NewPromotionRunPending,
  component: NewPromotionRunPage,
});

const BLOCKING_KEY: Record<BlockingReason, string> = {
  PICK_TARGET_CLASS: 'blocking.pickTargetClass',
  TARGET_SECTIONS_MISSING: 'blocking.targetSectionsMissing',
  RETAIN_CLASS_MISSING: 'blocking.retainClassMissing',
};

const KNOWN_BLOCKING_REASONS = new Set<string>(Object.keys(BLOCKING_KEY));

function isBlockingReason(code: unknown): code is BlockingReason {
  return typeof code === 'string' && KNOWN_BLOCKING_REASONS.has(code);
}

function NewPromotionRunPage() {
  const { t } = useTranslation('promotions');
  const navigate = Route.useNavigate();
  const { classId } = Route.useSearch();

  const [sourceClassId, setSourceClassId] = React.useState<string | undefined>(classId);
  const [targetYearOverride, setTargetYearOverride] = React.useState<string>();
  const [targetClassOverride, setTargetClassOverride] = React.useState<string>();
  const [deselectedExamIds, setDeselectedExamIds] = React.useState<ReadonlySet<string>>(new Set());
  const [algorithm, setAlgorithm] = React.useState<PlacementAlgorithm>(PlacementAlgorithm.BLOCK);

  const mutation = useCreatePromotionRun();

  function changeSource(id: string) {
    if (!id) return;
    mutation.reset();
    setSourceClassId(id);
    setTargetYearOverride(undefined);
    setTargetClassOverride(undefined);
    setDeselectedExamIds(new Set());
  }

  function changeTargetYear(id: string) {
    // Radix `Select`'s hidden native-select fallback can fire `onValueChange`
    // with `''` while syncing to a controlled value that starts empty
    // (before classes/years have loaded) — never treat that as a real pick.
    if (!id) return;
    mutation.reset();
    setTargetYearOverride(id);
    setTargetClassOverride(undefined);
  }

  function changeTargetClass(id: string) {
    if (!id) return;
    mutation.reset();
    setTargetClassOverride(id);
  }

  const classesQuery = useClasses({});
  const yearsQuery = useAcademicYears();
  const classes = classesQuery.data?.data ?? [];
  const years = yearsQuery.data?.data ?? [];

  const sourceClass = classes.find((cls) => cls.id === sourceClassId);
  const sourceYear = years.find((year) => year.id === sourceClass?.academic_year_id);

  const defaultTargetYearId = sourceYear
    ? years
        .filter((year) => year.start_date > sourceYear.start_date)
        .sort((a, b) => (a.start_date < b.start_date ? -1 : 1))[0]?.id
    : undefined;
  const targetYearId = targetYearOverride ?? defaultTargetYearId;
  const targetYearName = years.find((year) => year.id === targetYearId)?.name;

  const suggestion = useSuggestPromotionTarget(sourceClassId, targetYearId);

  const targetClassesQuery = useClasses(targetYearId ? { academic_year_id: targetYearId } : {});
  const targetClasses = targetYearId ? (targetClassesQuery.data?.data ?? []) : [];
  const targetClassId = targetClassOverride ?? suggestion.data?.target_class?.id;

  const examsQuery = useQuery({
    ...examsQueryOptions(
      sourceClass
        ? { class_id: sourceClass.id, academic_year_id: sourceClass.academic_year_id, limit: 100 }
        : {},
    ),
    enabled: sourceClass !== undefined,
  });
  const published = (examsQuery.data?.data ?? []).filter((exam) => exam.status === 'PUBLISHED');
  const selectedExamIds = published
    .filter((exam) => !deselectedExamIds.has(exam.id))
    .map((exam) => exam.id);

  function toggleExam(examId: string, checked: boolean) {
    mutation.reset();
    setDeselectedExamIds((prev) => {
      const next = new Set(prev);
      if (checked) next.delete(examId);
      else next.add(examId);
      return next;
    });
  }

  const suggestionReason = suggestion.data?.blocking_reason;
  const mutationErrorRawCode =
    mutation.error instanceof ApiError ? mutation.error.details?.code : undefined;
  const mutationErrorCode = isBlockingReason(mutationErrorRawCode)
    ? mutationErrorRawCode
    : undefined;
  const reason: BlockingReason | undefined = mutationErrorCode ?? suggestionReason;

  const isBlocked = (() => {
    if (reason === undefined) return false;
    if (reason === 'RETAIN_CLASS_MISSING') return true;
    if (reason === 'PICK_TARGET_CLASS') return targetClassId === undefined;
    if (reason === 'TARGET_SECTIONS_MISSING') {
      return targetClassId === suggestion.data?.target_class?.id;
    }
    return false;
  })();

  const showGraduateReadOnly =
    suggestion.data !== undefined &&
    suggestion.data.target_class === null &&
    suggestion.data.blocking_reason === undefined &&
    targetClassOverride === undefined;

  const otherError =
    mutation.error !== undefined && mutation.error !== null && mutationErrorCode === undefined
      ? mutation.error
      : suggestion.isError
        ? suggestion.error
        : undefined;

  const submitDisabled =
    !sourceClassId ||
    !targetYearId ||
    suggestion.isLoading ||
    selectedExamIds.length === 0 ||
    isBlocked ||
    mutation.isPending;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sourceClassId || !targetYearId) return;
    mutation.mutate(
      {
        source_class_id: sourceClassId,
        target_academic_year_id: targetYearId,
        exam_ids: selectedExamIds,
        algorithm,
        ...(targetClassId !== undefined ? { target_class_id: targetClassId } : {}),
      },
      {
        onSuccess: (run) => {
          void navigate({ to: '/promotions/$runId', params: { runId: run.id } });
        },
      },
    );
  }

  return (
    <div className="mx-auto max-w-xl p-6">
      <h1 className="mb-6 text-lg font-semibold">{t('newRunForm.title')}</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="promotion-source-class">{t('newRunForm.sourceClassLabel')}</Label>
          <Select value={sourceClassId ?? ''} onValueChange={changeSource}>
            <SelectTrigger
              id="promotion-source-class"
              aria-label={t('newRunForm.sourceClassLabel')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {classes.map((cls) => {
                const yearName = years.find((year) => year.id === cls.academic_year_id)?.name;
                return (
                  <SelectItem key={cls.id} value={cls.id}>
                    {yearName ? `${cls.name} (${yearName})` : cls.name}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="promotion-target-year">{t('newRunForm.targetYearLabel')}</Label>
          <Select value={targetYearId ?? ''} onValueChange={changeTargetYear}>
            <SelectTrigger id="promotion-target-year" aria-label={t('newRunForm.targetYearLabel')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((year) => (
                <SelectItem key={year.id} value={year.id}>
                  {year.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t('newRunForm.targetClassLabel')}</span>
          {showGraduateReadOnly ? (
            <p className="text-sm">{t('newRunForm.graduateOption')}</p>
          ) : (
            <Select
              value={targetClassId ?? ''}
              onValueChange={changeTargetClass}
              disabled={!targetYearId}
            >
              <SelectTrigger aria-label={t('newRunForm.targetClassLabel')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {targetClasses.map((cls) => (
                  <SelectItem key={cls.id} value={cls.id}>
                    {cls.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-sm font-medium">{t('newRunForm.examsLabel')}</legend>
          {published.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('newRunForm.noPublishedExams')}</p>
          ) : (
            published.map((exam) => (
              <label key={exam.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={!deselectedExamIds.has(exam.id)}
                  onCheckedChange={(checked) => toggleExam(exam.id, checked === true)}
                />
                {exam.name}
              </label>
            ))
          )}
          {published.length > 0 && selectedExamIds.length === 0 && (
            <p role="alert" className="text-sm text-destructive">
              {t('newRunForm.examsRequired')}
            </p>
          )}
        </fieldset>

        {reason !== undefined && (
          <div role="alert" className="text-sm text-destructive">
            <p>{t(BLOCKING_KEY[reason])}</p>
            {targetYearId && (
              <Link to="/classes" search={{ academic_year_id: targetYearId }} className="underline">
                {t('newRunForm.openClasses', { year: targetYearName ?? '' })}
              </Link>
            )}
          </div>
        )}

        {otherError !== undefined && <MutationErrorMessage error={otherError} />}

        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-sm font-medium">{t('newRunForm.algorithmLabel')}</legend>
          <RadioGroup
            aria-label={t('newRunForm.algorithmLabel')}
            value={algorithm}
            onValueChange={(value) => setAlgorithm(value as PlacementAlgorithm)}
            className="flex flex-col gap-1.5"
          >
            <span className="flex items-center gap-2 text-sm">
              <RadioGroupItem
                value={PlacementAlgorithm.BLOCK}
                aria-label={t('newRunForm.algorithmBlock')}
              />
              {t('newRunForm.algorithmBlock')}
            </span>
            <span className="flex items-center gap-2 text-sm">
              <RadioGroupItem
                value={PlacementAlgorithm.SNAKE}
                aria-label={t('newRunForm.algorithmSnake')}
              />
              {t('newRunForm.algorithmSnake')}
            </span>
          </RadioGroup>
        </fieldset>

        <div className="flex gap-2">
          <Button type="submit" disabled={submitDisabled}>
            {t('newRunForm.create')}
          </Button>
          <Button type="button" variant="outline" asChild>
            <Link to="/promotions">{t('newRunForm.cancel')}</Link>
          </Button>
        </div>
      </form>
    </div>
  );
}

function NewPromotionRunPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="form" label={t('routePending.label', { ns: 'nav' })} />;
}

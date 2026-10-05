/**
 * Scale editor — [20.3.1]. Band table + coverage bar, save blocked while
 * the coverage is incomplete (the server's own problem list, all shown
 * at once, not one error at a time). An empty scale offers "Start from
 * BD NCTB" — a common Bangladeshi grading scale, prefilled and still
 * editable before saving, never written silently.
 *
 * [31.4.marks-4b] Kit detail header (year, class, grade count), Save as the
 * one primary in the header (disabled until a change), translated problem
 * sentences, a leave guard for unsaved rows and a detail-shaped skeleton.
 */
import { Permission } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  RoutePending,
  Skeleton,
} from '@biddaloy/ui/components';
import {
  gradingScaleQueryOptions,
  useAcademicYears,
  useClasses,
  useGradingScale,
  usePreviewBands,
  useHasPermission,
  type BandInput,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { DetailShell, PageContainer } from '@biddaloy/ui/shells';
import { formatNumber } from '@biddaloy/ui/utils';
import { createFileRoute, useBlocker } from '@tanstack/react-router';
import { CopyIcon, ListPlusIcon, SaveIcon, TriangleAlertIcon } from 'lucide-react';
import * as React from 'react';

import { MutationErrorMessage } from '../../../components/MutationErrorMessage';
import { PresetWarningBanner } from '../../../components/PresetWarningBanner';
import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';

import { BandEditor, emptyBandAfter } from './-band-editor';
import { CopyScaleDialog } from './-copy-scale-dialog';
import { CoverageBar } from './-coverage-bar';
import { RecomputePreviewDialog } from './-recompute-preview-dialog';

export const Route = createFileRoute('/_staff/grading-scales/$scaleId')({
  loader: ({ context: { queryClient }, params }) =>
    Promise.all([
      queryClient
        .ensureQueryData(gradingScaleQueryOptions(params.scaleId))
        .catch(swallowUnlessOffline),
      loadRouteNamespaces('grading', 'common'),
    ]),
  pendingComponent: ScaleEditorPending,
  component: ScaleEditorPage,
});

// D2's BD NCTB starting point (80/70/60/50/40/33 → A+/A/A-/B/C/D, F below
// 33; GPAs 5/4/3.5/3/2/1/0) — a common local scale, not a hard rule; every
// field stays editable before saving.
const NCTB_BANDS: BandInput[] = [
  {
    percent_from: 80,
    percent_to: 100,
    grade: 'A+',
    gpa: 5,
    is_fail: false,
    sequence: 1,
    comment: null,
  },
  {
    percent_from: 70,
    percent_to: 79,
    grade: 'A',
    gpa: 4,
    is_fail: false,
    sequence: 2,
    comment: null,
  },
  {
    percent_from: 60,
    percent_to: 69,
    grade: 'A-',
    gpa: 3.5,
    is_fail: false,
    sequence: 3,
    comment: null,
  },
  {
    percent_from: 50,
    percent_to: 59,
    grade: 'B',
    gpa: 3,
    is_fail: false,
    sequence: 4,
    comment: null,
  },
  {
    percent_from: 40,
    percent_to: 49,
    grade: 'C',
    gpa: 2,
    is_fail: false,
    sequence: 5,
    comment: null,
  },
  {
    percent_from: 33,
    percent_to: 39,
    grade: 'D',
    gpa: 1,
    is_fail: false,
    sequence: 6,
    comment: null,
  },
  {
    percent_from: 0,
    percent_to: 32,
    grade: 'F',
    // null, not 0 (D4): a fail band never computes a GPA. Matches the
    // seeded BD_NCTB_BANDS (server/src/scripts/seed.util.ts) and the copy
    // path, both of which already leave this null — a UI-created scale
    // starting from this preset must store the same semantics.
    gpa: null,
    is_fail: true,
    sequence: 7,
    comment: null,
  },
];

function toBandInput(band: {
  percent_from: number;
  percent_to: number;
  grade: string;
  gpa: number | null;
  is_fail: boolean;
  sequence: number;
  comment: string | null;
}): BandInput {
  return {
    percent_from: band.percent_from,
    percent_to: band.percent_to,
    grade: band.grade,
    gpa: band.gpa,
    is_fail: band.is_fail,
    sequence: band.sequence,
    comment: band.comment,
  };
}

function ScaleEditorPage() {
  const { scaleId } = Route.useParams();
  const { t } = useTranslation('grading');
  const config = useRegionConfig();
  const scaleQuery = useGradingScale(scaleId);
  const canManage = useHasPermission(Permission.GRADING_SCALE_MANAGE);
  // The banner's status call is ADMIN-only; skip it for other viewers.
  const canSeePresetBanner = useHasPermission(Permission.CURRICULUM_PRESET_APPLY);
  // B13: the server caps the page size at 100.
  const yearsQuery = useAcademicYears({ limit: 100 });
  const classesQuery = useClasses();

  const [bands, setBands] = React.useState<BandInput[] | undefined>(undefined);
  const [copyOpen, setCopyOpen] = React.useState(false);
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [affectedCount, setAffectedCount] = React.useState(0);
  // Set once a save is confirmed, so the refetch that follows is not a "leave".
  const savedRef = React.useRef(false);

  // Local edit buffer seeded once the scale loads — bands live client-side
  // until Save, same as any other form (D-decision: whole-set replace, not
  // per-row autosave).
  React.useEffect(() => {
    if (scaleQuery.data && bands === undefined) {
      setBands(scaleQuery.data.bands.map(toBandInput));
    }
  }, [scaleQuery.data, bands]);

  function changeBands(next: BandInput[]) {
    savedRef.current = false;
    setBands(next);
  }

  const previewBands = usePreviewBands(scaleId);

  const dirty =
    bands !== undefined &&
    scaleQuery.data !== undefined &&
    JSON.stringify(bands) !== JSON.stringify(scaleQuery.data.bands.map(toBandInput));
  const blocker = useBlocker({
    shouldBlockFn: () => dirty && !savedRef.current,
    withResolver: true,
  });

  if (scaleQuery.isError) {
    const forbidden = scaleQuery.error instanceof ApiError && scaleQuery.error.statusCode === 403;
    return (
      <PageContainer>
        <ErrorState
          message={forbidden ? t('detail.forbidden') : t('detail.errorMessage')}
          onRetry={() => void scaleQuery.refetch()}
        />
      </PageContainer>
    );
  }

  if (scaleQuery.isPending || bands === undefined) {
    return (
      <PageContainer>
        <div aria-busy="true" className="space-y-4">
          <Skeleton className="h-7 w-64" />
          <div className="flex gap-6">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-4 w-24" />
            ))}
          </div>
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </PageContainer>
    );
  }

  const scale = scaleQuery.data;
  // A name, a skeleton while the lookup loads, or a dash. Never an id.
  const yearName = yearsQuery.isPending ? (
    <Skeleton className="h-3 w-16" />
  ) : (
    (yearsQuery.data?.data.find((y) => y.id === scale.academic_year_id)?.name ?? '—')
  );
  const className = !scale.class_id ? (
    t('list.yearDefault')
  ) : classesQuery.isPending ? (
    <Skeleton className="h-3 w-16" />
  ) : (
    (classesQuery.data?.data.find((c) => c.id === scale.class_id)?.name ?? '—')
  );

  async function handleSave() {
    let result;
    try {
      result = await previewBands.mutateAsync(bands ?? []);
    } catch {
      // A network/API failure here is rendered below from
      // `previewBands.isError` (`MutationErrorMessage`) — nothing further
      // to do in this handler than stop, not let the rejection go unhandled.
      return;
    }
    if (!result.valid) return; // problems render below from previewBands.data
    setAffectedCount(result.affected_result_count > 0 ? result.affected_result_count : 0);
    setPreviewOpen(true);
  }

  const problems = previewBands.data?.problems ?? [];
  const hasProblems = previewBands.data !== undefined && !previewBands.data.valid;
  // The server's own sentence is English; show ours, chosen by the problem type.
  const problemText = (problem: { type: string; index?: number }) =>
    t(`detail.problems.${problem.type}`, {
      row: problem.index === undefined ? '' : formatNumber(problem.index + 1, config),
      defaultValue: t('detail.problems.unknown'),
    });

  return (
    <>
      <DetailShell
        name={scale.name}
        facts={[
          { label: t('detail.facts.academicYear'), value: yearName },
          { label: t('detail.facts.appliesTo'), value: className },
          {
            label: t('detail.facts.grades'),
            value: t('list.bandCount', {
              count: bands.length,
              n: formatNumber(bands.length, config),
            }),
          },
        ]}
        actions={[
          {
            id: 'copy',
            label: t('detail.copy'),
            icon: <CopyIcon />,
            onClick: () => setCopyOpen(true),
            allowed: canManage,
          },
          {
            id: 'save',
            label: t('detail.save'),
            priority: 'primary',
            icon: <SaveIcon />,
            onClick: () => void handleSave(),
            allowed: canManage,
            disabled: !dirty || previewBands.isPending,
            busy: previewBands.isPending,
          },
        ]}
      >
        {canSeePresetBanner && <PresetWarningBanner />}

        {hasProblems && (
          <div
            role="alert"
            className="flex gap-2 rounded-lg bg-status-overdue-bg p-3 text-status-overdue-fg"
          >
            <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="font-medium">{t('detail.problemsHeading')}</p>
              <ul className="list-disc ps-5">
                {problems.map((problem, index) => (
                  <li key={index}>{problemText(problem)}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {previewBands.isError && <MutationErrorMessage error={previewBands.error} />}

        <CoverageBar bands={bands} />

        <section className="space-y-3" aria-labelledby="bands-title">
          <div>
            <h2 id="bands-title" className="text-h2">
              {t('bandEditor.title')}
            </h2>
            <p className="mt-1 text-text-secondary">{t('bandEditor.help')}</p>
          </div>
          {bands.length === 0 ? (
            <EmptyState
              icon={<ListPlusIcon />}
              title={t('detail.emptyTitle')}
              explanation={t('detail.emptyText')}
              action={{
                label: t('detail.startFromNctb'),
                onClick: () => changeBands(NCTB_BANDS.map((band) => ({ ...band }))),
              }}
              secondaryAction={{
                label: t('bandEditor.addBand'),
                onClick: () => changeBands([emptyBandAfter([])]),
              }}
            />
          ) : (
            <BandEditor bands={bands} onChange={changeBands} />
          )}
        </section>
      </DetailShell>

      {canManage && copyOpen && (
        <CopyScaleDialog
          open={copyOpen}
          onOpenChange={setCopyOpen}
          sourceScale={scale}
          onCopied={() => setCopyOpen(false)}
        />
      )}

      {canManage && previewOpen && (
        <RecomputePreviewDialog
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          scaleId={scaleId}
          bands={bands}
          affectedResultCount={affectedCount}
          onConfirmed={() => {
            savedRef.current = true;
            setPreviewOpen(false);
          }}
        />
      )}

      <ConfirmDialog
        open={blocker.status === 'blocked'}
        tone="danger"
        title={t('detail.leaveTitle')}
        description={t('detail.leaveText')}
        cancelLabel={t('detail.stay')}
        confirmLabel={t('detail.leave')}
        onConfirm={() => blocker.proceed?.()}
        onOpenChange={(open) => {
          if (!open) blocker.reset?.();
        }}
      />
    </>
  );
}

function ScaleEditorPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label', { ns: 'nav' })} />;
}

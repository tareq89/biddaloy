/**
 * Scale editor — [20.3.1]. Band table + coverage bar, save blocked while
 * the coverage is incomplete (the server's own problem list, all shown
 * at once, not one error at a time). An empty scale offers "Start from
 * BD NCTB" — a common Bangladeshi grading scale, prefilled and still
 * editable before saving, never written silently.
 */
import { Permission } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import { Button, ErrorState, RoutePending, Skeleton } from '@biddaloy/ui/components';
import {
  gradingScaleQueryOptions,
  useGradingScale,
  usePreviewBands,
  useHasPermission,
  type BandInput,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';
import * as React from 'react';

import { MutationErrorMessage } from '../../../components/MutationErrorMessage';
import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';

import { BandEditor } from './-band-editor';
import { CopyScaleDialog } from './-copy-scale-dialog';
import { CoverageBar } from './-coverage-bar';
import { RecomputePreviewDialog } from './-recompute-preview-dialog';

export const Route = createFileRoute('/_staff/grading-scales/$scaleId')({
  loader: ({ context: { queryClient }, params }) =>
    Promise.all([
      queryClient
        .ensureQueryData(gradingScaleQueryOptions(params.scaleId))
        .catch(swallowUnlessOffline),
      // `approval` too: saving is approval-gated, and the step-up modal's
      // `useTranslation('approval')` would otherwise suspend the whole page
      // (the only <Suspense> is `I18nProvider`'s) the moment it opens.
      loadRouteNamespaces('grading', 'common', 'approval'),
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
  return { ...band };
}

function ScaleEditorPage() {
  const { scaleId } = Route.useParams();
  const { t } = useTranslation('grading');
  const scaleQuery = useGradingScale(scaleId);
  const canManage = useHasPermission(Permission.GRADING_SCALE_MANAGE);

  const [bands, setBands] = React.useState<BandInput[] | undefined>(undefined);
  const [copyOpen, setCopyOpen] = React.useState(false);
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [affectedCount, setAffectedCount] = React.useState(0);

  // Local edit buffer seeded once the scale loads — bands live client-side
  // until Save, same as any other form (D-decision: whole-set replace, not
  // per-row autosave).
  React.useEffect(() => {
    if (scaleQuery.data && bands === undefined) {
      setBands(scaleQuery.data.bands.map(toBandInput));
    }
  }, [scaleQuery.data, bands]);

  const previewBands = usePreviewBands(scaleId);

  if (scaleQuery.isError) {
    const forbidden = scaleQuery.error instanceof ApiError && scaleQuery.error.statusCode === 403;
    return (
      <ErrorState
        message={forbidden ? t('detail.forbidden') : t('detail.errorMessage')}
        onRetry={() => void scaleQuery.refetch()}
      />
    );
  }

  if (scaleQuery.isPending || bands === undefined) {
    return (
      <div className="flex flex-col gap-2" aria-hidden="true">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const scale = scaleQuery.data;

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
    if (result.affected_result_count > 0) {
      setAffectedCount(result.affected_result_count);
      setPreviewOpen(true);
      return;
    }
    setAffectedCount(0);
    setPreviewOpen(true);
  }

  const problems = previewBands.data?.problems ?? [];
  const hasProblems = previewBands.data !== undefined && !previewBands.data.valid;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{scale.name}</h1>
        {canManage && (
          <Button type="button" variant="outline" onClick={() => setCopyOpen(true)}>
            {t('detail.copy')}
          </Button>
        )}
      </div>

      {bands.length === 0 && (
        <Button
          type="button"
          variant="outline"
          onClick={() => setBands(NCTB_BANDS.map((band) => ({ ...band })))}
        >
          {t('detail.startFromNctb')}
        </Button>
      )}

      <CoverageBar bands={bands} />
      <BandEditor bands={bands} onChange={setBands} />

      {hasProblems && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <p className="font-medium">{t('detail.problemsHeading')}</p>
          <ul className="list-disc pl-5">
            {problems.map((problem, index) => (
              <li key={index}>{problem.message}</li>
            ))}
          </ul>
        </div>
      )}

      {previewBands.isError && <MutationErrorMessage error={previewBands.error} />}

      {canManage && (
        <Button type="button" loading={previewBands.isPending} onClick={() => void handleSave()}>
          {t('detail.save')}
        </Button>
      )}

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
          onConfirmed={() => setPreviewOpen(false)}
        />
      )}
    </div>
  );
}

function ScaleEditorPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label', { ns: 'nav' })} />;
}

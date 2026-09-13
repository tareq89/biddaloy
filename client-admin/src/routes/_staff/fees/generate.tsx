import { Permission } from '@biddaloy/shared';
import { Button, RoutePending } from '@biddaloy/ui/components';
import {
  feeGenerationsKeys,
  feeGenerationsQueryOptions,
  useFeeGenerations,
  useHasPermission,
  type FeeGeneration,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useListShellState } from '@biddaloy/ui/shells';
import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';

import { BatchBillsDrawer } from './-generations/batch-bills-drawer';
import { useBatchFilterFields } from './-generations/batch-filters';
import { BatchTable, type BatchTableProps } from './-generations/batch-table';

/**
 * `/fees/generate` — [16.3.5] rewrite. This route used to be [8.11.6]'s
 * "generate a month's fees" wizard (`GenerateFeesWizard`, `?step=`); the
 * wizard itself moves into a modal (16.3.6's `<GenerateFeesModal />`,
 * stubbed below until that ticket lands) and this route becomes the
 * "Generated fees" log: every past batch, filterable, with a drill-down
 * into the bills each one created.
 *
 * `structures`/`discount` gaps: see `ui/src/hooks/fee-generations.ts`'s
 * own comments on `FeeGeneration.structures` and `FeeGenerationBill` —
 * two fields the issue's column spec names that the current endpoints
 * don't select yet.
 */
interface GeneratedFeesFilters {
  period_from?: string | undefined;
  period_to?: string | undefined;
  fee_type?: string | undefined;
  source?: string | undefined;
  generated_by_user_id?: string | undefined;
  collection_status?: string | undefined;
}

const generateFeesSearchSchema = z.object({
  page: z.number().int().positive().optional().catch(undefined),
  limit: z.number().int().positive().optional().catch(undefined),
  period_from: z.string().optional().catch(undefined),
  period_to: z.string().optional().catch(undefined),
  fee_type: z.string().optional().catch(undefined),
  source: z.string().optional().catch(undefined),
  generated_by_user_id: z.string().optional().catch(undefined),
  collection_status: z.string().optional().catch(undefined),
  // Reserved key `use-list-shell-state.ts` stores row selection under —
  // this page has no bulk actions, but the schema still has to declare
  // it or `validateSearch` strips it, same reasoning `dues.tsx` gives.
  selected: z.string().optional().catch(undefined),
});

function toFeeGenerationsFilters(filters: GeneratedFeesFilters) {
  return {
    ...(filters.period_from !== undefined ? { period_from: filters.period_from } : {}),
    ...(filters.period_to !== undefined ? { period_to: filters.period_to } : {}),
    ...(filters.fee_type !== undefined ? { fee_type: filters.fee_type } : {}),
    ...(filters.source !== undefined ? { source: filters.source as 'MANUAL' | 'SCHEDULE' } : {}),
    ...(filters.generated_by_user_id !== undefined
      ? { generated_by_user_id: filters.generated_by_user_id }
      : {}),
    ...(filters.collection_status !== undefined
      ? { collection_status: filters.collection_status as 'NONE' | 'PARTIAL' | 'FULL' }
      : {}),
  };
}

export const Route = createFileRoute('/_staff/fees/generate')({
  validateSearch: generateFeesSearchSchema,
  loaderDeps: ({ search }) => ({
    page: search.page ?? 1,
    limit: search.limit ?? 20,
    period_from: search.period_from,
    period_to: search.period_to,
    fee_type: search.fee_type,
    source: search.source,
    generated_by_user_id: search.generated_by_user_id,
    collection_status: search.collection_status,
  }),
  loader: ({ context: { queryClient }, deps }) =>
    Promise.all([
      // [8.14.5]: swallowed — see `academic-years/index.tsx`'s identical
      // comment for why.
      queryClient
        .ensureQueryData(
          feeGenerationsQueryOptions({
            page: deps.page,
            limit: deps.limit,
            ...toFeeGenerationsFilters(deps),
          }),
        )
        .catch(swallowUnlessOffline),
      loadRouteNamespaces('fees'),
    ]),
  pendingComponent: GenerateFeesPending,
  component: GeneratedFeesPage,
});

/**
 * Stub for 16.3.6's real modal — that ticket owns the actual "pick a
 * period, review, submit" flow (what used to be `GenerateFeesWizard`)
 * and runs in a separate worktree in parallel with this one. Wired with
 * the same `open`/`onOpenChange`/`onGenerated` shape the real component
 * is expected to need, so swapping this out is a one-line import change,
 * not a rewire of this page.
 */
// TODO(#655): replace with real GenerateFeesModal
interface GenerateFeesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGenerated: () => void;
}

function GenerateFeesModal({ open, onOpenChange, onGenerated }: GenerateFeesModalProps) {
  const { t } = useTranslation('fees');
  if (!open) return null;
  // Deliberately not a real dialog — just enough surface for this page's
  // own tests to exercise the `onGenerated` wiring. 16.3.6 replaces the
  // whole function body.
  return (
    <div role="status" aria-live="polite">
      {t('generations.modalPlaceholder')}
      <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
        {t('generations.modalPlaceholderClose')}
      </Button>
      <Button
        type="button"
        size="sm"
        onClick={() => {
          onGenerated();
          onOpenChange(false);
        }}
      >
        {t('generations.modalPlaceholderConfirm')}
      </Button>
    </div>
  );
}

function GeneratedFeesPage() {
  const { t } = useTranslation('fees');
  const queryClient = useQueryClient();
  const [state, actions] = useListShellState({ limit: 20 });
  const filters = state.filters as GeneratedFeesFilters;

  const generationsQuery = useFeeGenerations({
    page: state.page,
    limit: state.limit,
    ...toFeeGenerationsFilters(filters),
  });
  const rows = React.useMemo(() => generationsQuery.data?.data ?? [], [generationsQuery.data]);

  const filterFields = useBatchFilterFields();

  const canGenerateFees = useHasPermission(Permission.FEE_GENERATE);
  const [modalOpen, setModalOpen] = React.useState(false);
  const [selectedBatch, setSelectedBatch] = React.useState<FeeGeneration | null>(null);

  function handleFilterChange(patch: Record<string, string | null>) {
    actions.setFilters(patch);
  }

  function handleGenerated() {
    void queryClient.invalidateQueries({ queryKey: feeGenerationsKeys.lists() });
  }

  const batchTableProps: BatchTableProps = {
    title: t('generations.title'),
    primaryAction: canGenerateFees && (
      <Button type="button" onClick={() => setModalOpen(true)}>
        {t('generations.generateButton')}
      </Button>
    ),
    filters: { fields: filterFields, values: state.filters, onChange: handleFilterChange },
    data: rows,
    loading: generationsQuery.isLoading,
    isFetching: generationsQuery.isFetching,
    ...(generationsQuery.isError ? { error: t('generations.errorMessage') } : {}),
    emptyMessage: t('generations.emptyMessage'),
    page: state.page,
    pageSize: state.limit,
    totalCount: generationsQuery.data?.total ?? 0,
    onPageChange: actions.setPage,
    onPageSizeChange: actions.setLimit,
    pageSizeLabel: t('pagination.rowsPerPage', { ns: 'common' }),
    onRowClick: setSelectedBatch,
    // No `renderActions` yet — 16.3.7/#656's job, see `batch-table.tsx`'s
    // own doc comment on `BatchTableProps.renderActions`.
  };

  return (
    <>
      <BatchTable {...batchTableProps} />
      <GenerateFeesModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        onGenerated={handleGenerated}
      />
      <BatchBillsDrawer
        batch={selectedBatch}
        onOpenChange={(open) => !open && setSelectedBatch(null)}
      />
    </>
  );
}

function GenerateFeesPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}

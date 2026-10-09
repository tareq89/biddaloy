import { Permission } from '@biddaloy/shared';
import { getActiveRole } from '@biddaloy/ui/api';
import { RoutePending } from '@biddaloy/ui/components';
import {
  feeGenerationsKeys,
  feeGenerationsQueryOptions,
  hasPermission,
  useFeeGenerations,
  useHasPermission,
  type FeeGeneration,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useCloseFullPage, useListShellState } from '@biddaloy/ui/shells';
import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { FilePlusIcon } from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';

import { GenerateFeesModal } from './-generate/generate-fees-modal';
import { BatchBillsDrawer } from './-generations/batch-bills-drawer';
import { useBatchFilterFields } from './-generations/batch-filters';
import { BatchTable, type BatchTableProps } from './-generations/batch-table';

/**
 * `/fees/generate` — [16.3.5] rewrite. This route used to be [8.11.6]'s
 * "generate a month's fees" wizard (`GenerateFeesWizard`, `?step=`); the
 * wizard itself moved into a modal ([16.3.6]'s `<GenerateFeesModal />`)
 * and this route became the "Generated fees" log: every past batch,
 * filterable, with a drill-down into the bills each one created and a
 * "Generate fees" button that opens the modal.
 *
 * `discount` gap: see `ui/src/hooks/fee-generations.ts`'s own comment on
 * `FeeGenerationBill` — a field the issue's column spec names that the
 * bills endpoint doesn't select yet.
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
  // D22: the create flow is in the URL, so Back closes it.
  generate: z.literal(1).optional().catch(undefined),
  // Reserved key `use-list-shell-state.ts` stores row selection under —
  // this page has no bulk actions, but the schema still has to declare
  // it or `validateSearch` strips it, same reasoning `dues.tsx` gives.
  selected: z.string().optional().catch(undefined),
});

// `canReadUsers` false: the "created by" control is hidden, so a deep-linked id must not filter.
function toFeeGenerationsFilters(filters: GeneratedFeesFilters, canReadUsers = true) {
  return {
    ...(filters.period_from !== undefined ? { period_from: filters.period_from } : {}),
    ...(filters.period_to !== undefined ? { period_to: filters.period_to } : {}),
    ...(filters.fee_type !== undefined ? { fee_type: filters.fee_type } : {}),
    ...(filters.source !== undefined
      ? { source: filters.source as 'MANUAL' | 'SCHEDULE' | 'FINE_RULE' }
      : {}),
    ...(canReadUsers && filters.generated_by_user_id !== undefined
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
    limit: search.limit ?? 25,
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
            // Same role check as the page's `useHasPermission`, so the prefetched key matches.
            ...toFeeGenerationsFilters(deps, hasPermission(getActiveRole(), Permission.USER_READ)),
          }),
        )
        .catch(swallowUnlessOffline),
      // [16.3.6]'s modal uses the `feeGeneration` i18n namespace.
      loadRouteNamespaces('fees'),
      loadRouteNamespaces('feeGeneration'),
    ]),
  pendingComponent: GenerateFeesPending,
  component: GeneratedFeesPage,
});

function GeneratedFeesPage() {
  const { t } = useTranslation('fees');
  const queryClient = useQueryClient();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [state, actions] = useListShellState();
  const filters = state.filters as GeneratedFeesFilters;
  const canReadUsers = useHasPermission(Permission.USER_READ);

  const generationsQuery = useFeeGenerations({
    page: state.page,
    limit: state.limit,
    ...toFeeGenerationsFilters(filters, canReadUsers),
  });
  const rows = React.useMemo(() => generationsQuery.data?.data ?? [], [generationsQuery.data]);

  const filterFields = useBatchFilterFields();

  const canGenerateFees = useHasPermission(Permission.FEE_GENERATE);
  const openGenerate = () => void navigate({ search: (prev) => ({ ...prev, generate: 1 }) });
  const closeGenerate = useCloseFullPage(
    () => void navigate({ search: (prev) => ({ ...prev, generate: undefined }), replace: true }),
  );
  const [selectedBatch, setSelectedBatch] = React.useState<FeeGeneration | null>(null);

  function handleFilterChange(patch: Record<string, string | null>) {
    actions.setFilters(patch);
  }

  const batchTableProps: BatchTableProps = {
    title: t('generations.title'),
    subtitle: t('generations.subtitle'),
    actions: [
      {
        id: 'generate',
        label: t('generations.generateButton'),
        icon: <FilePlusIcon />,
        priority: 'primary',
        allowed: canGenerateFees,
        onClick: openGenerate,
      },
    ],
    filters: { fields: filterFields, values: state.filters, onChange: handleFilterChange },
    data: rows,
    loading: generationsQuery.isLoading,
    isFetching: generationsQuery.isFetching,
    ...(generationsQuery.isError ? { error: t('generations.errorMessage') } : {}),
    emptyMessage: t('generations.emptyMessage'),
    emptyExplanation: t('generations.emptyExplanation'),
    ...(canGenerateFees
      ? { emptyAction: { label: t('generations.generateButton'), onClick: openGenerate } }
      : {}),
    page: state.page,
    pageSize: state.limit,
    totalCount: generationsQuery.data?.total ?? 0,
    onPageChange: actions.setPage,
    onPageSizeChange: actions.setLimit,
    pageSizeLabel: t('pagination.rowsPerPage', { ns: 'common' }),
    onRowClick: setSelectedBatch,
  };

  return (
    <>
      <BatchTable {...batchTableProps} />
      {canGenerateFees && (
        <GenerateFeesModal
          open={search.generate === 1}
          onOpenChange={(open) => {
            if (open) return;
            closeGenerate();
            // The modal has no onGenerated callback, so refetch the log whenever it closes.
            void queryClient.invalidateQueries({ queryKey: feeGenerationsKeys.lists() });
          }}
        />
      )}
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

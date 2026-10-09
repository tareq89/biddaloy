/**
 * [38.4.3] `/fees/fines` — the Fines list: filters, totals footer, and the
 * "Log fine" / "Generate fines" entry points (38.4.1's modals), and a header
 * button to `rules.tsx` (38.4.2). Composed (not `ListShell`) so the totals Card
 * sits between the filters and the table.
 *
 * Keyboard: `l` opens Log fine, `g` opens Generate fines — same inline
 * `keydown` listener `fines/-rules/rules-panel.tsx` uses for its own `n`
 * shortcut, guarded the same way against typing targets/open dialogs.
 *
 * The command palette (`fines.log`/`fines.generate`/`fines.waive` in
 * `action-registry.ts`) can only `navigate({ to })` — no entity id crosses
 * that boundary, so its `run()` lands here with `?logFine=1`/`?generateFines=1`,
 * which open the modals unprefilled.
 */
import { FeeStatus, Permission } from '@biddaloy/shared';
import { DataTable, ErrorState, RoutePending } from '@biddaloy/ui/components';
import {
  useClasses,
  useClassSections,
  useFeeStructures,
  useFines,
  useHasPermission,
  type Fine,
  type FinesFilters,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import {
  FilterBar,
  PageContainer,
  PageHeader,
  useCloseFullPage,
  useListShellState,
  type PageAction,
} from '@biddaloy/ui/shells';
import { formatServerAmount } from '@biddaloy/ui/utils';
import { createFileRoute } from '@tanstack/react-router';
import { FilePlus2, Gavel, ListChecks, Plus, SearchX } from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces } from '../../../../route-loaders';

import { buildFinesFilterFields, FINE_FEE_TYPE } from './-list/fines-filters';
import { buildFineRowActions, buildFinesColumns } from './-list/fines-table';
import { GenerateFinesModal } from './-modals/generate-fines-modal';
import { LogFineModal } from './-modals/log-fine-modal';
import { WaiveFineDialog } from './-modals/waive-fine-dialog';

const finesSearchSchema = z.object({
  page: z.number().int().positive().optional().catch(undefined),
  limit: z.number().int().positive().optional().catch(undefined),
  month: z.string().optional().catch(undefined),
  class_id: z.string().optional().catch(undefined),
  section_id: z.string().optional().catch(undefined),
  fee_structure_id: z.string().optional().catch(undefined),
  origin: z.enum(['RULE', 'MANUAL']).optional().catch(undefined),
  status: z.enum(FeeStatus).optional().catch(undefined),
  // `use-list-shell-state.ts`'s reserved selection key — same "must be
  // declared or `validateSearch` strips it" reasoning `dues.tsx` documents.
  selected: z.string().optional().catch(undefined),
  // Palette entry points, see this file's own header comment.
  // `z.coerce.string()`: the router parses `?logFine=1` to the number 1 (see payments/index.tsx).
  logFine: z.coerce.string().optional().catch(undefined),
  generateFines: z.coerce.string().optional().catch(undefined),
});

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable ||
    target.closest('[role="dialog"]') !== null
  );
}

function toFinesFilters(filters: Record<string, string>): FinesFilters {
  const result: FinesFilters = {};
  if (filters.month !== undefined) result.month = Number(filters.month);
  if (filters.class_id !== undefined) result.class_id = filters.class_id;
  if (filters.section_id !== undefined) result.section_id = filters.section_id;
  if (filters.fee_structure_id !== undefined) result.fee_structure_id = filters.fee_structure_id;
  if (filters.origin !== undefined) result.origin = filters.origin as 'RULE' | 'MANUAL';
  if (filters.status !== undefined) {
    result.status = filters.status as NonNullable<FinesFilters['status']>;
  }
  return result;
}

export const Route = createFileRoute('/_staff/fees/fines/')({
  validateSearch: finesSearchSchema,
  loader: () => loadRouteNamespaces('fines', 'common'),
  pendingComponent: FinesListPending,
  component: FinesListPage,
});

function FinesTotals({
  totals,
}: {
  totals: { charged: number; collected: number; waived: number; outstanding: number };
}) {
  const { t } = useTranslation('fines');
  const regionConfig = useRegionConfig();
  return (
    <section
      aria-labelledby="fines-totals"
      className="rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5"
    >
      <h2 id="fines-totals" className="sr-only">
        {t('totals.heading')}
      </h2>
      <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {(['charged', 'collected', 'waived', 'outstanding'] as const).map((key) => (
          <div key={key}>
            <dt className="text-caption text-text-secondary">{t(`totals.${key}`)}</dt>
            <dd
              className={['text-h3 tabular-nums', key === 'outstanding' && 'text-status-overdue-fg']
                .filter(Boolean)
                .join(' ')}
            >
              {formatServerAmount(totals[key], regionConfig)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function FinesListPage() {
  const { t } = useTranslation('fines');
  const { t: tCommon } = useTranslation('common');
  const regionConfig = useRegionConfig();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [state, actions] = useListShellState();

  const canGenerate = useHasPermission(Permission.FEE_GENERATE);
  const canWaive = useHasPermission(Permission.FEE_APPROVE);

  const finesQuery = useFines({
    page: state.page,
    limit: state.limit,
    ...toFinesFilters(state.filters),
  });
  const fines = finesQuery.data?.items ?? [];
  const totals = finesQuery.data?.totals ?? {
    charged: 0,
    collected: 0,
    waived: 0,
    outstanding: 0,
  };

  const classesQuery = useClasses({});
  const sectionsQuery = useClassSections(state.filters.class_id);
  const fineStructuresQuery = useFeeStructures({ fee_type: FINE_FEE_TYPE, limit: 100 });

  const [waiving, setWaiving] = React.useState<Fine | null>(null);

  // The search params ARE the open state (D22): opening sets one, closing goes
  // back, a refresh reopens. The command palette links to the same params.
  const logOpen = search.logFine === '1' && canGenerate;
  const generateOpen = search.generateFines === '1' && canGenerate;
  const openLog = () => void navigate({ search: (prev) => ({ ...prev, logFine: 1 }) });
  const openGenerate = () => void navigate({ search: (prev) => ({ ...prev, generateFines: 1 }) });
  const closeLog = useCloseFullPage(
    () => void navigate({ search: (prev) => ({ ...prev, logFine: undefined }), replace: true }),
  );
  const closeGenerate = useCloseFullPage(
    () =>
      void navigate({ search: (prev) => ({ ...prev, generateFines: undefined }), replace: true }),
  );

  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isEditableTarget(event.target)) return;
      if (event.key === 'l' && canGenerate) {
        event.preventDefault();
        void navigate({ search: (prev) => ({ ...prev, logFine: 1 }) });
      } else if (event.key === 'g' && canGenerate) {
        event.preventDefault();
        void navigate({ search: (prev) => ({ ...prev, generateFines: 1 }) });
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canGenerate, navigate]);

  function handleFilterChange(patch: Record<string, string | null>) {
    const next = { ...patch };
    if ('class_id' in next) next.section_id = null;
    actions.setFilters(next);
  }

  const filterFields = buildFinesFilterFields(t, tCommon, {
    classes: (classesQuery.data?.data ?? []).map((klass) => ({ id: klass.id, name: klass.name })),
    sections: sectionsQuery.data ?? [],
    fineStructures: fineStructuresQuery.data?.data ?? [],
    regionConfig,
  });

  const columns = buildFinesColumns(t, regionConfig);
  const rowActions = buildFineRowActions(t, { onWaive: setWaiving, canWaive });

  const headerActions: PageAction[] = [
    {
      id: 'rules',
      label: t('tabs.rules'),
      priority: 'secondary',
      icon: <ListChecks />,
      onClick: () => void navigate({ to: '/fees/fines/rules' }),
    },
    {
      id: 'log',
      label: t('logForm.title'),
      priority: 'secondary',
      icon: <Plus />,
      allowed: canGenerate,
      onClick: openLog,
    },
    {
      id: 'generate',
      label: t('generate.title'),
      priority: 'primary',
      icon: <FilePlus2 />,
      allowed: canGenerate,
      onClick: openGenerate,
    },
  ];
  const isFiltered = Object.keys(state.filters).length > 0;

  return (
    <PageContainer>
      <PageHeader title={t('title')} subtitle={t('subtitle')} actions={headerActions} />
      <FilterBar
        fields={filterFields}
        values={state.filters}
        onChange={handleFilterChange}
        {...(finesQuery.data ? { resultCount: finesQuery.data.total } : {})}
      />
      {finesQuery.data && finesQuery.data.total > 0 && <FinesTotals totals={totals} />}
      {finesQuery.isError ? (
        <ErrorState
          message={t('loadError')}
          retryLabel={tCommon('actions.retry')}
          onRetry={() => void finesQuery.refetch()}
        />
      ) : (
        <DataTable
          tableId="fees-fines"
          caption={t('title')}
          columns={columns}
          data={fines}
          getRowId={(row) => row.id}
          rowActions={rowActions}
          sorting={null}
          onSortingChange={() => {}}
          page={state.page}
          pageSize={state.limit}
          totalCount={finesQuery.data?.total ?? 0}
          onPageChange={actions.setPage}
          onPageSizeChange={actions.setLimit}
          pageSizeLabel={tCommon('pagination.rowsPerPage')}
          loading={finesQuery.isLoading}
          isFetching={finesQuery.isFetching}
          emptyState={
            isFiltered
              ? {
                  icon: <SearchX />,
                  title: t('emptyFiltered.title'),
                  explanation: t('emptyFiltered.description'),
                }
              : {
                  icon: <Gavel />,
                  title: t('empty.title'),
                  explanation: t('empty.description'),
                  ...(canGenerate
                    ? { action: { label: t('logForm.title'), onClick: openLog } }
                    : {}),
                }
          }
        />
      )}

      {logOpen && <LogFineModal open onOpenChange={(open) => !open && closeLog()} />}
      {generateOpen && (
        <GenerateFinesModal open onOpenChange={(open) => !open && closeGenerate()} />
      )}
      <WaiveFineDialog
        open={waiving !== null}
        onOpenChange={(open) => !open && setWaiving(null)}
        {...(waiving ? { fineId: waiving.id, studentId: waiving.student_id } : {})}
      />
    </PageContainer>
  );
}

function FinesListPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}

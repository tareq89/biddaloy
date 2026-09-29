/**
 * [38.4.3] `/fees/fines` — the Fines list: filters, totals footer, and the
 * "Log fine" / "Generate fines" entry points (38.4.1's modals), plus a
 * "Fines | Rules" tab bar linking to `rules.tsx` (38.4.2). Clones
 * `fees/schedules/index.tsx`'s page shell and `fees/dues.tsx`'s URL-state
 * filter pattern.
 *
 * Keyboard: `l` opens Log fine, `g` opens Generate fines — same inline
 * `keydown` listener `fines/-rules/rules-panel.tsx` uses for its own `n`
 * shortcut, guarded the same way against typing targets/open dialogs.
 *
 * The command palette (`fines.log`/`fines.generate`/`fines.waive` in
 * `action-registry.ts`) can only `navigate({ to })` — no entity id crosses
 * that boundary (`ActionRunContext`'s own documented limitation, see
 * `grading.copyScale`/`programs.enrol` for precedent). Its `run()` lands
 * here with a `?logFine=1`/`?generateFines=1` query flag, which this route
 * reads to open the modal unprefilled — the palette's "prefilled on a
 * student page" acceptance line does not hold for these three actions
 * (flagged in the PR body, not fixed here — would need `ActionRunContext`
 * itself to carry an entity id, which is `command-palette-launcher.tsx`'s
 * territory, not this ticket's file list).
 */
import { FeeStatus, Permission } from '@biddaloy/shared';
import { Button, EmptyState, RoutePending } from '@biddaloy/ui/components';
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
import { ListShell, useListShellState } from '@biddaloy/ui/shells';
import { formatServerAmount } from '@biddaloy/ui/utils';
import { createFileRoute } from '@tanstack/react-router';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces } from '../../../../route-loaders';

import { buildFinesFilterFields, FINE_FEE_TYPE } from './-list/fines-filters';
import { buildFinesColumns } from './-list/fines-table';
import { FinesTabs } from './-list/fines-tabs';
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
  logFine: z.string().optional().catch(undefined),
  generateFines: z.string().optional().catch(undefined),
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

function FinesTotalsFooter({
  totals,
}: {
  totals: { charged: number; collected: number; waived: number; outstanding: number };
}) {
  const { t } = useTranslation('fines');
  const regionConfig = useRegionConfig();
  return (
    <dl className="mt-4 grid grid-cols-2 gap-4 rounded-md border p-4 sm:grid-cols-4">
      {(['charged', 'collected', 'waived', 'outstanding'] as const).map((key) => (
        <div key={key}>
          <dt className="text-xs text-muted-foreground">{t(`totals.${key}`)}</dt>
          <dd className="text-lg font-semibold tabular-nums">
            {formatServerAmount(totals[key], regionConfig)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function FinesListPage() {
  const { t } = useTranslation('fines');
  const { t: tCommon } = useTranslation('common');
  const regionConfig = useRegionConfig();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [state, actions] = useListShellState({ limit: 20 });

  const canGenerate = useHasPermission(Permission.FEE_GENERATE);

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

  const monthOptions = React.useMemo(
    () => Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')),
    [],
  );

  const [logFineOpen, setLogFineOpen] = React.useState(false);
  const [generateFinesOpen, setGenerateFinesOpen] = React.useState(false);
  const [waiving, setWaiving] = React.useState<Fine | null>(null);

  // Palette entry points — see this file's own header comment.
  React.useEffect(() => {
    if (search.logFine) {
      setLogFineOpen(true);
      void navigate({ search: (prev) => ({ ...prev, logFine: undefined }), replace: true });
    }
    if (search.generateFines) {
      setGenerateFinesOpen(true);
      void navigate({ search: (prev) => ({ ...prev, generateFines: undefined }), replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per mount to consume the one-shot query flag
  }, [search.logFine, search.generateFines]);

  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isEditableTarget(event.target)) return;
      if (event.key === 'l') {
        event.preventDefault();
        setLogFineOpen(true);
      } else if (event.key === 'g' && canGenerate) {
        event.preventDefault();
        setGenerateFinesOpen(true);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canGenerate]);

  function handleFilterChange(patch: Record<string, string | null>) {
    const next = { ...patch };
    if ('class_id' in next) next.section_id = null;
    actions.setFilters(next);
  }

  const filterFields = buildFinesFilterFields(t, tCommon, {
    classes: (classesQuery.data?.data ?? []).map((klass) => ({ id: klass.id, name: klass.name })),
    sections: sectionsQuery.data ?? [],
    fineStructures: fineStructuresQuery.data?.data ?? [],
    monthOptions,
  });

  const columns = buildFinesColumns(t, regionConfig, { onWaive: setWaiving });

  const isEmpty = !finesQuery.isLoading && fines.length === 0 && finesQuery.data?.total === 0;

  return (
    <>
      <FinesTabs />
      {isEmpty ? (
        <EmptyState
          title={t('empty.title')}
          explanation={t('empty.description')}
          action={{ label: t('logForm.title'), onClick: () => setLogFineOpen(true) }}
          {...(canGenerate
            ? {
                secondaryAction: {
                  label: t('generate.title'),
                  onClick: () => setGenerateFinesOpen(true),
                },
              }
            : {})}
        />
      ) : (
        <>
          <ListShell
            title={t('title')}
            primaryAction={
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setLogFineOpen(true)}>
                  {t('logForm.title')}
                </Button>
                {canGenerate && (
                  <Button type="button" onClick={() => setGenerateFinesOpen(true)}>
                    {t('generate.title')}
                  </Button>
                )}
              </div>
            }
            filters={{ fields: filterFields, values: state.filters, onChange: handleFilterChange }}
            tableId="fees-fines"
            caption={t('title')}
            columns={columns}
            data={fines}
            getRowId={(row) => row.id}
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
            {...(finesQuery.isError ? { error: t('empty.title') } : {})}
            emptyMessage={t('empty.title')}
          />
          <FinesTotalsFooter totals={totals} />
        </>
      )}

      <LogFineModal open={logFineOpen} onOpenChange={setLogFineOpen} />
      <GenerateFinesModal open={generateFinesOpen} onOpenChange={setGenerateFinesOpen} />
      <WaiveFineDialog
        open={waiving !== null}
        onOpenChange={(open) => !open && setWaiving(null)}
        {...(waiving ? { fineId: waiving.id, studentId: waiving.student_id } : {})}
      />
    </>
  );
}

function FinesListPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}

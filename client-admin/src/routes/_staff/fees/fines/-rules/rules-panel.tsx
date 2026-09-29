/**
 * [38.4a] Rules tab content — #1120. `ListShell`'s `useListShellState`
 * needs a matched TanStack Router route to read its page/limit from search
 * params, which a bare panel mounted inside a sibling ticket's tab —
 * #1121 — doesn't have. `DataTable` itself has no such requirement though,
 * so it's used directly (unpaginated — a single "page" holding the year's
 * whole rule list, same "unpaginated, tenant-small" reasoning
 * `fees/schedules/index.tsx` documents for `RecurringSchedule`), which also
 * gets the phone card fallback `fees/schedules/index.tsx` gets for free
 * instead of a plain `<table>` with no narrow-viewport view.
 *
 * Self-contained: this panel owns its own academic-year selection (default
 * the current year) rather than taking one as a prop, so #1121 can mount
 * `<RulesPanel />` with no wiring of its own.
 *
 * Keyboard: `n` opens the new-rule form. `fees/schedules/index.tsx` has no
 * such shortcut to reuse (the ticket's plan assumed one existed) — this is
 * a small inline `keydown` listener instead, same pattern
 * `marks/$examId.$sectionId.$subjectId.tsx` uses for its own shortcut,
 * guarded so typing in a field or an open dialog never triggers it.
 */
import { Permission } from '@biddaloy/shared';
import {
  Button,
  DataTable,
  type DataTableColumn,
  EmptyState,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@biddaloy/ui/components';
import {
  useAcademicYears,
  useDeleteFineRule,
  useFineRules,
  useHasPermission,
  useUpdateFineRule,
  type FineRule,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatServerAmount } from '@biddaloy/ui/utils';
import * as React from 'react';

import { CopyRulesDialog } from './copy-rules-dialog';
import { RuleFormDialog } from './rule-form-dialog';

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) {
    return true;
  }
  // Radix `<Select>`'s trigger is a `<button role="combobox">`, not a native
  // form control, so the tag/contentEditable checks above miss it — pressing
  // `n` while the academic-year picker has focus still opened the create
  // dialog. `closest` also catches a click landing on an icon/span inside
  // the trigger rather than the button itself.
  return target.closest('[role="combobox"]') !== null;
}

/** Row actions own `useUpdateFineRule`/`useDeleteFineRule` bound to this
 * row's id — hooks can't be called conditionally per row from one shared
 * call site, same reasoning `schedules/index.tsx`'s `ScheduleRowActions`
 * gives. */
function RuleRowActions({
  rule,
  canUpdate,
  canDelete,
  onEdit,
}: {
  rule: FineRule;
  canUpdate: boolean;
  canDelete: boolean;
  onEdit: () => void;
}) {
  const { t } = useTranslation('fees');
  const updateRule = useUpdateFineRule(rule.academic_year_id);
  const deleteRule = useDeleteFineRule(rule.academic_year_id);

  return (
    <div className="flex flex-wrap gap-3">
      {canUpdate && (
        <button
          type="button"
          className="text-sm font-medium text-primary underline-offset-2 hover:underline"
          onClick={onEdit}
        >
          {t('fines.rules.edit')}
        </button>
      )}
      {canUpdate && (
        <button
          type="button"
          className="text-sm font-medium text-primary underline-offset-2 hover:underline"
          disabled={updateRule.isPending}
          onClick={() => updateRule.mutate({ id: rule.id, is_active: !rule.is_active })}
        >
          {rule.is_active ? t('fines.rules.deactivate') : t('fines.rules.activate')}
        </button>
      )}
      {canDelete && (
        <button
          type="button"
          className="text-sm font-medium text-destructive underline-offset-2 hover:underline"
          disabled={deleteRule.isPending}
          onClick={() => deleteRule.mutate({ id: rule.id })}
        >
          {t('fines.rules.delete')}
        </button>
      )}
    </div>
  );
}

function minMinutesLateOf(rule: FineRule): number | null {
  return rule.trigger === 'ATTENDANCE_LATE' && typeof rule.conditions.min_minutes_late === 'number'
    ? rule.conditions.min_minutes_late
    : null;
}

export function RulesPanel() {
  const { t } = useTranslation('fees');
  const regionConfig = useRegionConfig();

  const yearsQuery = useAcademicYears();
  const years = yearsQuery.data?.data ?? [];
  const [academicYearId, setAcademicYearId] = React.useState('');
  React.useEffect(() => {
    if (academicYearId !== '' || years.length === 0) return;
    setAcademicYearId(years.find((year) => year.is_current)?.id ?? years[0]?.id ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- set once years load, then user-controlled
  }, [years]);

  const rulesQuery = useFineRules(academicYearId);
  const rules = rulesQuery.data ?? [];

  const canCreate = useHasPermission(Permission.FEE_STRUCTURE_CREATE);
  const canUpdate = useHasPermission(Permission.FEE_STRUCTURE_UPDATE);
  const canDelete = useHasPermission(Permission.FEE_STRUCTURE_DELETE);

  const [createOpen, setCreateOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<FineRule | null>(null);
  const [copyOpen, setCopyOpen] = React.useState(false);

  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'n' || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isEditableTarget(event.target)) return;
      if (!canCreate || createOpen || editing || copyOpen) return;
      event.preventDefault();
      setCreateOpen(true);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canCreate, createOpen, editing, copyOpen]);

  const columns: DataTableColumn<FineRule>[] = [
    {
      id: 'trigger',
      header: t('fines.rules.columnTrigger'),
      accessorFn: (row) =>
        row.trigger === 'ATTENDANCE_LATE'
          ? t('fines.rules.triggerLate')
          : t('fines.rules.triggerAbsent'),
      card: 'title',
    },
    {
      id: 'appliesTo',
      header: t('fines.rules.columnAppliesTo'),
      accessorFn: (row) => row.class_name ?? t('fines.rules.wholeSchool'),
      card: 'subtitle',
    },
    {
      id: 'fee',
      header: t('fines.rules.columnFee'),
      accessorFn: (row) =>
        `${row.fee_structure_name} — ${formatServerAmount(row.fee_structure_amount, regionConfig)}`,
    },
    {
      id: 'freePerPeriod',
      header: t('fines.rules.columnFreePerPeriod'),
      accessorFn: (row) => row.free_per_period,
      align: 'end',
    },
    {
      id: 'cap',
      header: t('fines.rules.columnCap'),
      accessorFn: (row) =>
        row.cap_per_period === null ? '—' : formatServerAmount(row.cap_per_period, regionConfig),
      align: 'end',
    },
    {
      id: 'minMinutesLate',
      header: t('fines.rules.columnMinMinutesLate'),
      accessorFn: (row) => minMinutesLateOf(row) ?? '—',
      align: 'end',
    },
    {
      id: 'active',
      header: t('fines.rules.columnActive'),
      accessorFn: (row) =>
        row.is_active ? t('fines.rules.statusActive') : t('fines.rules.statusInactive'),
      card: 'badge',
    },
    {
      id: 'actions',
      header: t('fines.rules.columnActions'),
      pinned: true,
      accessorFn: (row) => (
        <RuleRowActions
          rule={row}
          canUpdate={canUpdate}
          canDelete={canDelete}
          onEdit={() => setEditing(row)}
        />
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t('fines.rules.academicYearLabel')}</span>
          <Select value={academicYearId} onValueChange={setAcademicYearId}>
            <SelectTrigger aria-label={t('fines.rules.academicYearLabel')}>
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

        {canCreate && (
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setCopyOpen(true)}>
              {t('fines.rules.copyFromLastYear')}
            </Button>
            <Button type="button" onClick={() => setCreateOpen(true)}>
              {t('fines.rules.addRule')}
            </Button>
          </div>
        )}
      </div>

      {!rulesQuery.isLoading && !rulesQuery.isError && rules.length === 0 ? (
        <EmptyState
          title={t('fines.rules.emptyTitle')}
          explanation={t('fines.rules.emptyMessage')}
          {...(canCreate
            ? { action: { label: t('fines.rules.addRule'), onClick: () => setCreateOpen(true) } }
            : {})}
        />
      ) : (
        <DataTable
          tableId="fines-rules-list"
          caption={t('fines.rules.title')}
          columns={columns}
          data={rules}
          getRowId={(row) => row.id}
          sorting={null}
          onSortingChange={() => {}}
          page={1}
          pageSize={Math.max(rules.length, 1)}
          totalCount={rules.length}
          onPageChange={() => {}}
          loading={rulesQuery.isLoading}
          isFetching={rulesQuery.isFetching}
          {...(rulesQuery.isError ? { error: t('fines.rules.errorMessage') } : {})}
          emptyMessage={t('fines.rules.emptyMessage')}
        />
      )}

      {canCreate && academicYearId !== '' && (
        <RuleFormDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          mode="create"
          academicYearId={academicYearId}
          onSaved={() => setCreateOpen(false)}
        />
      )}

      {canUpdate && editing && (
        <RuleFormDialog
          open={editing !== null}
          onOpenChange={(open) => !open && setEditing(null)}
          mode="edit"
          academicYearId={editing.academic_year_id}
          rule={editing}
          onSaved={() => setEditing(null)}
        />
      )}

      {canCreate && academicYearId !== '' && (
        <CopyRulesDialog
          open={copyOpen}
          onOpenChange={setCopyOpen}
          toAcademicYearId={academicYearId}
          onCopied={() => setCopyOpen(false)}
        />
      )}
    </div>
  );
}

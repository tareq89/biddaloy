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
  ConfirmDialog,
  DataTable,
  type DataTableColumn,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatusBadge,
  toast,
  type RowAction,
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
import { PageHeader } from '@biddaloy/ui/shells';
import { formatNumber, formatServerAmount } from '@biddaloy/ui/utils';
import { CirclePause, CirclePlay, Copy, Gavel, Plus } from 'lucide-react';
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

function minMinutesLateOf(rule: FineRule): number | null {
  return rule.trigger === 'ATTENDANCE_LATE' && typeof rule.conditions.min_minutes_late === 'number'
    ? rule.conditions.min_minutes_late
    : null;
}

export function RulesPanel() {
  const { t } = useTranslation(['fees', 'fines']);
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
  const [deleting, setDeleting] = React.useState<FineRule | null>(null);

  const updateRule = useUpdateFineRule(academicYearId);
  const deleteRule = useDeleteFineRule(academicYearId);

  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'n' || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isEditableTarget(event.target)) return;
      if (!canCreate || createOpen || editing || copyOpen || deleting) return;
      event.preventDefault();
      setCreateOpen(true);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canCreate, createOpen, editing, copyOpen, deleting]);

  const triggerLabel = (rule: FineRule | null) =>
    rule?.trigger === 'ATTENDANCE_LATE'
      ? t('fines.rules.triggerLate')
      : t('fines.rules.triggerAbsent');

  const toggleRule = (rule: FineRule, isActive: boolean) =>
    updateRule.mutate(
      { id: rule.id, is_active: isActive },
      { onError: () => toast.error(t('fines.rules.form.errorMessage')) },
    );

  const rowActions = (row: FineRule): RowAction[] => [
    {
      intent: 'edit',
      label: t('fines.rules.edit'),
      allowed: canUpdate,
      onClick: () => setEditing(row),
    },
    row.is_active
      ? {
          intent: 'archive',
          icon: <CirclePause />,
          label: t('fines.rules.deactivate'),
          allowed: canUpdate,
          onClick: () => toggleRule(row, false),
        }
      : {
          intent: 'restore',
          icon: <CirclePlay />,
          label: t('fines.rules.activate'),
          allowed: canUpdate,
          onClick: () => toggleRule(row, true),
        },
    {
      intent: 'delete',
      label: t('fines.rules.delete'),
      allowed: canDelete,
      onClick: () => setDeleting(row),
    },
  ];

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
      accessorFn: (row) => formatNumber(row.free_per_period, regionConfig),
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
      accessorFn: (row) => {
        const minutes = minMinutesLateOf(row);
        return minutes === null
          ? '—'
          : t('rules.minutes', {
              ns: 'fines',
              count: minutes,
              n: formatNumber(minutes, regionConfig),
            });
      },
      align: 'end',
    },
    {
      id: 'active',
      header: t('fines.rules.columnActive'),
      accessorFn: (row) => (
        <StatusBadge
          tone={row.is_active ? 'success' : 'neutral'}
          label={row.is_active ? t('fines.rules.statusActive') : t('fines.rules.statusInactive')}
        />
      ),
      card: 'badge',
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('rules.title', { ns: 'fines' })}
        subtitle={t('rules.subtitle', { ns: 'fines' })}
        actions={[
          {
            id: 'copy',
            label: t('fines.rules.copyFromLastYear'),
            priority: 'secondary',
            icon: <Copy />,
            allowed: canCreate,
            onClick: () => setCopyOpen(true),
          },
          {
            id: 'add',
            label: t('fines.rules.addRule'),
            priority: 'primary',
            icon: <Plus />,
            allowed: canCreate,
            onClick: () => setCreateOpen(true),
          },
        ]}
      />

      <div className="md:grid md:grid-cols-12 md:gap-4">
        <div className="flex flex-col gap-1.5 md:col-span-3">
          <label htmlFor="fine-rules-year" className="text-label">
            {t('fines.rules.academicYearLabel')}
          </label>
          <Select value={academicYearId} onValueChange={setAcademicYearId}>
            <SelectTrigger id="fine-rules-year">
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
      </div>

      <DataTable
        tableId="fines-rules-list"
        caption={t('fines.rules.title')}
        columns={columns}
        rowActions={rowActions}
        data={rules}
        getRowId={(row) => row.id}
        sorting={null}
        onSortingChange={() => {}}
        paginated={false}
        totalCount={rules.length}
        loading={rulesQuery.isLoading}
        isFetching={rulesQuery.isFetching}
        {...(rulesQuery.isError ? { error: t('fines.rules.errorMessage') } : {})}
        emptyState={{
          icon: <Gavel />,
          title: t('fines.rules.emptyTitle'),
          explanation: t('fines.rules.emptyMessage'),
          ...(canCreate
            ? { action: { label: t('fines.rules.addRule'), onClick: () => setCreateOpen(true) } }
            : {}),
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && !deleteRule.isPending && setDeleting(null)}
        tone="danger"
        title={t('deleteRuleDialog.title', { ns: 'fines' })}
        description={t('deleteRuleDialog.description', {
          ns: 'fines',
          trigger: triggerLabel(deleting),
          appliesTo: deleting?.class_name ?? t('fines.rules.wholeSchool'),
        })}
        confirmLabel={t('deleteRuleDialog.confirm', { ns: 'fines' })}
        busy={deleteRule.isPending}
        onConfirm={() =>
          deleting &&
          deleteRule.mutate(
            { id: deleting.id },
            {
              onSuccess: () => setDeleting(null),
              onError: () => toast.error(t('deleteRuleDialog.errorMessage', { ns: 'fines' })),
            },
          )
        }
      />

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

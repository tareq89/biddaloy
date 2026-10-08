/**
 * [66.3.05] Syllabus › Template library: the school's plan templates by class grade and subject
 * code. Everyone with SYLLABUS_READ can view; SYLLABUS_MANAGE holders start a plan from one
 * (opens the create wizard); STUDY_PLAN_TEMPLATE_MANAGE holders add, rename and delete.
 */
import { Permission } from '@biddaloy/shared';
import {
  ConfirmDialog,
  DataTable,
  NoticeBar,
  type DataTableColumn,
  type RowAction,
} from '@biddaloy/ui/components';
import {
  useClasses,
  useDeleteStudyPlanTemplate,
  useHasPermission,
  useStudyPlanTemplates,
  useSubjects,
} from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { FilterBar, useListShellState, type FilterFieldDescriptor } from '@biddaloy/ui/shells';
import { formatDate, formatNumber } from '@biddaloy/ui/utils';
import { InfoIcon, LibraryIcon } from 'lucide-react';
import * as React from 'react';

import { subjectName } from '../../homework/-subject-name';

import { TemplateFormDialog, type TemplateFormTarget } from './template-form-dialog';
import { TemplateLessonsDialog } from './template-lessons-dialog';

type TemplateRow = NonNullable<ReturnType<typeof useStudyPlanTemplates>['data']>['data'][number];

export type LibraryDialog = 'add' | 'csv' | null;

export function LibraryTab({
  addDialog,
  onAddDialog,
  onCopy,
}: {
  /** The header's "Add template" / "Add from CSV" buttons set this. */
  addDialog: LibraryDialog;
  onAddDialog: (next: LibraryDialog) => void;
  /** Opens the create wizard on this template; absent without SYLLABUS_MANAGE. */
  onCopy?: ((templateId: string) => void) | undefined;
}) {
  const { t, i18n } = useTranslation('studyPlans');
  const { t: tCommon } = useTranslation('common');
  const regionConfig = useTenantRegionConfig();
  const canManage = useHasPermission(Permission.STUDY_PLAN_TEMPLATE_MANAGE);
  const [state, actions] = useListShellState();
  const classes = useClasses();
  const subjects = useSubjects({ limit: 100 });

  const values = {
    q: state.filters.q ?? '',
    tpl_grade: state.filters.tpl_grade ?? '',
    tpl_subject: state.filters.tpl_subject ?? '',
  };
  const query = useStudyPlanTemplates({
    ...(values.q ? { q: values.q } : {}),
    ...(values.tpl_grade ? { class_grade: Number(values.tpl_grade) } : {}),
    ...(values.tpl_subject ? { subject_code: values.tpl_subject } : {}),
    page: state.page,
    limit: state.limit,
  });
  const rows = query.data?.data ?? [];

  const [viewing, setViewing] = React.useState<TemplateRow | null>(null);
  const [renaming, setRenaming] = React.useState<TemplateFormTarget | null>(null);
  const [deleting, setDeleting] = React.useState<TemplateRow | null>(null);
  const [deleteFailed, setDeleteFailed] = React.useState(false);
  const remove = useDeleteStudyPlanTemplate();

  const grades = [
    ...new Set(
      (classes.data?.data ?? []).flatMap((c) =>
        c.numeric_grade === null ? [] : [c.numeric_grade],
      ),
    ),
  ].sort((a, b) => a - b);

  const fields: FilterFieldDescriptor[] = [
    {
      kind: 'text',
      key: 'q',
      label: t('list.filters.search'),
      placeholder: t('library.searchPlaceholder'),
      primary: true,
    },
    {
      kind: 'select',
      key: 'tpl_grade',
      label: t('library.form.classGrade'),
      allLabel: t('list.filters.all'),
      options: grades.map((g) => ({
        value: String(g),
        label: t('library.classGrade', { grade: formatNumber(g, regionConfig) }),
      })),
    },
    {
      kind: 'select',
      key: 'tpl_subject',
      label: t('library.form.subject'),
      allLabel: t('list.filters.all'),
      options: (subjects.data?.data ?? []).map((s) => ({
        value: s.code,
        label: subjectName(s, i18n.language),
      })),
    },
  ];

  const columns: DataTableColumn<TemplateRow>[] = [
    {
      id: 'name',
      header: t('library.columns.name'),
      card: 'title',
      accessorFn: (row) => <span className="font-medium">{row.name}</span>,
    },
    {
      id: 'grade',
      header: t('library.form.classGrade'),
      accessorFn: (row) =>
        t('library.classGrade', { grade: formatNumber(row.class_grade, regionConfig) }),
    },
    {
      id: 'subject',
      header: t('library.columns.subject'),
      card: 'subtitle',
      accessorFn: (row) => `${row.subject_name ?? row.subject_code} (${row.subject_code})`,
    },
    {
      id: 'lessons',
      header: t('library.columns.lessons'),
      align: 'end',
      accessorFn: (row) => formatNumber(row.lesson_count, regionConfig),
    },
    {
      id: 'periods',
      header: t('library.columns.periods'),
      align: 'end',
      accessorFn: (row) => formatNumber(row.total_periods, regionConfig),
    },
    {
      id: 'updated',
      header: t('library.columns.updated'),
      accessorFn: (row) => formatDate(row.updated_at, regionConfig),
    },
  ];

  const rowActions = (row: TemplateRow): RowAction[] => [
    // D37: for a teacher this is the library's main action, so it comes first.
    {
      intent: 'duplicate',
      label: t('library.actions.copyToMine'),
      allowed: !!onCopy,
      onClick: () => onCopy?.(row.id),
    },
    {
      intent: 'view',
      label: t('library.actions.view', { name: row.name }),
      onClick: () => setViewing(row),
    },
    {
      intent: 'edit',
      label: t('library.actions.edit', { name: row.name }),
      allowed: canManage,
      onClick: () =>
        setRenaming({
          id: row.id,
          name: row.name,
          class_grade: row.class_grade,
          subject_code: row.subject_code,
        }),
    },
    {
      intent: 'delete',
      label: t('library.actions.delete', { name: row.name }),
      allowed: canManage,
      onClick: () => {
        setDeleteFailed(false);
        setDeleting(row);
      },
    },
  ];

  return (
    <section className="space-y-4">
      <NoticeBar tone="info">
        <InfoIcon aria-hidden="true" className="me-1 inline size-4" />
        {t('library.info')}
      </NoticeBar>
      <FilterBar
        fields={fields}
        values={values}
        onChange={(patch) =>
          actions.setFilters({
            ...Object.fromEntries(Object.keys(values).map((k) => [k, state.filters[k] ?? null])),
            ...patch,
          })
        }
        resultCount={query.data?.total ?? 0}
      />
      {deleteFailed && <NoticeBar tone="danger">{t('library.deleteFailed')}</NoticeBar>}
      <DataTable
        tableId="study-plan-templates"
        caption={t('library.add')}
        columns={columns}
        rowActions={rowActions}
        data={rows}
        getRowId={(row) => row.id}
        sorting={null}
        onSortingChange={() => undefined}
        page={state.page}
        pageSize={state.limit}
        totalCount={query.data?.total ?? 0}
        onPageChange={actions.setPage}
        onPageSizeChange={actions.setLimit}
        loading={query.isLoading}
        isFetching={query.isFetching}
        {...(query.isError ? { error: t('list.error') } : {})}
        emptyState={{
          icon: <LibraryIcon aria-hidden="true" className="size-6" />,
          title: t('library.emptyTitle'),
          explanation: t('library.emptyExplanation'),
          ...(canManage
            ? { action: { label: t('library.add'), onClick: () => onAddDialog('add') } }
            : {}),
        }}
      />

      {viewing && (
        <TemplateLessonsDialog
          id={viewing.id}
          name={viewing.name}
          onClose={() => setViewing(null)}
          onCopy={onCopy ? () => onCopy(viewing.id) : undefined}
        />
      )}
      {canManage && addDialog && (
        <TemplateFormDialog
          initialSource={addDialog === 'csv' ? 'csv' : 'plan'}
          onClose={() => onAddDialog(null)}
        />
      )}
      {canManage && renaming && (
        <TemplateFormDialog rename={renaming} onClose={() => setRenaming(null)} />
      )}
      {canManage && deleting && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && !remove.isPending && setDeleting(null)}
          title={t('library.actions.delete', { name: deleting.name })}
          description={t('library.deleteConfirm', { name: deleting.name })}
          confirmLabel={t('library.actions.delete', { name: deleting.name })}
          cancelLabel={tCommon('actions.cancel')}
          tone="danger"
          busy={remove.isPending}
          onConfirm={() =>
            remove.mutate(deleting.id, {
              onSuccess: () => setDeleting(null),
              onError: () => {
                setDeleting(null);
                setDeleteFailed(true);
              },
            })
          }
        />
      )}
    </section>
  );
}

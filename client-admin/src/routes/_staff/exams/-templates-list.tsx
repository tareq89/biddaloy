/**
 * [35.4.5] Exam structures list — `ListShell` (table on desktop, cards on
 * phone via DataTable's card mode), "Add exam structure" dialog, icon row actions
 * (edit opens the detail, delete behind a confirm dialog); unpaginated — the API
 * returns every row. Redesigned in [31.4.exams-3a]. No route here ([35.4.9] adds it): the
 * route supplies `renderName` (the link into the detail) and `onCreated`.
 */
import { ConfirmDialog } from '@biddaloy/ui/components';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { ListShell } from '@biddaloy/ui/shells';
import { formatNumber } from '@biddaloy/ui/utils';
import { FileStack, Plus } from 'lucide-react';
import * as React from 'react';

import { TemplateFormDialog } from './-template-form-dialog';
import {
  type ExamTemplateDetail,
  type ExamTemplateSummary,
  useDeleteExamTemplate,
  useExamTemplates,
} from './-use-exam-templates';

export interface TemplatesListProps {
  /** Renders a template's name cell — the route passes a `<Link>` to the detail. */
  renderName?: (template: ExamTemplateSummary) => React.ReactNode;
  onCreated: (template: ExamTemplateDetail) => void;
}

export function TemplatesList({ renderName, onCreated }: TemplatesListProps) {
  const { t } = useTranslation('examTemplates');
  const config = useRegionConfig();
  const query = useExamTemplates();
  const remove = useDeleteExamTemplate();
  const [createOpen, setCreateOpen] = React.useState(false);
  const [toDelete, setToDelete] = React.useState<ExamTemplateSummary | null>(null);

  const gradesLabel = (grades: number[]) =>
    [...grades]
      .sort((a, b) => a - b)
      .map((g) => formatNumber(g, config))
      .join(', ') || '—';

  function confirmDelete() {
    if (!toDelete) return;
    remove.mutate(toDelete.id, { onSuccess: () => setToDelete(null) });
  }

  return (
    <>
      <ListShell
        title={t('list.title')}
        subtitle={t('list.subtitle')}
        actions={[
          {
            id: 'add',
            label: t('list.add'),
            icon: <Plus aria-hidden className="size-4" />,
            priority: 'primary',
            onClick: () => setCreateOpen(true),
          },
        ]}
        tableId="exam-templates-list"
        caption={t('list.caption')}
        paginated={false}
        columns={[
          {
            id: 'name',
            header: t('list.columnName'),
            card: 'title',
            accessorFn: (row) => renderName?.(row) ?? row.name,
          },
          {
            id: 'kind',
            header: t('list.columnKind'),
            accessorFn: (row) => t(`kind.${row.kind}`, { ns: 'exams' }),
          },
          {
            id: 'grades',
            header: t('list.columnGrades'),
            accessorFn: (row) => gradesLabel(row.classGrades),
          },
          {
            id: 'rows',
            header: t('list.columnRows'),
            align: 'end',
            accessorFn: (row) => formatNumber(row.rowCount, config),
          },
        ]}
        rowActions={(row) => [
          { intent: 'edit', label: t('list.edit'), to: `/exams/templates/${row.id}` },
          {
            intent: 'delete',
            label: t('list.deleteRow', { name: row.name }),
            onClick: () => {
              remove.reset();
              setToDelete(row);
            },
          },
        ]}
        data={query.data ?? []}
        getRowId={(row) => row.id}
        // ponytail: server returns name-sorted rows; no client re-sort until asked
        sorting={null}
        onSortingChange={() => undefined}
        page={1}
        pageSize={Math.max(query.data?.length ?? 0, 1)}
        totalCount={query.data?.length ?? 0}
        onPageChange={() => undefined}
        loading={query.isLoading}
        isFetching={query.isFetching}
        {...(query.isError ? { error: t('list.errorMessage') } : {})}
        emptyState={{
          icon: <FileStack aria-hidden className="size-6" />,
          title: t('list.emptyTitle'),
          explanation: t('list.emptyText'),
        }}
        announceResults={(count, total) =>
          t('list.announceResults', { visible: count, total, count: total })
        }
      />

      <TemplateFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={(template) => {
          setCreateOpen(false);
          onCreated(template);
        }}
      />

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
        title={t('delete.title')}
        description={
          remove.isError
            ? `${t('delete.description', { name: toDelete?.name ?? '' })} ${t('delete.errorMessage')}`
            : t('delete.description', { name: toDelete?.name ?? '' })
        }
        confirmLabel={t('delete.confirm')}
        tone="danger"
        busy={remove.isPending}
        onConfirm={confirmDelete}
      />
    </>
  );
}

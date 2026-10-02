/**
 * [35.4.5] Exam templates list — `ListShell` (table on desktop, cards on
 * phone via DataTable's card mode), "New template" dialog, and a per-row
 * delete behind a confirm dialog. No route here ([35.4.9] adds it): the
 * route supplies `renderName` (the link into the detail) and `onCreated`.
 */
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { ListShell } from '@biddaloy/ui/shells';
import * as React from 'react';

import { TemplateFormDialog } from './-template-form-dialog';
import {
  type ExamTemplateDetail,
  type ExamTemplateSummary,
  useDeleteExamTemplate,
  useExamTemplates,
} from './use-exam-templates';

export interface TemplatesListProps {
  /** Renders a template's name cell — the route passes a `<Link>` to the detail. */
  renderName?: (template: ExamTemplateSummary) => React.ReactNode;
  onCreated: (template: ExamTemplateDetail) => void;
}

export function TemplatesList({ renderName, onCreated }: TemplatesListProps) {
  const { t } = useTranslation('examTemplates');
  const query = useExamTemplates();
  const remove = useDeleteExamTemplate();
  const [createOpen, setCreateOpen] = React.useState(false);
  const [toDelete, setToDelete] = React.useState<ExamTemplateSummary | null>(null);

  function confirmDelete() {
    if (!toDelete) return;
    remove.mutate(toDelete.id, { onSuccess: () => setToDelete(null) });
  }

  return (
    <>
      <ListShell
        title={t('list.title')}
        primaryAction={
          <Button type="button" onClick={() => setCreateOpen(true)}>
            {t('list.add')}
          </Button>
        }
        tableId="exam-templates-list"
        caption={t('list.caption')}
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
            id: 'rows',
            header: t('list.columnRows'),
            align: 'end',
            accessorFn: (row) => row.rowCount,
          },
          {
            id: 'grades',
            header: t('list.columnGrades'),
            accessorFn: (row) => row.classGrades.join(', ') || '—',
          },
          {
            id: 'actions',
            header: t('list.columnActions'),
            pinned: true,
            card: 'actions',
            accessorFn: (row) => (
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={t('list.deleteRow', { name: row.name })}
                onClick={() => {
                  remove.reset();
                  setToDelete(row);
                }}
              >
                {t('list.delete')}
              </Button>
            ),
          },
        ]}
        data={query.data ?? []}
        getRowId={(row) => row.id}
        // ponytail: server returns name-sorted rows; no client re-sort until asked
        sorting={null}
        onSortingChange={() => undefined}
        page={1}
        pageSize={Math.max(query.data?.length ?? 0, 10)}
        totalCount={query.data?.length ?? 0}
        onPageChange={() => undefined}
        onPageSizeChange={() => undefined}
        pageSizeLabel={t('pagination.rowsPerPage', { ns: 'common' })}
        loading={query.isLoading}
        isFetching={query.isFetching}
        {...(query.isError ? { error: t('list.errorMessage') } : {})}
        emptyMessage={t('list.emptyMessage')}
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

      <Dialog open={toDelete !== null} onOpenChange={(open) => !open && setToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('delete.title')}</DialogTitle>
            <DialogDescription>
              {t('delete.description', { name: toDelete?.name ?? '' })}
            </DialogDescription>
          </DialogHeader>
          {remove.isError && (
            <p role="alert" className="text-sm text-destructive">
              {remove.error instanceof Error ? remove.error.message : t('delete.errorMessage')}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setToDelete(null)}>
              {t('actions.cancel', { ns: 'common' })}
            </Button>
            <Button
              type="button"
              variant="destructive"
              loading={remove.isPending}
              onClick={confirmDelete}
            >
              {t('delete.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

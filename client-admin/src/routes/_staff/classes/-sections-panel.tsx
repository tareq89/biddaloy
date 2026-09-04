/**
 * A class's sections — name, capacity, enrolled count — with inline
 * create/edit/delete. Shared by two call sites, not duplicated:
 * `index.tsx`'s `renderExpandedRow` (the inline expansion panel the
 * issue's own AC asks for) and `$classId.tsx`'s Sections tab
 * (`-detail/sections-tab.tsx`) — same data, same actions, only the
 * surrounding chrome differs.
 *
 * Renders through `DataTable` rather than the raw `Table` primitive so
 * this list gets the same card-mode fallback at narrow container widths
 * as every other list — see `StudentsTab`'s identical comment on why.
 * `useClassSections` returns the whole roster unpaginated, so `DataTable`
 * gets a local page slice — same pattern as `TeachersTab`.
 */
import { Permission } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  CachedDataNotice,
  DataTable,
  ErrorState,
  Skeleton,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import {
  classSectionsQueryOptions,
  useClassSections,
  useHasPermission,
  type ClassSectionWithCount,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

import { DeleteSectionDialog } from './-delete-section-dialog';
import { SectionFormDialog } from './-section-form-dialog';

const PAGE_SIZE = 20;

export interface SectionsPanelProps {
  classId: string;
  className: string;
  /** `index.tsx`'s inline expansion panel needs its own padding (the
   * `<td>` it sits in is `p-0`); `$classId.tsx`'s Sections tab sits inside
   * `DetailShell`'s already-unpadded `TabsContent` (same as every other
   * tab in this route — see `-detail/*-tab.tsx`), so it opts out.
   * Defaults `true` for the expansion-panel call site, the more common
   * one today. */
  padded?: boolean;
}

export function SectionsPanel({ classId, className, padded = true }: SectionsPanelProps) {
  const { t } = useTranslation('classes');
  const { t: tCommon } = useTranslation('common');
  const canManage = useHasPermission(Permission.CLASS_MANAGE);
  const query = useClassSections(classId);

  const [createOpen, setCreateOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<ClassSectionWithCount | null>(null);
  const [deleting, setDeleting] = React.useState<ClassSectionWithCount | null>(null);
  const [page, setPage] = React.useState(1);

  if (query.isPending) {
    return (
      <div className={`flex flex-col gap-2 ${padded ? 'p-4' : ''}`} aria-hidden="true">
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-full" />
      </div>
    );
  }

  if (query.isError) {
    const forbidden = query.error instanceof ApiError && query.error.statusCode === 403;
    return (
      <div className={padded ? 'p-4' : undefined}>
        <ErrorState
          message={forbidden ? t('detail.forbidden') : t('sections.errorMessage')}
          retryLabel={tCommon('actions.retry')}
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  }

  const sections = query.data ?? [];

  const columns: DataTableColumn<ClassSectionWithCount>[] = [
    {
      id: 'name',
      header: t('sections.columnName'),
      accessorFn: (section) => section.section_name,
    },
    {
      id: 'capacity',
      header: t('sections.columnCapacity'),
      accessorFn: (section) => section.capacity ?? t('sections.noCapacity'),
    },
    {
      id: 'enrolled',
      header: t('sections.columnEnrolled'),
      accessorFn: (section) => section.enrolled_count,
    },
    ...(canManage
      ? [
          {
            id: 'actions',
            header: t('sections.columnActions'),
            pinned: true,
            accessorFn: (section: ClassSectionWithCount) => (
              <div className="flex gap-3">
                <button
                  type="button"
                  className="inline-flex min-h-6 min-w-6 items-center justify-center text-sm font-medium text-primary underline"
                  onClick={() => setEditing(section)}
                >
                  {t('sections.edit')}
                </button>
                <button
                  type="button"
                  className="inline-flex min-h-6 min-w-6 items-center justify-center text-sm font-medium text-destructive underline"
                  onClick={() => setDeleting(section)}
                >
                  {t('sections.delete')}
                </button>
              </div>
            ),
          } satisfies DataTableColumn<ClassSectionWithCount>,
        ]
      : []),
  ];

  return (
    <div className={`flex flex-col gap-3 ${padded ? 'p-4' : ''}`}>
      {/* [8.12.3]: lives here rather than in `$classId.tsx` so both
          consumers of this panel — the class detail page's Sections tab
          and the list page's inline expansion — label stale sections,
          not just one of them. */}
      <CachedDataNotice queryKey={classSectionsQueryOptions(classId).queryKey} />
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{t('sections.heading', { className })}</h2>
        {canManage && (
          <Button type="button" size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
            {t('sections.addSection')}
          </Button>
        )}
      </div>

      <DataTable
        tableId="class-detail-sections"
        caption={t('sections.columnName')}
        columns={columns}
        data={sections.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)}
        getRowId={(section) => section.id}
        sorting={null}
        onSortingChange={() => {}}
        page={page}
        pageSize={PAGE_SIZE}
        totalCount={sections.length}
        onPageChange={setPage}
        emptyMessage={t('sections.emptyMessage')}
      />

      {canManage && (
        <SectionFormDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          mode="create"
          classId={classId}
          onSaved={() => setCreateOpen(false)}
        />
      )}

      {canManage && editing && (
        <SectionFormDialog
          open={editing !== null}
          onOpenChange={(open) => !open && setEditing(null)}
          mode="edit"
          classId={classId}
          sectionId={editing.id}
          initialValues={{
            sectionName: editing.section_name,
            capacity: editing.capacity ?? undefined,
          }}
          onSaved={() => setEditing(null)}
        />
      )}

      {canManage && deleting && (
        <DeleteSectionDialog
          open={deleting !== null}
          onOpenChange={(open) => !open && setDeleting(null)}
          classId={classId}
          sectionId={deleting.id}
          sectionName={deleting.section_name}
          onDeleted={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

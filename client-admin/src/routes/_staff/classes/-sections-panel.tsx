/**
 * A class's sections — name, group, capacity, enrolled count — with inline
 * create/edit/delete, shown in the class detail page's Sections tab
 * (`-detail/sections-tab.tsx`). A class has a handful of sections, so the
 * table is unpaginated (the list page no longer expands rows into this).
 *
 * Renders through `DataTable` rather than the raw `Table` primitive so
 * this list gets the same card-mode fallback at narrow container widths
 * as every other list — see `StudentsTab`'s identical comment on why.
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
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { LayoutGridIcon, PlusIcon } from 'lucide-react';
import * as React from 'react';

import { DeleteSectionDialog } from './-delete-section-dialog';
import { SectionFormDialog } from './-section-form-dialog';

export interface SectionsPanelProps {
  classId: string;
}

export function SectionsPanel({ classId }: SectionsPanelProps) {
  const { t } = useTranslation('classes');
  const { t: tCommon } = useTranslation('common');
  const regionConfig = useTenantRegionConfig();
  const canManage = useHasPermission(Permission.CLASS_MANAGE);
  const query = useClassSections(classId);

  const [createOpen, setCreateOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<ClassSectionWithCount | null>(null);
  const [deleting, setDeleting] = React.useState<ClassSectionWithCount | null>(null);

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-2" aria-hidden="true">
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-full" />
      </div>
    );
  }

  if (query.isError) {
    const forbidden = query.error instanceof ApiError && query.error.statusCode === 403;
    return (
      <ErrorState
        message={forbidden ? t('detail.forbidden') : t('sections.errorMessage')}
        retryLabel={tCommon('actions.retry')}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const sections = query.data ?? [];

  const columns: DataTableColumn<ClassSectionWithCount>[] = [
    {
      id: 'name',
      header: t('sections.columnName'),
      accessorFn: (section) => <span className="font-medium">{section.section_name}</span>,
    },
    {
      id: 'group',
      header: t('sectionForm.groupLabel'),
      accessorFn: (section) => section.group_name ?? '—',
    },
    {
      id: 'capacity',
      header: t('sections.columnCapacity'),
      accessorFn: (section) =>
        section.capacity == null
          ? t('sections.noCapacity')
          : formatNumber(section.capacity, regionConfig),
      align: 'end',
    },
    {
      id: 'enrolled',
      header: t('sections.columnEnrolled'),
      accessorFn: (section) => formatNumber(section.enrolled_count, regionConfig),
      align: 'end',
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* [8.12.3]: labels stale sections. */}
      <CachedDataNotice queryKey={classSectionsQueryOptions(classId).queryKey} />
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-h2">{t('sections.heading')}</h2>
          <p className="mt-0.5 text-text-secondary">{t('sectionForm.description')}</p>
        </div>
        {canManage && (
          <Button type="button" className="w-full md:w-auto" onClick={() => setCreateOpen(true)}>
            <PlusIcon aria-hidden="true" />
            {t('sections.addSection')}
          </Button>
        )}
      </div>

      <DataTable
        tableId="class-detail-sections"
        caption={t('sections.caption')}
        columns={columns}
        data={sections}
        getRowId={(section) => section.id}
        sorting={null}
        onSortingChange={() => {}}
        paginated={false}
        totalCount={sections.length}
        rowActions={(section) => [
          {
            intent: 'edit',
            label: t('sections.edit'),
            onClick: () => setEditing(section),
            allowed: canManage,
          },
          {
            intent: 'delete',
            label: t('sections.delete'),
            onClick: () => setDeleting(section),
            allowed: canManage,
          },
        ]}
        emptyState={{
          icon: <LayoutGridIcon aria-hidden="true" />,
          title: t('sections.emptyMessage'),
          explanation: t('sections.emptyExplanation'),
        }}
      />

      {canManage && createOpen && (
        <SectionFormDialog
          open
          onOpenChange={setCreateOpen}
          mode="create"
          classId={classId}
          onSaved={() => setCreateOpen(false)}
        />
      )}

      {canManage && editing && (
        <SectionFormDialog
          open
          onOpenChange={(open) => !open && setEditing(null)}
          mode="edit"
          classId={classId}
          sectionId={editing.id}
          initialValues={{
            sectionName: editing.section_name,
            capacity: editing.capacity ?? undefined,
            groupName: editing.group_name ?? null,
          }}
          onSaved={() => setEditing(null)}
        />
      )}

      {canManage && deleting && (
        <DeleteSectionDialog
          open
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

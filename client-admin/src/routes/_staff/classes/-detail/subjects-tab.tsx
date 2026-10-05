/**
 * [9.1] Class detail page's Subjects tab — which subjects this class
 * offers in its academic year, with attach/remove for CLASS_MANAGE
 * holders. Structure mirrors `-sections-panel.tsx` (own query, own
 * create/delete dialogs), rendered through `DataTable` for the same
 * narrow-container card-mode fallback every other tab gets.
 */
import { Permission } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  DataTable,
  ErrorState,
  Skeleton,
  StatusBadge,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import { useClassSubjects, useHasPermission, type ClassSubject } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { BookOpenIcon, PlusIcon } from 'lucide-react';
import * as React from 'react';

import { AttachSubjectDialog } from '../-attach-subject-dialog';
import { RemoveSubjectDialog } from '../-remove-subject-dialog';
import { PresetWarningBanner } from '../../../../components/PresetWarningBanner';

export interface SubjectsTabProps {
  classId: string;
  academicYearId: string;
}

export function SubjectsTab({ classId, academicYearId }: SubjectsTabProps) {
  const { t, i18n } = useTranslation('classes');
  const { t: tCommon } = useTranslation('common');
  const canManage = useHasPermission(Permission.CLASS_MANAGE);
  // The banner's status call is ADMIN-only; skip it for other viewers.
  const canSeePresetBanner = useHasPermission(Permission.CURRICULUM_PRESET_APPLY);

  const query = useClassSubjects(classId, academicYearId);
  const [attachOpen, setAttachOpen] = React.useState(false);
  const [removing, setRemoving] = React.useState<ClassSubject | null>(null);

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
        message={forbidden ? t('detail.forbidden') : t('subjects.errorMessage')}
        retryLabel={tCommon('actions.retry')}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const classSubjects = query.data ?? [];

  // Bangla name when the viewer reads Bangla and one is set.
  const subjectName = (row: ClassSubject) =>
    i18n.language === 'bn' && row.subject.name_bn ? row.subject.name_bn : row.subject.name_en;

  const columns: DataTableColumn<ClassSubject>[] = [
    {
      id: 'name',
      header: t('subjects.columnName'),
      accessorFn: (row) => <span className="font-medium">{subjectName(row)}</span>,
    },
    {
      id: 'code',
      header: t('subjects.columnCode'),
      accessorFn: (row) => row.subject.code,
    },
    {
      id: 'optional',
      header: t('subjects.columnOptional'),
      accessorFn: (row) =>
        row.is_optional ? <StatusBadge tone="neutral" label={t('subjects.optional')} /> : null,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {canSeePresetBanner && <PresetWarningBanner />}
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <h2 className="text-h2">{t('subjects.heading')}</h2>
        {canManage && (
          <Button type="button" className="w-full md:w-auto" onClick={() => setAttachOpen(true)}>
            <PlusIcon aria-hidden="true" />
            {t('subjects.addSubject')}
          </Button>
        )}
      </div>

      <DataTable
        tableId="class-detail-subjects"
        caption={t('subjects.caption')}
        columns={columns}
        data={classSubjects}
        getRowId={(row) => row.id}
        sorting={null}
        onSortingChange={() => {}}
        paginated={false}
        totalCount={classSubjects.length}
        rowActions={(row) => [
          {
            intent: 'remove',
            label: t('subjects.remove'),
            onClick: () => setRemoving(row),
            allowed: canManage,
          },
        ]}
        emptyState={{
          icon: <BookOpenIcon aria-hidden="true" />,
          title: t('subjects.emptyMessage'),
          explanation: t('subjects.emptyExplanation'),
        }}
      />

      {canManage && attachOpen && (
        <AttachSubjectDialog
          open
          onOpenChange={setAttachOpen}
          classId={classId}
          academicYearId={academicYearId}
          excludeSubjectIds={classSubjects.map((row) => row.subject_id)}
          onSaved={() => setAttachOpen(false)}
        />
      )}

      {canManage && removing && (
        <RemoveSubjectDialog
          open
          onOpenChange={(open) => !open && setRemoving(null)}
          classId={classId}
          academicYearId={academicYearId}
          subjectId={removing.subject_id}
          subjectName={subjectName(removing)}
          onRemoved={() => setRemoving(null)}
        />
      )}
    </div>
  );
}

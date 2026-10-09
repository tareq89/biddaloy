import { Permission } from '@biddaloy/shared';
import {
  Button,
  Card,
  DataTable,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@biddaloy/ui/components';
import {
  useGuardian,
  useHasPermission,
  useUpdateGuardian,
  type Guardian,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { UserRoundPenIcon } from 'lucide-react';
import * as React from 'react';

import { StudentPicker } from '../-student-picker';

import { TabQueryState } from './tab-query-state';

export interface LinkedStudentsTabProps {
  guardianId: string;
}

/**
 * [8.11.4]'s Linked Students tab — a table of every student this guardian
 * is responsible for (each row views that student), plus an edit dialog
 * backed by `StudentPicker` that replaces the guardian's full `student_ids`
 * set via `useUpdateGuardian`, mirroring `GuardianService.update`'s own
 * "replace, don't merge" semantics.
 */
export function LinkedStudentsTab({ guardianId }: LinkedStudentsTabProps) {
  const { t } = useTranslation('guardians');
  const regionConfig = useRegionConfig();
  const query = useGuardian(guardianId);
  const canUpdate = useHasPermission(Permission.GUARDIAN_UPDATE);
  const [editing, setEditing] = React.useState(false);

  return (
    <TabQueryState
      query={query}
      forbiddenMessage={t('detail.forbidden')}
      errorMessage={t('detail.loadError')}
    >
      {(guardian) => (
        <Card className="overflow-hidden">
          <div className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between md:p-5">
            <div>
              <h2 className="text-h3">{t('detail.linkedStudents.title')}</h2>
              <p className="mt-1 text-text-secondary">{t('detail.linkedStudents.description')}</p>
            </div>
            {canUpdate && (
              <Button type="button" variant="outline" onClick={() => setEditing(true)}>
                <UserRoundPenIcon aria-hidden="true" />
                {t('detail.linkedStudents.editAction')}
              </Button>
            )}
          </div>
          <DataTable
            tableId="guardian-linked-students"
            caption={t('detail.linkedStudents.title')}
            paginated={false}
            sorting={null}
            onSortingChange={() => undefined}
            totalCount={guardian.students.length}
            data={guardian.students}
            getRowId={(student) => student.id}
            columns={[
              {
                id: 'name',
                header: t('detail.linkedStudents.columnName'),
                accessorFn: (student) => student.full_name,
                card: 'title',
              },
              {
                id: 'class',
                header: t('detail.linkedStudents.columnClass'),
                accessorFn: (student) =>
                  `${student.class_section.class.name} · ${student.class_section.section_name}`,
              },
              {
                id: 'roll',
                header: t('detail.linkedStudents.columnRoll'),
                align: 'end',
                accessorFn: (student) =>
                  student.roll_number == null
                    ? t('list.emptyValue')
                    : formatNumber(student.roll_number, regionConfig),
              },
              {
                id: 'registration',
                header: t('detail.linkedStudents.columnRegistration'),
                accessorFn: (student) => student.registration_number,
              },
            ]}
            rowActions={(student) => [
              {
                intent: 'view',
                label: t('list.view'),
                to: `/students/${student.id}`,
                'data-focus-anchor': student.id,
              },
            ]}
            emptyState={{
              title: t('detail.linkedStudents.emptyMessage'),
              explanation: t('detail.linkedStudents.emptyExplanation'),
            }}
          />
          {editing && (
            <EditLinkedStudentsDialog guardian={guardian} onClose={() => setEditing(false)} />
          )}
        </Card>
      )}
    </TabQueryState>
  );
}

function EditLinkedStudentsDialog({
  guardian,
  onClose,
}: {
  guardian: Guardian;
  onClose: () => void;
}) {
  const { t } = useTranslation('guardians');
  const updateGuardian = useUpdateGuardian(guardian.id);
  const [selectedIds, setSelectedIds] = React.useState<string[]>(() =>
    guardian.students.map((student) => student.id),
  );
  const pending = updateGuardian.isPending;

  return (
    // Mounted only while open, so selection and error state are fresh each time.
    // A pending save cannot be dismissed (Esc / outside click / X / Cancel).
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{t('detail.linkedStudents.editAction')}</DialogTitle>
        </DialogHeader>
        <StudentPicker
          selectedIds={selectedIds}
          onSelectedIdsChange={setSelectedIds}
          initialStudents={guardian.students}
        />
        {updateGuardian.isError && (
          <p role="alert" className="text-destructive">
            {t('detail.linkedStudents.saveErrorMessage')}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
            {t('detail.linkedStudents.cancelAction')}
          </Button>
          <Button
            type="button"
            loading={pending}
            onClick={() =>
              updateGuardian.mutate({ student_ids: selectedIds }, { onSuccess: onClose })
            }
          >
            {pending ? t('detail.linkedStudents.saving') : t('detail.linkedStudents.saveAction')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

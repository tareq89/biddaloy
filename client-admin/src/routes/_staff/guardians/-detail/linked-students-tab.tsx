import {
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@biddaloy/ui/components';
import { useGuardian, useUpdateGuardian } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { Link } from '@tanstack/react-router';
import * as React from 'react';

import { StudentPicker } from '../-student-picker';

import { TabQueryState } from './tab-query-state';

export interface LinkedStudentsTabProps {
  guardianId: string;
}

/**
 * [8.11.4]'s Linked Students tab — a read-only table of every student
 * this guardian is responsible for, each linking to that student's own
 * detail page, plus an edit mode backed by `StudentPicker`
 * (`GuardianPicker`'s reverse-direction sibling) that replaces the
 * guardian's full `student_ids` set via `useUpdateGuardian`, mirroring
 * `GuardianService.update`'s own "replace, don't merge" semantics.
 */
export function LinkedStudentsTab({ guardianId }: LinkedStudentsTabProps) {
  const { t } = useTranslation('guardians');
  const query = useGuardian(guardianId);
  const updateGuardian = useUpdateGuardian(guardianId);
  const [editing, setEditing] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);

  function startEditing(currentStudentIds: string[]) {
    setSelectedIds(currentStudentIds);
    updateGuardian.reset();
    setEditing(true);
  }

  function handleSave() {
    updateGuardian.mutate({ student_ids: selectedIds }, { onSuccess: () => setEditing(false) });
  }

  return (
    <TabQueryState
      query={query}
      forbiddenMessage={t('detail.forbidden')}
      errorMessage={t('detail.loadError')}
    >
      {(guardian) => (
        <div className="flex flex-col gap-3">
          {editing ? (
            <>
              <StudentPicker
                selectedIds={selectedIds}
                onSelectedIdsChange={setSelectedIds}
                initialStudents={guardian.students}
              />
              {updateGuardian.isError && (
                <p role="alert" className="text-sm text-destructive">
                  {t('detail.linkedStudents.saveErrorMessage')}
                </p>
              )}
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  loading={updateGuardian.isPending}
                  onClick={handleSave}
                >
                  {updateGuardian.isPending
                    ? t('detail.linkedStudents.saving')
                    : t('detail.linkedStudents.saveAction')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing(false)}
                  disabled={updateGuardian.isPending}
                >
                  {t('detail.linkedStudents.cancelAction')}
                </Button>
              </div>
            </>
          ) : (
            <>
              <div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => startEditing(guardian.students.map((student) => student.id))}
                >
                  {t('detail.linkedStudents.editAction')}
                </Button>
              </div>
              {guardian.students.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t('detail.linkedStudents.emptyMessage')}
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('detail.linkedStudents.columnName')}</TableHead>
                      <TableHead>{t('detail.linkedStudents.columnClass')}</TableHead>
                      <TableHead>{t('detail.linkedStudents.columnSection')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {guardian.students.map((student) => (
                      <TableRow key={student.id}>
                        <TableCell>
                          <Link
                            to="/students/$studentId"
                            params={{ studentId: student.id }}
                            className="text-primary underline"
                          >
                            {student.full_name}
                          </Link>
                        </TableCell>
                        <TableCell>{student.class_section.class.name}</TableCell>
                        <TableCell>{student.class_section.section_name}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </>
          )}
        </div>
      )}
    </TabQueryState>
  );
}

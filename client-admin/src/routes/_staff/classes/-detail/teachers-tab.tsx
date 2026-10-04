import { Permission } from '@biddaloy/shared';
import { Button, ErrorState, Skeleton } from '@biddaloy/ui/components';
import {
  useClassSections,
  useHasPermission,
  useSectionTeachers,
  useUnassignTeacher,
  type ClassSectionWithCount,
  type SectionTeacherAssignment,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

import { AssignTeacherDialog, sortByAssignmentType } from '../-assign-teacher-dialog';

import { TabQueryState } from './tab-query-state';

export interface TeachersTabProps {
  classId: string;
}

/** [29.0] Was read-only (teacher CRUD is still #177 — this tab never
 * creates/edits `Teacher` entities). Now assign/remove of section teacher
 * *assignments* lives here: one section can have one class-teacher and any
 * number of subject-teachers, so the tab is organized per-section (via
 * `useClassSections`) rather than as one class-wide roster — each section
 * gets its own `useSectionTeachers` query and its own Assign button, wired
 * to the shared `useAssignTeacher`/`useUnassignTeacher` hooks and
 * `AssignTeacherDialog` from wave 2. */
export function TeachersTab({ classId }: TeachersTabProps) {
  const { t } = useTranslation('classes');
  const canManage = useHasPermission(Permission.CLASS_MANAGE);
  const sectionsQuery = useClassSections(classId);
  const [assigningSection, setAssigningSection] = React.useState<ClassSectionWithCount | null>(
    null,
  );

  return (
    <div className="flex flex-col gap-4 p-4">
      <TabQueryState
        query={sectionsQuery}
        forbiddenMessage={t('detail.forbidden')}
        errorMessage={t('detail.teachers.errorMessage')}
      >
        {(sections) =>
          sections.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('detail.teachers.emptyMessage')}</p>
          ) : (
            sections.map((section) => (
              <SectionTeachersPanel
                key={section.id}
                classId={classId}
                section={section}
                canManage={canManage}
                onAssign={() => setAssigningSection(section)}
              />
            ))
          )
        }
      </TabQueryState>

      {canManage && assigningSection && (
        <AssignDialogForSection
          classId={classId}
          section={assigningSection}
          onClose={() => setAssigningSection(null)}
        />
      )}
    </div>
  );
}

/** Reads the section's current class teacher from the already-cached
 * `useSectionTeachers` query (same key as the panel's — no extra request). */
function AssignDialogForSection({
  classId,
  section,
  onClose,
}: {
  classId: string;
  section: ClassSectionWithCount;
  onClose: () => void;
}) {
  const query = useSectionTeachers(classId, section.id);
  const current = query.data?.find((a) => a.assignment_type === 'CLASS_TEACHER');
  return (
    <AssignTeacherDialog
      open
      onOpenChange={(open) => !open && onClose()}
      classId={classId}
      sectionId={section.id}
      currentClassTeacher={current && { teacherId: current.teacher_id, name: current.full_name }}
      onAssigned={onClose}
    />
  );
}

interface SectionTeachersPanelProps {
  classId: string;
  section: ClassSectionWithCount;
  canManage: boolean;
  onAssign: () => void;
}

function SectionTeachersPanel({
  classId,
  section,
  canManage,
  onAssign,
}: SectionTeachersPanelProps) {
  const { t } = useTranslation('classes');
  const query = useSectionTeachers(classId, section.id);
  const unassignTeacher = useUnassignTeacher(classId, section.id);
  // [47.4.1] Label comes from assignment_type, never subject nullness.
  const roleLabel = (a: SectionTeacherAssignment) =>
    a.assignment_type === 'SUBJECT_TEACHER' && a.subject_name
      ? `${t('assignmentType.SUBJECT_TEACHER')} · ${a.subject_name}`
      : t(`assignmentType.${a.assignment_type}`);

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{section.section_name}</h3>
        {canManage && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onAssign}
            aria-label={t('detail.teachers.assignAria', { section: section.section_name })}
          >
            {t('detail.teachers.assign')}
          </Button>
        )}
      </div>

      {query.isPending && (
        <div className="flex flex-col gap-2" aria-hidden="true">
          <Skeleton className="h-6 w-full" />
        </div>
      )}

      {query.isError && (
        <ErrorState
          message={t('detail.teachers.errorMessage')}
          retryLabel={t('actions.retry', { ns: 'common' })}
          onRetry={() => void query.refetch()}
        />
      )}

      {unassignTeacher.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t('detail.teachers.removeError')}
        </p>
      )}

      {query.data &&
        (query.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('detail.teachers.emptySectionMessage')}
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {sortByAssignmentType(query.data).map((assignment) => (
              <li key={assignment.id} className="flex items-center justify-between gap-2 text-sm">
                <span>
                  {assignment.full_name}
                  {' — '}
                  {roleLabel(assignment)}
                </span>
                {canManage && (
                  <button
                    type="button"
                    className="min-h-6 min-w-6 text-sm font-medium text-destructive underline disabled:opacity-50"
                    disabled={
                      unassignTeacher.isPending && unassignTeacher.variables === assignment.id
                    }
                    onClick={() => unassignTeacher.mutate(assignment.id)}
                    aria-label={t('detail.teachers.removeAria', {
                      name: assignment.full_name,
                      role: roleLabel(assignment),
                    })}
                  >
                    {t('detail.teachers.remove')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}

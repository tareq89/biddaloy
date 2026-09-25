/**
 * [29.0] Teaching assignments — bulk view across a class's sections. A
 * class picklist filters a `DataTable` of section-teacher rows, composed
 * client-side over that class's sections (`useClassSections`) with one
 * `useSectionTeachers` per section via `useQueries` — same composition
 * pattern `ui/src/hooks/invoices.ts`'s `useInvoiceSendCandidates` already
 * uses. Bounded by the *selected class's* section count (a handful), not
 * a global N+1 — `useClassTeachers(classId)` (one request) was considered
 * but its `ClassTeacher` rows are grouped by teacher with no per-section
 * assignment id, too thin for this table's per-row unassign action.
 *
 * Row actions reuse `-assign-teacher-dialog.tsx` and the unbound
 * `useUnassignTeacherAssignment` from wave 2
 * (`classes/-assign-teacher-dialog.tsx`, `ui/src/hooks/classes.ts`) — no
 * new dialog, no new hook. Unbound rather than the render-bound
 * `useUnassignTeacher(classId, sectionId)`: this table has no single fixed
 * class/section, and TanStack Query v5 pushes each render's mutation
 * options onto an in-flight mutation, so a bound hook would invalidate
 * whatever `classId`/`sectionId` happened to be in state when the DELETE
 * settles — wrong if the confirm dialog closed or the class filter changed
 * meanwhile.
 */
import { Permission } from '@biddaloy/shared';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  RoutePending,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import {
  classesQueryOptions,
  sectionTeachersQueryOptions,
  useClasses,
  useClassSections,
  useHasPermission,
  useUnassignTeacherAssignment,
  type SectionTeacherAssignment,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { ListShell, useListShellState } from '@biddaloy/ui/shells';
import { useQueries } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import * as React from 'react';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';
import { AssignTeacherDialog } from '../classes/-assign-teacher-dialog';

export const Route = createFileRoute('/_staff/staff/teaching-assignments')({
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(classesQueryOptions({})).catch(swallowUnlessOffline),
      loadRouteNamespaces('teacherAssignments', 'classes'),
    ]),
  pendingComponent: TeachingAssignmentsPending,
  component: TeachingAssignmentsPage,
});

// Radix `Select.Item` rejects an empty-string value — same sentinel
// convention `classes/index.tsx` uses for "All classes".
const NO_CLASS = ' __none__';

interface Row extends SectionTeacherAssignment {
  classId: string;
}

function TeachingAssignmentsPage() {
  const { t } = useTranslation('teacherAssignments');
  const canManage = useHasPermission(Permission.CLASS_MANAGE);
  const [state, actions] = useListShellState({ limit: 50 });

  const classesQuery = useClasses({});
  const selectedClassId = state.filters['classId'];
  const effectiveClassId =
    selectedClassId && selectedClassId !== NO_CLASS ? selectedClassId : undefined;

  const sectionsQuery = useClassSections(effectiveClassId);
  const sections = sectionsQuery.data ?? [];

  // One `useSectionTeachers`-equivalent query per section of the
  // *selected* class only (`useQueries`, not one hook call per section —
  // rules of hooks forbids a hook count that varies with data) — bounded,
  // not global N+1. Same composition `useInvoiceSendCandidates` uses in
  // `ui/src/hooks/invoices.ts`.
  const sectionTeacherQueries = useQueries({
    queries: sections.map((section) =>
      sectionTeachersQueryOptions(effectiveClassId ?? '', section.id),
    ),
  });

  const rows: Row[] = effectiveClassId
    ? sectionTeacherQueries.flatMap((query) =>
        (query.data ?? []).map((assignment) => ({ ...assignment, classId: effectiveClassId })),
      )
    : [];

  const isLoading =
    effectiveClassId !== undefined &&
    (sectionsQuery.isLoading || sectionTeacherQueries.some((query) => query.isLoading));
  const isFetching =
    effectiveClassId !== undefined &&
    (sectionsQuery.isFetching || sectionTeacherQueries.some((query) => query.isFetching));
  const isError = sectionsQuery.isError || sectionTeacherQueries.some((query) => query.isError);

  const [assignOpen, setAssignOpen] = React.useState(false);
  const [assignSectionId, setAssignSectionId] = React.useState<string | null>(null);
  const [unassigning, setUnassigning] = React.useState<Row | null>(null);

  const unassignTeacher = useUnassignTeacherAssignment();

  React.useEffect(() => {
    if (unassigning) unassignTeacher.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [unassigning]);

  const columns: DataTableColumn<Row>[] = [
    {
      id: 'teacher',
      header: t('list.columnTeacher'),
      accessorFn: (row) => row.full_name,
    },
    {
      id: 'section',
      header: t('list.columnSection'),
      accessorFn: (row) => row.section_name,
    },
    {
      id: 'role',
      header: t('list.columnRole'),
      accessorFn: (row) =>
        row.subject_id ? t('list.roleSubjectTeacher') : t('list.roleClassTeacher'),
    },
    {
      id: 'subject',
      header: t('list.columnSubject'),
      accessorFn: (row) => row.subject_name ?? '—',
    },
    ...(canManage
      ? [
          {
            id: 'actions',
            header: t('list.columnActions'),
            pinned: true,
            accessorFn: (row: Row) => (
              <button
                type="button"
                onClick={() => setUnassigning(row)}
                className="text-sm font-medium text-destructive underline"
              >
                {t('list.unassign')}
              </button>
            ),
          } satisfies DataTableColumn<Row>,
        ]
      : []),
  ];

  return (
    <>
      <ListShell
        title={t('list.title')}
        primaryAction={
          canManage &&
          effectiveClassId && (
            <Button
              type="button"
              onClick={() => {
                setAssignSectionId((current) => current ?? sections[0]?.id ?? null);
                setAssignOpen(true);
              }}
              disabled={sections.length === 0}
            >
              {t('list.assign')}
            </Button>
          )
        }
        filterBar={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={selectedClassId ?? NO_CLASS}
              onValueChange={(value) => {
                actions.setFilters({ ...state.filters, classId: value });
                setAssignSectionId(null);
                // Class switch closes any open unassign confirm — its row
                // belongs to the old class filter, even though the mutation
                // itself now carries its own classId/sectionId and would
                // still target the right row if left open.
                setUnassigning(null);
              }}
            >
              <SelectTrigger aria-label={t('list.classLabel')}>
                <SelectValue placeholder={t('list.classPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CLASS}>{t('list.classPlaceholder')}</SelectItem>
                {classesQuery.data?.data.map((klass) => (
                  <SelectItem key={klass.id} value={klass.id}>
                    {klass.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Only shown once a class with 2+ sections is selected — a
                single-section class has nothing to choose, same "no chip
                for a single value" convention `classes/index.tsx` uses for
                its shift/version filters. Picks which section "Assign
                teacher" targets, since `AssignTeacherDialog` takes one
                fixed `sectionId`, not a picker of its own. */}
            {effectiveClassId && sections.length > 1 && (
              <Select
                value={assignSectionId ?? sections[0]!.id}
                onValueChange={(value) => setAssignSectionId(value)}
              >
                <SelectTrigger aria-label={t('list.sectionLabel')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sections.map((section) => (
                    <SelectItem key={section.id} value={section.id}>
                      {section.section_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        }
        tableId="teaching-assignments-list"
        caption={t('list.caption')}
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        sorting={state.sorting}
        onSortingChange={actions.setSorting}
        page={1}
        pageSize={Math.max(rows.length, 1)}
        totalCount={rows.length}
        onPageChange={() => {}}
        loading={isLoading}
        isFetching={isFetching}
        {...(isError ? { error: t('list.errorMessage') } : {})}
        emptyMessage={effectiveClassId ? t('list.emptyMessage') : t('list.selectClassPrompt')}
        announceResults={(count, total) => t('list.announceResults', { count, total })}
      />

      {canManage && effectiveClassId && assignSectionId && (
        <AssignTeacherDialog
          open={assignOpen}
          onOpenChange={setAssignOpen}
          classId={effectiveClassId}
          sectionId={assignSectionId}
          onAssigned={() => setAssignOpen(false)}
        />
      )}

      {canManage && unassigning && effectiveClassId && (
        <Dialog open={unassigning !== null} onOpenChange={(open) => !open && setUnassigning(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('unassignDialog.title')}</DialogTitle>
              <DialogDescription>
                {t('unassignDialog.description', {
                  teacherName: unassigning.full_name,
                  sectionName: unassigning.section_name,
                })}
              </DialogDescription>
            </DialogHeader>
            {unassignTeacher.isError && (
              <p role="alert" className="text-sm text-destructive">
                {t('unassignDialog.errorMessage')}
              </p>
            )}
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  {t('unassignDialog.cancel')}
                </Button>
              </DialogClose>
              <Button
                type="button"
                variant="destructive"
                loading={unassignTeacher.isPending}
                onClick={() =>
                  unassignTeacher.mutate(
                    {
                      classId: unassigning.classId,
                      sectionId: unassigning.section_id,
                      assignmentId: unassigning.id,
                    },
                    { onSuccess: () => setUnassigning(null) },
                  )
                }
              >
                {unassignTeacher.isPending
                  ? t('unassignDialog.unassigning')
                  : t('unassignDialog.confirm')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

function TeachingAssignmentsPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}

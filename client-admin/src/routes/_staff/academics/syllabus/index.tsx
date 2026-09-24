/**
 * [22.4.3] Academics → Syllabus. A class/subject picker narrows
 * `GET /syllabus-topics` (both params optional server-side, but the list
 * is meaningless without both — `pickToStart` covers the unpicked state);
 * the ordered topic list below it uses up/down buttons rather than
 * drag-and-drop for reordering — no existing drag-to-reorder pattern in
 * this repo to clone, and buttons are keyboard-operable for free (U3),
 * where a drag handle needs its own keyboard fallback anyway.
 *
 * Reordering swaps two rows' `sequence` values and sends both in one
 * `PATCH /syllabus-topics/reorder` call (`useReorderSyllabusTopics`) —
 * never a full-list resequence, so a big syllabus doesn't send N rows to
 * move one topic one place.
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
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@biddaloy/ui/components';
import {
  useClasses,
  useCreateSyllabusTopic,
  useDeleteSyllabusTopic,
  useHasPermission,
  useReorderSyllabusTopics,
  useSubjects,
  useSyllabusTopicList,
  useUpdateSyllabusTopic,
  type SyllabusTopic,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';
import { ArrowDown, ArrowUp } from 'lucide-react';
import * as React from 'react';

import { loadRouteNamespaces } from '../../../../route-loaders';

import { SyllabusTopicFormDialog, type SyllabusTopicFormPayload } from './-syllabus-topic-form';

export const Route = createFileRoute('/_staff/academics/syllabus/')({
  loader: () => loadRouteNamespaces('syllabus'),
  pendingComponent: SyllabusListPending,
  component: SyllabusListPage,
});

function SyllabusListPage() {
  const { t } = useTranslation('syllabus');
  const canManage = useHasPermission(Permission.SYLLABUS_MANAGE);

  const [classId, setClassId] = React.useState('');
  const [subjectId, setSubjectId] = React.useState('');

  const classesQuery = useClasses();
  const subjectsQuery = useSubjects({ limit: 100 });

  const hasSelection = classId !== '' && subjectId !== '';
  const topicsQuery = useSyllabusTopicList(
    hasSelection ? { class_id: classId, subject_id: subjectId } : {},
    { enabled: hasSelection },
  );
  const topics = hasSelection ? (topicsQuery.data ?? []) : [];
  const sortedTopics = [...topics].sort((a, b) => a.sequence - b.sequence);

  const createTopic = useCreateSyllabusTopic();
  const updateTopic = useUpdateSyllabusTopic();
  const deleteTopic = useDeleteSyllabusTopic();
  const reorderTopics = useReorderSyllabusTopics();

  const [createOpen, setCreateOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<SyllabusTopic | null>(null);
  const [deleting, setDeleting] = React.useState<SyllabusTopic | null>(null);

  function handleCreate(payload: SyllabusTopicFormPayload) {
    const lastTopic = sortedTopics.at(-1);
    const nextSequence = lastTopic ? lastTopic.sequence + 1 : 0;
    createTopic.mutate(
      { class_id: classId, subject_id: subjectId, sequence: nextSequence, ...payload },
      { onSuccess: () => setCreateOpen(false) },
    );
  }

  function handleUpdate(payload: SyllabusTopicFormPayload) {
    if (!editing) return;
    updateTopic.mutate({ id: editing.id, input: payload }, { onSuccess: () => setEditing(null) });
  }

  function handleDelete() {
    if (!deleting) return;
    deleteTopic.mutate(deleting.id, { onSuccess: () => setDeleting(null) });
  }

  function move(index: number, direction: -1 | 1) {
    const other = sortedTopics[index + direction];
    const current = sortedTopics[index];
    if (!other || !current) return;
    reorderTopics.mutate([
      { id: current.id, sequence: other.sequence },
      { id: other.id, sequence: current.sequence },
    ]);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t('list.title')}</h1>
        {canManage && hasSelection && (
          <Button type="button" onClick={() => setCreateOpen(true)}>
            {t('list.addTopic')}
          </Button>
        )}
      </div>

      <div className="flex gap-3">
        <div className="flex flex-1 flex-col gap-1.5">
          <label htmlFor="syllabus-class" className="text-sm font-medium">
            {t('list.classLabel')}
          </label>
          <Select value={classId} onValueChange={setClassId}>
            <SelectTrigger id="syllabus-class" aria-label={t('list.classLabel')}>
              <SelectValue placeholder={t('list.selectClass')} />
            </SelectTrigger>
            <SelectContent>
              {(classesQuery.data?.data ?? []).map((klass) => (
                <SelectItem key={klass.id} value={klass.id}>
                  {klass.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <label htmlFor="syllabus-subject" className="text-sm font-medium">
            {t('list.subjectLabel')}
          </label>
          <Select value={subjectId} onValueChange={setSubjectId}>
            <SelectTrigger id="syllabus-subject" aria-label={t('list.subjectLabel')}>
              <SelectValue placeholder={t('list.selectSubject')} />
            </SelectTrigger>
            <SelectContent>
              {(subjectsQuery.data?.data ?? []).map((subject) => (
                <SelectItem key={subject.id} value={subject.id}>
                  {subject.name_en}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!hasSelection && <p className="text-sm text-muted-foreground">{t('list.pickToStart')}</p>}

      {hasSelection && topicsQuery.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t('list.errorMessage')}
        </p>
      )}

      {hasSelection && topicsQuery.isLoading && (
        <p className="text-sm text-muted-foreground">{t('status.loading', { ns: 'common' })}</p>
      )}

      {hasSelection &&
        !topicsQuery.isLoading &&
        !topicsQuery.isError &&
        sortedTopics.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('list.emptyMessage')}</p>
        )}

      {hasSelection && sortedTopics.length > 0 && (
        <Table aria-label={t('list.caption')}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('list.columnName')}</TableHead>
              <TableHead>{t('list.columnDescription')}</TableHead>
              <TableHead>{t('list.columnStatus')}</TableHead>
              {canManage && <TableHead>{t('list.columnActions')}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedTopics.map((topic, index) => (
              <TableRow key={topic.id}>
                <TableCell>{topic.name}</TableCell>
                <TableCell>{topic.description ?? '—'}</TableCell>
                <TableCell>
                  <StatusBadge domain="syllabusTopic" status={topic.status} />
                </TableCell>
                {canManage && (
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={index === 0 || reorderTopics.isPending}
                        aria-label={t('list.moveUp', { name: topic.name })}
                        onClick={() => move(index, -1)}
                      >
                        <ArrowUp className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={index === sortedTopics.length - 1 || reorderTopics.isPending}
                        aria-label={t('list.moveDown', { name: topic.name })}
                        onClick={() => move(index, 1)}
                      >
                        <ArrowDown className="size-4" />
                      </Button>
                      <button
                        type="button"
                        onClick={() => setEditing(topic)}
                        className="text-sm font-medium text-primary underline"
                      >
                        {t('list.edit', { name: topic.name })}
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleting(topic)}
                        className="text-sm font-medium text-destructive underline"
                      >
                        {t('list.delete', { name: topic.name })}
                      </button>
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {reorderTopics.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t('list.reorderFailed')}
        </p>
      )}

      {canManage && hasSelection && (
        <SyllabusTopicFormDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          mode="create"
          isPending={createTopic.isPending}
          isError={createTopic.isError}
          onSubmit={handleCreate}
        />
      )}

      {canManage && editing && (
        <SyllabusTopicFormDialog
          key={editing.id}
          open={editing !== null}
          onOpenChange={(open) => !open && setEditing(null)}
          mode="edit"
          initialValues={{
            name: editing.name,
            description: editing.description,
            status: editing.status,
          }}
          isPending={updateTopic.isPending}
          isError={updateTopic.isError}
          onSubmit={handleUpdate}
        />
      )}

      {canManage && deleting && (
        <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('list.deleteConfirmTitle')}</DialogTitle>
              <DialogDescription>
                {t('list.deleteConfirmBody', { name: deleting.name })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  {t('form.cancel')}
                </Button>
              </DialogClose>
              <Button
                type="button"
                variant="destructive"
                loading={deleteTopic.isPending}
                onClick={handleDelete}
              >
                {t('list.deleteConfirmAction')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function SyllabusListPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}

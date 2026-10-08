/**
 * [22.4.3] (moved here from index.tsx by [66.3.g1-01]) Academics → Syllabus. A class/subject picker (kept in the URL)
 * narrows `GET /syllabus-topics` (both params optional server-side, but the
 * list is meaningless without both — the pick-to-start EmptyState covers the
 * unpicked state); the ordered topic list below it uses up/down buttons
 * rather than drag-and-drop for reordering — no existing drag-to-reorder
 * pattern in this repo to clone, and buttons are keyboard-operable for free
 * (U3), where a drag handle needs its own keyboard fallback anyway.
 *
 * Reordering swaps two rows' `sequence` values and sends both in one
 * `PATCH /syllabus-topics/reorder` call (`useReorderSyllabusTopics`) —
 * never a full-list resequence, so a big syllabus doesn't send N rows to
 * move one topic one place.
 */
import { Permission, SyllabusTopicStatus } from '@biddaloy/shared';
import { captureNotificationTenant, notifyOutcome } from '@biddaloy/ui/api';
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  RowActions,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableCount,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
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
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { ArrowDown, ArrowUp, BookOpen, ListOrdered, Pencil, Trash2 } from 'lucide-react';
import * as React from 'react';

import { subjectName } from '../homework/-subject-name';

import { SyllabusTopicFormDialog, type SyllabusTopicFormPayload } from './-syllabus-topic-form';

/** True on a phone viewport. Only one of the table / phone list is rendered,
 * so labels and buttons are never duplicated in the DOM. Desktop without
 * `matchMedia` (jsdom). */
function useIsPhone(): boolean {
  const query = '(max-width: 767px)';
  const [matches, setMatches] = React.useState(
    () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
  );
  React.useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(query);
    const onChange = () => setMatches(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return matches;
}

/** Selected class/subject, only once they match a loaded row (stale URL ids are ignored). */
export function useTopicsSelection(search: TopicsSearch) {
  const classesQuery = useClasses();
  const subjectsQuery = useSubjects({ limit: 100 });
  const selectedClass = (classesQuery.data?.data ?? []).find((c) => c.id === search.class_id);
  const selectedSubject = (subjectsQuery.data?.data ?? []).find((s) => s.id === search.subject_id);
  const classId = selectedClass?.id ?? '';
  const subjectId = selectedSubject?.id ?? '';
  return {
    classesQuery,
    subjectsQuery,
    selectedClass,
    selectedSubject,
    classId,
    subjectId,
    hasSelection: classId !== '' && subjectId !== '',
  };
}

export interface TopicsSearch {
  class_id?: string | undefined;
  subject_id?: string | undefined;
}

export function TopicsTab({
  search,
  onPick,
  createOpen,
  setCreateOpen,
}: {
  search: TopicsSearch;
  onPick: (key: 'class_id' | 'subject_id', value: string) => void;
  createOpen: boolean;
  setCreateOpen: (open: boolean) => void;
}) {
  const { t, i18n } = useTranslation('syllabus');
  const { t: tCommon } = useTranslation('common');
  const regionConfig = useTenantRegionConfig();
  const canManage = useHasPermission(Permission.SYLLABUS_MANAGE);
  const isPhone = useIsPhone();
  const {
    classesQuery,
    subjectsQuery,
    selectedClass,
    selectedSubject,
    classId,
    subjectId,
    hasSelection,
  } = useTopicsSelection(search);

  const topicsQuery = useSyllabusTopicList(
    hasSelection ? { class_id: classId, subject_id: subjectId } : {},
    { enabled: hasSelection },
  );
  const topics = hasSelection ? (topicsQuery.data ?? []) : [];
  const sortedTopics = [...topics].sort((a, b) => a.sequence - b.sequence);
  const doneCount = sortedTopics.filter((x) => x.status === SyllabusTopicStatus.DONE).length;

  const createTopic = useCreateSyllabusTopic();
  const updateTopic = useUpdateSyllabusTopic();
  const deleteTopic = useDeleteSyllabusTopic();
  const reorderTopics = useReorderSyllabusTopics();

  const [editing, setEditing] = React.useState<SyllabusTopic | null>(null);
  const [deleting, setDeleting] = React.useState<SyllabusTopic | null>(null);

  function notifyError(message: string) {
    notifyOutcome({ tenantId: captureNotificationTenant(), variant: 'error', message });
  }

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
    deleteTopic.mutate(deleting.id, {
      onSuccess: () => setDeleting(null),
      onError: () => notifyError(t('list.deleteFailed')),
    });
  }

  function move(index: number, direction: -1 | 1) {
    const other = sortedTopics[index + direction];
    const current = sortedTopics[index];
    if (!other || !current) return;
    reorderTopics.mutate(
      [
        { id: current.id, sequence: other.sequence },
        { id: other.id, sequence: current.sequence },
      ],
      { onError: () => notifyError(t('list.reorderFailed')) },
    );
  }

  const pickerPlaceholder = tCommon('form.selectPlaceholder');
  const subjectLabel = subjectName(selectedSubject, i18n.language);

  /** D31: how many of the class's sections have taught this topic. */
  const taughtHint = (topic: SyllabusTopic) =>
    topic.sections_planned !== undefined &&
    topic.sections_taught !== undefined &&
    topic.sections_planned > 0 ? (
      <p className="text-caption text-text-secondary">
        {t('topics.taughtIn', {
          taught: formatNumber(topic.sections_taught, regionConfig),
          total: formatNumber(topic.sections_planned, regionConfig),
        })}
      </p>
    ) : null;

  const renderMoveButtons = (topic: SyllabusTopic, index: number) => {
    const upDisabled = index === 0 || reorderTopics.isPending;
    const downDisabled = index === sortedTopics.length - 1 || reorderTopics.isPending;
    return (
      <>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-text-secondary"
              disabled={upDisabled}
              aria-label={t('list.moveUp', { name: topic.name })}
              onClick={() => move(index, -1)}
            >
              <ArrowUp className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('list.moveUpShort')}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-text-secondary"
              disabled={downDisabled}
              aria-label={t('list.moveDown', { name: topic.name })}
              onClick={() => move(index, 1)}
            >
              <ArrowDown className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('list.moveDownShort')}</TooltipContent>
        </Tooltip>
      </>
    );
  };

  const phoneButton =
    'inline-flex h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md text-label font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50';

  const topicCard = (
    <Card className="overflow-hidden">
      <div className="p-4 md:px-5">
        <h2 className="text-h2">{`${subjectLabel} · ${selectedClass?.name ?? ''}`}</h2>
        <p className="mt-1 text-text-secondary">
          {t('list.progress', {
            done: formatNumber(doneCount, regionConfig),
            total: formatNumber(sortedTopics.length, regionConfig),
          })}
        </p>
      </div>

      {!isPhone ? (
        <Table aria-label={t('list.caption')}>
          <TableHeader>
            <TableRow className="border-y border-border-subtle bg-muted text-label text-text-secondary">
              <TableHead className="h-10 w-16 px-4 text-end font-medium">
                {t('list.columnSequence')}
              </TableHead>
              <TableHead className="h-10 px-4 font-medium">{t('list.columnName')}</TableHead>
              <TableHead className="h-10 px-4 font-medium">{t('list.columnStatus')}</TableHead>
              {canManage && (
                <TableHead className="h-10 px-4 font-medium">{t('list.columnOrder')}</TableHead>
              )}
              {canManage && (
                <TableHead className="h-10 px-4 font-medium">{tCommon('table.actions')}</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody className="divide-y divide-border-subtle">
            {sortedTopics.map((topic, index) => (
              <TableRow key={topic.id} className="hover:bg-muted">
                <TableCell className="px-4 py-2 text-end tabular-nums">
                  {formatNumber(index + 1, regionConfig)}
                </TableCell>
                <TableCell className="px-4 py-2">
                  <p className="font-medium">{topic.name}</p>
                  {topic.description && (
                    <p className="text-caption text-text-secondary">{topic.description}</p>
                  )}
                  {taughtHint(topic)}
                </TableCell>
                <TableCell className="px-4 py-2">
                  <StatusBadge domain="syllabusTopic" status={topic.status} />
                </TableCell>
                {canManage && (
                  <TableCell className="px-4 py-2">
                    <TooltipProvider delayDuration={300}>
                      <div className="flex items-center gap-1">
                        {renderMoveButtons(topic, index)}
                      </div>
                    </TooltipProvider>
                  </TableCell>
                )}
                {canManage && (
                  <TableCell className="px-4 py-2">
                    <RowActions
                      actions={[
                        {
                          intent: 'edit',
                          label: t('list.edit', { name: topic.name }),
                          onClick: () => setEditing(topic),
                        },
                        {
                          intent: 'delete',
                          label: t('list.delete', { name: topic.name }),
                          onClick: () => setDeleting(topic),
                        },
                      ]}
                    />
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <ul className="divide-y divide-border-subtle border-t border-border-subtle">
          {sortedTopics.map((topic, index) => (
            <li key={topic.id}>
              <div className="flex items-start gap-3 px-4 pt-3">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-label text-text-secondary">
                  {formatNumber(index + 1, regionConfig)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium">{topic.name}</p>
                    <StatusBadge domain="syllabusTopic" status={topic.status} />
                  </div>
                  {topic.description && (
                    <p className="text-caption text-text-secondary">{topic.description}</p>
                  )}
                  {taughtHint(topic)}
                </div>
              </div>
              {canManage && (
                <div className="flex items-center px-1 py-1">
                  <button
                    type="button"
                    className={`${phoneButton} text-text-secondary`}
                    disabled={index === 0 || reorderTopics.isPending}
                    aria-label={t('list.moveUp', { name: topic.name })}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp className="size-4" aria-hidden="true" />
                    {t('list.moveUpShort')}
                  </button>
                  <button
                    type="button"
                    className={`${phoneButton} text-text-secondary`}
                    disabled={index === sortedTopics.length - 1 || reorderTopics.isPending}
                    aria-label={t('list.moveDown', { name: topic.name })}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown className="size-4" aria-hidden="true" />
                    {t('list.moveDownShort')}
                  </button>
                  <button
                    type="button"
                    className={`${phoneButton} text-primary`}
                    aria-label={t('list.edit', { name: topic.name })}
                    onClick={() => setEditing(topic)}
                  >
                    <Pencil className="size-4" aria-hidden="true" />
                    {t('list.editShort')}
                  </button>
                  <button
                    type="button"
                    className={`${phoneButton} text-destructive`}
                    aria-label={t('list.delete', { name: topic.name })}
                    onClick={() => setDeleting(topic)}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                    {t('list.deleteShort')}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="border-t border-border-subtle px-4 py-3">
        <TableCount total={sortedTopics.length} />
      </div>
    </Card>
  );

  let content: React.ReactNode;
  if (!hasSelection) {
    content = (
      <EmptyState
        icon={<BookOpen />}
        title={t('list.pickTitle')}
        explanation={t('list.pickToStart')}
      />
    );
  } else if (topicsQuery.isLoading) {
    content = (
      <Card aria-busy="true" className="flex flex-col gap-2 p-4">
        <Skeleton className="h-10 w-full" />
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </Card>
    );
  } else if (topicsQuery.isError) {
    content = (
      <ErrorState
        message={t('list.errorMessage')}
        retryLabel={tCommon('actions.retry')}
        onRetry={() => void topicsQuery.refetch()}
      />
    );
  } else if (sortedTopics.length === 0) {
    content = (
      <EmptyState
        icon={<ListOrdered />}
        title={t('list.emptyTitle')}
        explanation={t('list.emptyExplanation')}
        {...(canManage
          ? { action: { label: t('list.addTopic'), onClick: () => setCreateOpen(true) } }
          : {})}
      />
    );
  } else {
    content = topicCard;
  }

  return (
    <>
      <div className="grid gap-4 md:grid-cols-12">
        <div className="flex flex-col gap-1.5 md:col-span-4">
          <label htmlFor="syllabus-class" className="text-label text-text-primary">
            {t('list.classLabel')}
          </label>
          <Select value={classId} onValueChange={(value) => onPick('class_id', value)}>
            <SelectTrigger id="syllabus-class">
              <SelectValue placeholder={pickerPlaceholder} />
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
        <div className="flex flex-col gap-1.5 md:col-span-4">
          <label htmlFor="syllabus-subject" className="text-label text-text-primary">
            {t('list.subjectLabel')}
          </label>
          <Select value={subjectId} onValueChange={(value) => onPick('subject_id', value)}>
            <SelectTrigger id="syllabus-subject">
              <SelectValue placeholder={pickerPlaceholder} />
            </SelectTrigger>
            <SelectContent>
              {(subjectsQuery.data?.data ?? []).map((subject) => (
                <SelectItem key={subject.id} value={subject.id}>
                  {subjectName(subject, i18n.language)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {content}

      {canManage && hasSelection && (
        <SyllabusTopicFormDialog
          open={createOpen}
          onOpenChange={(open) => !createTopic.isPending && setCreateOpen(open)}
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
          onOpenChange={(open) => !open && !updateTopic.isPending && setEditing(null)}
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
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && !deleteTopic.isPending && setDeleting(null)}
          title={t('list.deleteConfirmTitle')}
          description={t('list.deleteConfirmBody', { name: deleting.name })}
          confirmLabel={t('list.deleteConfirmAction')}
          cancelLabel={tCommon('actions.cancel')}
          tone="danger"
          busy={deleteTopic.isPending}
          onConfirm={handleDelete}
        />
      )}
    </>
  );
}

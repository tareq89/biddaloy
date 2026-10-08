/**
 * [66.2] Lessons card of the study-plan detail page: desktop table + phone
 * card list, reorder (↑ ↓ buttons and Alt+↑/↓ on a row, like
 * `programs/-milestone-editor.tsx`), collapsed done / far-future runs, and
 * exam-marker rows. Dates, statuses and taught counts come from the schedule
 * endpoint; nothing date-related is computed here.
 */
import {
  Button,
  Card,
  ExamMarkerLine,
  ExamMarkerRow,
  ReorderButtons,
  RowActions,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  type StatusBadgeProps,
} from '@biddaloy/ui/components';
import type {
  StudyPlanDetail,
  StudyPlanLesson,
  StudyPlanScheduleResponse,
} from '@biddaloy/ui/hooks';
import type { SyllabusTopic } from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, formatDateRange, formatNumber } from '@biddaloy/ui/utils';
import { PencilIcon, Trash2Icon } from 'lucide-react';
import * as React from 'react';

type ScheduleLesson = StudyPlanScheduleResponse['lessons'][number];
type LessonStatus = ScheduleLesson['status'];

const STATUS_TONE: Record<LessonStatus, { tone: 'success' | 'info' | 'neutral'; key: string }> = {
  DONE: { tone: 'success', key: 'done' },
  IN_PROGRESS: { tone: 'info', key: 'inProgress' },
  UPCOMING: { tone: 'neutral', key: 'upcoming' },
};

/** Done lessons kept visible before the current one, and upcoming ones after it. */
const KEEP_DONE = 3;
const KEEP_AHEAD = 10;

/** True on a phone viewport. Desktop without `matchMedia` (jsdom). */
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

export interface LessonsTableProps {
  save: (
    lessons: StudyPlanLesson[],
    callbacks?: { onSuccess?: () => void; onError?: () => void },
  ) => void;
  isPending: boolean;
  lessons: StudyPlanLesson[];
  /** Absent while the schedule loads or failed: no collapsing, no dates. */
  schedule: StudyPlanScheduleResponse | undefined;
  topics: SyllabusTopic[];
  examMarkers: StudyPlanDetail['exam_markers'];
  editable: boolean;
  onEdit: (lesson: StudyPlanLesson) => void;
  onDelete: (lesson: StudyPlanLesson, index: number) => void;
  /** Absent: marker rows have no edit button (3-07 passes it). */
  onEditMarker?: (marker: StudyPlanDetail['exam_markers'][number]) => void;
}

export function LessonsTable({
  save,
  isPending,
  lessons,
  schedule,
  topics,
  examMarkers,
  editable,
  onEdit,
  onDelete,
  onEditMarker,
}: LessonsTableProps) {
  const { t } = useTranslation('studyPlans');
  const regionConfig = useTenantRegionConfig();
  const isPhone = useIsPhone();

  // Optimistic order while the PUT is in flight; cleared when the saved list arrives.
  const [order, setOrder] = React.useState<StudyPlanLesson[] | null>(null);
  React.useEffect(() => setOrder(null), [lessons]);
  const shown = order ?? lessons;

  const [showDone, setShowDone] = React.useState(false);
  const [showMore, setShowMore] = React.useState(false);
  const [announcement, setAnnouncement] = React.useState('');
  const containerRef = React.useRef<HTMLDivElement>(null);
  const focusId = React.useRef<string | null>(null);

  // After a keyboard move the row is in its new place: put focus back on it.
  React.useEffect(() => {
    if (!focusId.current) return;
    const row = containerRef.current?.querySelector<HTMLElement>(
      `[data-lesson-id="${focusId.current}"]`,
    );
    row?.focus();
    focusId.current = null;
  });

  const scheduleById = new Map((schedule?.lessons ?? []).map((l) => [l.id, l]));
  const topicById = new Map(topics.map((topic) => [topic.id, topic]));
  const routineMissing = schedule?.summary.routine_missing ?? false;
  const totalPeriods = shown.reduce((sum, lesson) => sum + lesson.periods, 0);
  const num = (n: number) => formatNumber(n, regionConfig);

  function statusOf(lesson: StudyPlanLesson): LessonStatus {
    return scheduleById.get(lesson.id)?.status ?? 'UPCOMING';
  }

  function move(from: number, to: number, viaKeyboard = false) {
    if (isPending || to < 0 || to >= shown.length) return;
    const next = [...shown];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    setOrder(next);
    setAnnouncement(t('detail.moved', { title: moved.title, position: num(to + 1) }));
    if (viaKeyboard) focusId.current = moved.id;
    save(next, { onError: () => setOrder(null) });
  }

  function handleKeyDown(event: React.KeyboardEvent, index: number) {
    if (!editable || !event.altKey) return;
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(index, index - 1, true);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(index, index + 1, true);
    }
  }

  // Collapsing needs statuses, so only once the schedule is here.
  const doneRun = schedule ? shown.findIndex((l) => statusOf(l) !== 'DONE') : 0;
  const leadingDone = doneRun === -1 ? shown.length : doneRun;
  const hiddenHead = schedule && leadingDone - KEEP_DONE >= 1 ? leadingDone - KEEP_DONE : 0;
  const inProgress = shown.findIndex((l) => statusOf(l) === 'IN_PROGRESS');
  const current = inProgress === -1 ? leadingDone : inProgress;
  const tailFrom = current + KEEP_AHEAD + 1;
  const hiddenTail = schedule && shown.length - tailFrom >= 1 ? tailFrom : shown.length;

  const markersByLesson = new Map<string, StudyPlanDetail['exam_markers']>();
  for (const marker of examMarkers) {
    markersByLesson.set(marker.up_to_lesson_id, [
      ...(markersByLesson.get(marker.up_to_lesson_id) ?? []),
      marker,
    ]);
  }

  function taughtUpTo(index: number): number {
    return shown.slice(0, index + 1).filter((l) => statusOf(l) === 'DONE').length;
  }

  function dateCell(lesson: StudyPlanLesson): React.ReactNode {
    const entry = scheduleById.get(lesson.id);
    if (routineMissing || !entry) return '—';
    if (entry.overflow) return <span className="text-status-due-fg">{t('detail.overflow')}</span>;
    if (!entry.expected_date) return '—';
    const text =
      !entry.expected_end_date || entry.expected_end_date === entry.expected_date
        ? formatDate(entry.expected_date, regionConfig)
        : formatDateRange(entry.expected_date, entry.expected_end_date, regionConfig);
    return (
      <>
        {text}
        {entry.in_extra_class && (
          <span className="block text-caption text-text-secondary">{t('detail.inExtraClass')}</span>
        )}
      </>
    );
  }

  function statusBadge(lesson: StudyPlanLesson) {
    const { tone, key } = STATUS_TONE[statusOf(lesson)];
    const props: StatusBadgeProps = { tone, label: t(`detail.status.${key}`) };
    return <StatusBadge {...props} />;
  }

  function topicName(lesson: StudyPlanLesson): string {
    return (lesson.topic_id && topicById.get(lesson.topic_id)?.name) || '—';
  }

  function reorderControls(lesson: StudyPlanLesson, index: number) {
    return (
      // A disabled fieldset disables the buttons inside while the PUT is pending.
      <fieldset disabled={isPending} className="m-0 flex min-w-0 items-center border-0 p-0">
        <ReorderButtons
          index={index}
          count={shown.length}
          onMove={(from, to) => move(from, to)}
          upLabel={t('detail.moveUp', { title: lesson.title })}
          downLabel={t('detail.moveDown', { title: lesson.title })}
        />
      </fieldset>
    );
  }

  const editMarker = onEditMarker
    ? (marker: StudyPlanDetail['exam_markers'][number]) => ({
        onEdit: () => onEditMarker(marker),
        editLabel: t('actions.examMarker'),
      })
    : () => ({});

  const doneButton = hiddenHead > 0 && (
    <CollapseButton
      expanded={showDone}
      onClick={() => setShowDone((v) => !v)}
      label={t('detail.showDone', { from: num(1), to: num(hiddenHead) })}
    />
  );
  const moreButton = hiddenTail < shown.length && (
    <CollapseButton
      expanded={showMore}
      onClick={() => setShowMore((v) => !v)}
      label={t('detail.showMore', {
        count: num(shown.length - hiddenTail),
        from: num(hiddenTail + 1),
        to: num(shown.length),
      })}
    />
  );

  const visible = shown
    .map((lesson, index) => ({ lesson, index }))
    .filter(({ index }) => (showDone || index >= hiddenHead) && (showMore || index < hiddenTail));

  const colSpan = editable ? 7 : 6;
  const rowTone = (lesson: StudyPlanLesson) =>
    statusOf(lesson) === 'IN_PROGRESS' ? 'bg-muted' : '';
  const titleClass = (lesson: StudyPlanLesson) =>
    statusOf(lesson) === 'IN_PROGRESS' ? 'font-bold' : 'font-medium';

  const header = (
    <div className="flex flex-col gap-1 p-4 md:flex-row md:items-start md:justify-between md:px-5">
      <div>
        <h2 className="text-h2">{t('detail.lessons')}</h2>
        <p className="mt-1 text-text-secondary">
          {t('detail.lessonsCaption', { lessons: num(shown.length), periods: num(totalPeriods) })}
        </p>
      </div>
      {editable && !isPhone && (
        <p className="text-caption text-text-secondary">
          <kbd className="rounded-sm border border-border-subtle bg-muted px-1.5 py-0.5">
            {t('detail.reorderHint')}
          </kbd>
        </p>
      )}
    </div>
  );

  return (
    <Card className="overflow-hidden">
      <div ref={containerRef}>
        {header}
        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>

        {!isPhone ? (
          <Table aria-label={t('detail.lessons')}>
            <TableHeader>
              <TableRow className="border-y border-border-subtle bg-muted text-label text-text-secondary">
                <TableHead className="h-10 w-16 px-4 text-end font-medium">
                  {t('detail.columns.no')}
                </TableHead>
                <TableHead className="h-10 px-4 font-medium">
                  {t('detail.columns.lesson')}
                </TableHead>
                <TableHead className="h-10 px-4 font-medium">
                  {t('detail.columns.periods')}
                </TableHead>
                <TableHead className="h-10 px-4 font-medium">{t('detail.columns.topic')}</TableHead>
                <TableHead className="h-10 px-4 font-medium">{t('detail.columns.date')}</TableHead>
                <TableHead className="h-10 px-4 font-medium">
                  {t('detail.columns.status')}
                </TableHead>
                {editable && (
                  <TableHead className="h-10 px-4">
                    <span className="sr-only">{t('detail.columns.lesson')}</span>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-border-subtle">
              {doneButton && (
                <TableRow>
                  <TableCell colSpan={colSpan} className="px-4 py-2">
                    {doneButton}
                  </TableCell>
                </TableRow>
              )}
              {visible.map(({ lesson, index }) => (
                <React.Fragment key={lesson.id}>
                  <TableRow
                    data-lesson-id={lesson.id}
                    className={`hover:bg-muted ${rowTone(lesson)}`}
                    {...(editable
                      ? {
                          tabIndex: 0,
                          onKeyDown: (e: React.KeyboardEvent) => handleKeyDown(e, index),
                        }
                      : {})}
                  >
                    <TableCell className="px-4 py-2 text-end tabular-nums">
                      {num(index + 1)}
                    </TableCell>
                    <TableCell className="px-4 py-2">
                      <p className={titleClass(lesson)}>{lesson.title}</p>
                      {lesson.notes && (
                        <p className="text-caption text-text-secondary">
                          {t('detail.note', { text: lesson.notes })}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="px-4 py-2 tabular-nums">{num(lesson.periods)}</TableCell>
                    <TableCell className="px-4 py-2">{topicName(lesson)}</TableCell>
                    <TableCell className="px-4 py-2">{dateCell(lesson)}</TableCell>
                    <TableCell className="px-4 py-2">{statusBadge(lesson)}</TableCell>
                    {editable && (
                      <TableCell className="px-4 py-2">
                        <div className="flex items-center justify-end gap-1">
                          {reorderControls(lesson, index)}
                          <RowActions
                            actions={[
                              {
                                intent: 'edit',
                                label: t('lesson.edit'),
                                busy: isPending,
                                onClick: () => onEdit(lesson),
                              },
                              {
                                intent: 'delete',
                                label: t('lesson.delete'),
                                busy: isPending,
                                onClick: () => onDelete(lesson, index),
                              },
                            ]}
                          />
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                  {(markersByLesson.get(lesson.id) ?? []).map((marker) => (
                    <ExamMarkerRow
                      key={marker.exam_id}
                      colSpan={colSpan}
                      title={t('detail.marker', { exam: marker.exam_name })}
                      meta={t('detail.markerTaught', {
                        to: num(index + 1),
                        taught: num(taughtUpTo(index)),
                      })}
                      {...editMarker(marker)}
                    />
                  ))}
                </React.Fragment>
              ))}
              {moreButton && (
                <TableRow>
                  <TableCell colSpan={colSpan} className="px-4 py-2">
                    {moreButton}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        ) : (
          <ul className="divide-y divide-border-subtle border-t border-border-subtle">
            {doneButton && <li className="px-4 py-2">{doneButton}</li>}
            {visible.map(({ lesson, index }) => (
              <li
                key={lesson.id}
                data-lesson-id={lesson.id}
                className={`flex flex-col gap-1 px-4 py-3 ${rowTone(lesson)}`}
                {...(editable
                  ? { tabIndex: 0, onKeyDown: (e: React.KeyboardEvent) => handleKeyDown(e, index) }
                  : {})}
              >
                <div className="flex items-start gap-3">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-label text-text-secondary">
                    {num(index + 1)}
                  </span>
                  <p className={`min-w-0 flex-1 ${titleClass(lesson)}`}>{lesson.title}</p>
                  {statusBadge(lesson)}
                </div>
                <p className="text-caption text-text-secondary">
                  {[
                    `${t('detail.columns.periods')}: ${num(lesson.periods)}`,
                    topicName(lesson),
                    dateCell(lesson),
                  ].map((part, i) => (
                    <React.Fragment key={i}>
                      {i > 0 && ' · '}
                      {part}
                    </React.Fragment>
                  ))}
                </p>
                {lesson.notes && (
                  <p className="text-caption text-text-secondary">
                    {t('detail.note', { text: lesson.notes })}
                  </p>
                )}
                {editable && (
                  <div className="flex items-center">
                    {reorderControls(lesson, index)}
                    <Button
                      type="button"
                      variant="ghost"
                      iconOnly
                      className="size-11 text-text-secondary"
                      aria-label={`${t('lesson.edit')}: ${lesson.title}`}
                      disabled={isPending}
                      onClick={() => onEdit(lesson)}
                    >
                      <PencilIcon aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      iconOnly
                      className="size-11 text-destructive"
                      aria-label={`${t('lesson.delete')}: ${lesson.title}`}
                      disabled={isPending}
                      onClick={() => onDelete(lesson, index)}
                    >
                      <Trash2Icon aria-hidden />
                    </Button>
                  </div>
                )}
                {(markersByLesson.get(lesson.id) ?? []).map((marker) => (
                  <ExamMarkerLine
                    key={marker.exam_id}
                    title={t('detail.marker', { exam: marker.exam_name })}
                    meta={t('detail.markerTaught', {
                      to: num(index + 1),
                      taught: num(taughtUpTo(index)),
                    })}
                    {...editMarker(marker)}
                  />
                ))}
              </li>
            ))}
            {moreButton && <li className="px-4 py-2">{moreButton}</li>}
          </ul>
        )}
      </div>
    </Card>
  );
}

function CollapseButton({
  expanded,
  onClick,
  label,
}: {
  expanded: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={onClick}
      className="inline-flex h-11 w-full items-center justify-center rounded-md text-label font-medium text-primary hover:bg-muted md:h-9"
    >
      {label}
    </button>
  );
}

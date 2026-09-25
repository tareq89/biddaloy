/**
 * [26.7.1] Promotion run preview — merit-order grid with keyboard outcome
 * setting, override notes, group assignment, refresh and commit. Clones
 * `marks/$examId.$sectionId.$subjectId.tsx`'s desktop-grid/phone-stepper
 * split (same `MOBILE_BREAKPOINT`, same `useIsMobile`) and its
 * `Ctrl+Enter` submit shortcut, adapted to promotions' own columns.
 *
 * Keyboard model: the "final" outcome cell in each row is the one
 * arrow-key-navigable column (`P`/`R`/`G` set the outcome, `ArrowUp`/
 * `ArrowDown` move to the same cell on the next/previous row, `ArrowRight`
 * jumps to that row's group `Select`). The group `Select` and note
 * `<input>` are reached by native `Tab` order instead of custom arrow
 * handling — hijacking arrows inside a text input or an open `Select`
 * would break cursor movement / Radix's own `ArrowDown`-opens-the-list
 * behavior, so only the read-only-ish outcome cell gets the marks-grid
 * treatment. Tab order already visits final → group → note → next row's
 * final, so `P/R/G → note → Ctrl+Enter` is fully mouse-free regardless.
 *
 * Each change calls `useUpdatePromotionEntries` — immediately for
 * outcome/group, debounced for the note text (a note is typically
 * several keystrokes; batching those avoids one PATCH per character).
 */
import { Permission, type PromotionOutcome } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  ErrorState,
  RoutePending,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '@biddaloy/ui/components';
import {
  useAcademicYears,
  useClasses,
  useClassSections,
  useCommitPromotionRun,
  useDeletePromotionRun,
  useHasPermission,
  useOrganisationVocabulary,
  usePromotionRun,
  promotionRunQueryOptions,
  useRefreshPromotionRun,
  useUpdatePromotionEntries,
  useUser,
  type PatchPromotionEntryInput,
  type PromotionEntry,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate } from '@biddaloy/ui/utils';
import { createFileRoute } from '@tanstack/react-router';
import * as React from 'react';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';

import { CommitDialog } from './-commit-dialog';
import { PromotionEntryCard } from './-entry-card';

const MOBILE_BREAKPOINT = 768;
const NOTE_DEBOUNCE_MS = 500;
const NONE_VALUE = ' (none)';
const OUTCOME_KEY: Record<PromotionOutcome, string> = {
  PROMOTE: 'outcome.promote',
  RETAIN: 'outcome.retain',
  GRADUATE: 'outcome.graduate',
};

export const Route = createFileRoute('/_staff/promotions/$runId')({
  loader: ({ context: { queryClient }, params: { runId } }) =>
    Promise.all([
      queryClient.ensureQueryData(promotionRunQueryOptions(runId)).catch(swallowUnlessOffline),
      loadRouteNamespaces('promotions', 'common'),
    ]),
  pendingComponent: PromotionRunPending,
  component: PromotionRunPage,
});

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = React.useState(
    () =>
      typeof matchMedia === 'function' &&
      matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`).matches,
  );
  React.useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mql = matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const handler = () => setIsMobile(mql.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);
  return isMobile;
}

interface EntryEdit {
  final_outcome?: PromotionOutcome;
  group_name?: string;
  override_note?: string;
}

function PromotionRunPage() {
  const { runId } = Route.useParams();
  const { t } = useTranslation('promotions');
  const config = useRegionConfig();
  const navigate = Route.useNavigate();
  const isMobile = useIsMobile();
  const canManage = useHasPermission(Permission.PROMOTION_MANAGE);

  const runQuery = usePromotionRun(runId);
  const updateEntries = useUpdatePromotionEntries(runId);
  const refreshRun = useRefreshPromotionRun(runId);
  const deleteRun = useDeletePromotionRun();
  const commitRun = useCommitPromotionRun(runId);
  const vocabulary = useOrganisationVocabulary();

  const [edits, setEdits] = React.useState<ReadonlyMap<string, EntryEdit>>(new Map());
  const [noteErrors, setNoteErrors] = React.useState<ReadonlySet<string>>(new Set());
  const [commitOpen, setCommitOpen] = React.useState(false);
  const [staleBanner, setStaleBanner] = React.useState(false);
  const [mobileIndex, setMobileIndex] = React.useState(0);

  const noteTimers = React.useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const focusRefs = React.useRef(new Map<string, HTMLElement>());
  const refreshButtonRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(
    () => () => {
      for (const timer of noteTimers.current.values()) clearTimeout(timer);
    },
    [],
  );

  const run = runQuery.data;
  const classesQuery = useClasses({});
  const yearsQuery = useAcademicYears();
  const sectionsQuery = useClassSections(run?.target_class_id ?? undefined);
  const committedByQuery = useUser(run?.committed_by_user_id ?? undefined);
  const approvedByQuery = useUser(run?.approved_by_user_id ?? undefined);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        setCommitOpen(true);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (runQuery.isPending) return <Skeleton className="h-64 w-full" />;
  if (runQuery.isError || !run) {
    return <ErrorState message={t('list.errorMessage')} onRetry={() => void runQuery.refetch()} />;
  }

  const readOnly = run.status === 'COMMITTED';
  const groups = vocabulary.data?.groups ?? [];
  const sectionNames = new Map(
    (sectionsQuery.data ?? []).map((section) => [section.id, section.section_name]),
  );
  const classNames = new Map((classesQuery.data?.data ?? []).map((cls) => [cls.id, cls.name]));
  const yearNames = new Map((yearsQuery.data?.data ?? []).map((year) => [year.id, year.name]));

  const entries = [...run.entries].sort(
    (a, b) => (a.merit_rank ?? Number.MAX_SAFE_INTEGER) - (b.merit_rank ?? Number.MAX_SAFE_INTEGER),
  );

  function effective(entry: PromotionEntry): {
    final_outcome: PromotionOutcome;
    group_name: string | null;
    override_note: string | null;
  } {
    const edit = edits.get(entry.student_id);
    return {
      final_outcome: edit?.final_outcome ?? entry.final_outcome,
      group_name: edit?.group_name ?? entry.group_name,
      override_note: edit?.override_note ?? entry.override_note,
    };
  }

  function isOverride(entry: PromotionEntry): boolean {
    return effective(entry).final_outcome !== entry.suggested_outcome;
  }

  const counts = entries.reduce(
    (acc, entry) => {
      const outcome = effective(entry).final_outcome;
      if (outcome === 'PROMOTE') acc.promoted += 1;
      else if (outcome === 'RETAIN') acc.retained += 1;
      else acc.graduated += 1;
      const override = isOverride(entry);
      if (override) acc.overrides += 1;
      // placement_error reflects the server's SUGGESTED outcome. Once a
      // human overrides the outcome, that stale error no longer applies —
      // gate on suggested_outcome, not the effective one, and skip entirely
      // for overridden rows.
      if (!override && entry.suggested_outcome === 'PROMOTE' && entry.placement_error) {
        acc.errors += 1;
      }
      return acc;
    },
    { promoted: 0, retained: 0, graduated: 0, overrides: 0, errors: 0 },
  );

  const hasPlacementErrors = counts.errors > 0;
  const hasUnnotedOverrides = entries.some((entry) => {
    if (!isOverride(entry)) return false;
    const note = effective(entry).override_note;
    return !note || note.trim() === '';
  });

  function patch(studentId: string, input: EntryEdit) {
    setEdits((prev) => {
      const next = new Map(prev);
      next.set(studentId, { ...next.get(studentId), ...input });
      return next;
    });
    const body: PatchPromotionEntryInput = { student_id: studentId, ...input };
    updateEntries.mutate([body], {
      onError: (error: unknown) => {
        if (
          error instanceof ApiError &&
          error.statusCode === 409 &&
          (error.details as { code?: string } | undefined)?.code === 'STALE_RESULTS'
        ) {
          setStaleBanner(true);
        }
      },
    });
  }

  function setOutcome(entry: PromotionEntry, outcome: PromotionOutcome) {
    patch(entry.student_id, { final_outcome: outcome });
    if (outcome !== entry.suggested_outcome) {
      // Override: jump focus to this row's note input (D-required note).
      window.requestAnimationFrame(() => {
        focusRefs.current.get(`note:${entry.student_id}`)?.focus();
      });
    }
  }

  function setGroup(entry: PromotionEntry, group: string) {
    // The server's PATCH DTO only accepts a real group name (never `null`,
    // see `promotions.dto.ts`'s `group_name?: string` and
    // `promotions.service.ts:496`'s `patch.group_name !== undefined` guard
    // — there is no "clear the group" operation to call). Picking the
    // placeholder item back is a no-op, not a write.
    if (group === NONE_VALUE) return;
    patch(entry.student_id, { group_name: group });
  }

  function setNote(studentId: string, note: string) {
    setEdits((prev) => {
      const next = new Map(prev);
      next.set(studentId, { ...next.get(studentId), override_note: note });
      return next;
    });
    setNoteErrors((prev) => {
      if (note.trim() === '') return prev;
      if (!prev.has(studentId)) return prev;
      const next = new Set(prev);
      next.delete(studentId);
      return next;
    });
    const existing = noteTimers.current.get(studentId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      noteTimers.current.delete(studentId);
      updateEntries.mutate([{ student_id: studentId, override_note: note.trim() }]);
    }, NOTE_DEBOUNCE_MS);
    noteTimers.current.set(studentId, timer);
  }

  function blurNote(entry: PromotionEntry) {
    if (!isOverride(entry)) return;
    const note = effective(entry).override_note;
    setNoteErrors((prev) => {
      const next = new Set(prev);
      if (!note || note.trim() === '') next.add(entry.student_id);
      else next.delete(entry.student_id);
      return next;
    });
  }

  function focusOutcomeCell(rowIndex: number) {
    const bounded = Math.max(0, Math.min(entries.length - 1, rowIndex));
    focusRefs.current.get(`outcome:${entries[bounded]?.student_id}`)?.focus();
  }

  function handleOutcomeKeyDown(
    event: React.KeyboardEvent<HTMLDivElement>,
    entry: PromotionEntry,
    rowIndex: number,
  ) {
    const key = event.key;
    if (key === 'p' || key === 'P') {
      event.preventDefault();
      setOutcome(entry, 'PROMOTE');
      return;
    }
    if (key === 'r' || key === 'R') {
      event.preventDefault();
      setOutcome(entry, 'RETAIN');
      return;
    }
    if (key === 'g' || key === 'G') {
      event.preventDefault();
      setOutcome(entry, 'GRADUATE');
      return;
    }
    if (key === 'ArrowDown') {
      event.preventDefault();
      focusOutcomeCell(rowIndex + 1);
      return;
    }
    if (key === 'ArrowUp') {
      event.preventDefault();
      focusOutcomeCell(rowIndex - 1);
      return;
    }
    if (key === 'ArrowRight') {
      event.preventDefault();
      focusRefs.current.get(`group:${entry.student_id}`)?.focus();
    }
  }

  function confirmCommit() {
    commitRun.mutate(undefined, {
      onSuccess: () => setCommitOpen(false),
    });
  }

  async function refresh() {
    setStaleBanner(false);
    await refreshRun.mutateAsync();
  }

  function deleteDraft() {
    deleteRun.mutate(runId, {
      onSuccess: () => void navigate({ to: '/promotions' }),
    });
  }

  const sourceClassName = classNames.get(run.source_class_id) ?? run.source_class_id;
  const targetClassName =
    run.target_class_id === null
      ? t('outcome.graduate')
      : (classNames.get(run.target_class_id) ?? run.target_class_id);
  const targetYearName = yearNames.get(run.target_academic_year_id) ?? run.target_academic_year_id;
  const algorithmLabel = t(
    run.algorithm === 'BLOCK' ? 'newRunForm.algorithmBlock' : 'newRunForm.algorithmSnake',
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="sticky top-0 z-20 flex flex-col gap-2 border-b border-border-subtle bg-background p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold">
              {sourceClassName} → {targetClassName}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t('grid.runSummary', {
                source: sourceClassName,
                target: `${targetClassName} (${targetYearName})`,
                exams: run.exam_ids.length,
                algorithm: algorithmLabel,
              })}
            </p>
          </div>
          {!readOnly && canManage && (
            <div className="flex gap-2">
              <Button
                ref={refreshButtonRef}
                type="button"
                variant="outline"
                size="sm"
                loading={refreshRun.isPending}
                onClick={() => void refresh()}
              >
                {refreshRun.isPending ? t('grid.refreshing') : t('grid.refresh')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                loading={deleteRun.isPending}
                onClick={deleteDraft}
              >
                {t('grid.delete')}
              </Button>
              <Button type="button" size="sm" onClick={() => setCommitOpen(true)}>
                {t('grid.commit')} ({t('grid.commitShortcutHint')})
              </Button>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground" role="status">
          <span>
            {t('grid.counts.promoted')}: {counts.promoted}
          </span>
          <span>
            {t('grid.counts.retained')}: {counts.retained}
          </span>
          <span>
            {t('grid.counts.graduated')}: {counts.graduated}
          </span>
          <span>
            {t('grid.counts.overrides')}: {counts.overrides}
          </span>
          <span className={counts.errors > 0 ? 'text-destructive' : undefined}>
            {t('grid.counts.errors')}: {counts.errors}
          </span>
        </div>

        {readOnly && (
          <p className="rounded-md border border-border-subtle bg-muted p-2 text-sm text-muted-foreground">
            {t('grid.readOnlyBanner', {
              date: run.committed_at ? formatDate(new Date(run.committed_at), config) : '',
              committedBy: committedByQuery.data?.full_name ?? run.committed_by_user_id ?? '',
              approvedBy: approvedByQuery.data?.full_name ?? run.approved_by_user_id ?? '',
            })}
          </p>
        )}

        {staleBanner && !readOnly && (
          <div role="alert" className="flex items-center gap-2 rounded-md border border-destructive p-2 text-sm text-destructive">
            <span>{t('grid.staleResultsPrompt')}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                refreshButtonRef.current?.focus();
              }}
            >
              {t('grid.refresh')}
            </Button>
          </div>
        )}
      </div>

      {isMobile ? (
        <PromotionEntryCard
          entries={entries}
          index={mobileIndex}
          onIndexChange={setMobileIndex}
          groups={groups}
          readOnly={readOnly}
          effective={effective}
          isOverride={isOverride}
          noteErrors={noteErrors}
          sectionNames={sectionNames}
          onOutcome={setOutcome}
          onGroup={setGroup}
          onNote={setNote}
          onNoteBlur={blurNote}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{t('list.title')}</caption>
            <thead>
              <tr className="border-b text-start text-muted-foreground">
                <th className="px-2 py-2">{t('grid.columnMeritRank')}</th>
                <th className="sticky start-0 z-10 min-w-40 bg-background px-2 py-2">
                  {t('grid.columnStudent')}
                </th>
                <th className="px-2 py-2">{t('grid.columnSuggested')}</th>
                <th className="px-2 py-2">{t('grid.columnFinal')}</th>
                <th className="px-2 py-2">{t('grid.columnGroup')}</th>
                <th className="px-2 py-2">{t('grid.columnTargetSection')}</th>
                <th className="px-2 py-2">{t('grid.columnNewRoll')}</th>
                <th className="min-w-40 px-2 py-2">{t('grid.columnOverrideNote')}</th>
                <th className="px-2 py-2">{t('grid.columnPlacementError')}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, rowIndex) => {
                const eff = effective(entry);
                const override = isOverride(entry);
                const noteError = noteErrors.has(entry.student_id);
                return (
                  <tr key={entry.student_id} className="border-b align-top">
                    <td className="px-2 py-2">{entry.merit_rank ?? '—'}</td>
                    <td className="sticky start-0 z-10 bg-background px-2 py-2">
                      <span className="font-medium">{entry.student_roll_number}</span>{' '}
                      {entry.student_name}
                    </td>
                    <td className="px-2 py-2">{t(OUTCOME_KEY[entry.suggested_outcome])}</td>
                    <td className="px-2 py-2">
                      <div
                        ref={(el) => {
                          const key = `outcome:${entry.student_id}`;
                          if (el) focusRefs.current.set(key, el);
                          else focusRefs.current.delete(key);
                        }}
                        role="button"
                        tabIndex={readOnly ? -1 : 0}
                        aria-label={t('grid.columnFinal')}
                        className="flex items-center gap-1 rounded-md border border-input px-2 py-1 focus:outline-none focus:ring-2 focus:ring-ring"
                        onKeyDown={(event) =>
                          readOnly ? undefined : handleOutcomeKeyDown(event, entry, rowIndex)
                        }
                      >
                        {t(OUTCOME_KEY[eff.final_outcome])}
                        {override && (
                          <span className="rounded bg-status-due-fg/20 px-1 text-xs text-status-due-fg">
                            {t('grid.overrideChip')}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <Select
                        value={eff.group_name ?? NONE_VALUE}
                        onValueChange={(value) => setGroup(entry, value)}
                        disabled={readOnly}
                      >
                        <SelectTrigger
                          ref={(el) => {
                            const key = `group:${entry.student_id}`;
                            if (el) focusRefs.current.set(key, el);
                            else focusRefs.current.delete(key);
                          }}
                          aria-label={t('grid.columnGroup')}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem
                            value={NONE_VALUE}
                            disabled={eff.group_name != null}
                            title={
                              eff.group_name != null ? t('grid.groupClearUnsupported') : undefined
                            }
                          >
                            {t('grid.groupNone')}
                          </SelectItem>
                          {groups.map((group) => (
                            <SelectItem key={group} value={group}>
                              {group}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-2 py-2">
                      {eff.final_outcome === 'PROMOTE'
                        ? (sectionNames.get(entry.target_section_id ?? '') ?? '—')
                        : '—'}
                    </td>
                    <td className="px-2 py-2">
                      {eff.final_outcome === 'PROMOTE' ? (entry.new_roll_number ?? '—') : '—'}
                    </td>
                    <td className="px-2 py-2">
                      <input
                        ref={(el) => {
                          const key = `note:${entry.student_id}`;
                          if (el) focusRefs.current.set(key, el);
                          else focusRefs.current.delete(key);
                        }}
                        type="text"
                        disabled={readOnly}
                        aria-label={t('grid.columnOverrideNote')}
                        value={eff.override_note ?? ''}
                        className="h-9 w-full rounded-md border border-input bg-background px-2"
                        onChange={(event) => setNote(entry.student_id, event.target.value)}
                        onBlur={() => blurNote(entry)}
                      />
                      {noteError && (
                        <p role="alert" className="text-xs text-destructive">
                          {t('grid.noteRequired')}
                        </p>
                      )}
                    </td>
                    <td className="px-2 py-2 text-destructive">
                      {!override && eff.final_outcome === 'PROMOTE' ? (entry.placement_error ?? '') : ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <CommitDialog
        open={commitOpen}
        onOpenChange={setCommitOpen}
        counts={counts}
        hasPlacementErrors={hasPlacementErrors}
        hasUnnotedOverrides={hasUnnotedOverrides}
        confirming={commitRun.isPending}
        onConfirm={confirmCommit}
      />
    </div>
  );
}

function PromotionRunPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label', { ns: 'nav' })} />;
}

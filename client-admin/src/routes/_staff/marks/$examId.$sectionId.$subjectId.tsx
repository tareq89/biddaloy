/**
 * [19.7.1] The marks-entry page itself — desktop grid vs. phone stepper,
 * one shared `autosave.ts` instance, D13's header line, `Ctrl+Enter`
 * submit, and read-only-after-submit (D12).
 *
 * Layout switch uses the SAME 768px breakpoint `data-table.tsx` already
 * treats as the app's card-mode threshold (`CARD_MODE_MAX_WIDTH`) — a
 * *viewport* check here (not a container check) is correct because this
 * page, unlike a reusable table, always fills the whole content area.
 */
import { Permission, UserRole } from '@biddaloy/shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ErrorState,
  MarksGrid,
  MarksStepper,
  RoutePending,
  Skeleton,
} from '@biddaloy/ui/components';
import {
  useActiveRole,
  useHasPermission,
  useMarkGrid,
  useAutosave,
  useReopenMarkGrid,
  useSubmitMarkGrid,
  saveMarkBatch,
  type MarkGridCell,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute, useBlocker } from '@tanstack/react-router';
import * as React from 'react';

import { loadRouteNamespaces } from '../../../route-loaders';

import { SubmitDialog } from './-submit-dialog';

const MOBILE_BREAKPOINT = 768;

export const Route = createFileRoute('/_staff/marks/$examId/$sectionId/$subjectId')({
  // The grid data itself loads through the page's own `useMarkGrid` (a
  // normal `useQuery`, not `ensureQueryData`) — the composed grid response
  // depends on `examId`+`sectionId`+`subjectId` together, and this loader
  // has nothing cheaper to prefetch than that same request, so it only
  // needs to warm the i18n namespace before the component renders.
  loader: () => loadRouteNamespaces('exams', 'common'),
  pendingComponent: MarksGridPending,
  component: MarksEntryPage,
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

function MarksEntryPage() {
  const { examId, sectionId, subjectId } = Route.useParams();
  const { t } = useTranslation('exams');
  const isMobile = useIsMobile();
  const role = useActiveRole();
  // Submit needs MARK_ENTER (the controller's own gate for POST submit),
  // not EXAM_MANAGE — a TEACHER holds MARK_ENTER for their own sections
  // without holding EXAM_MANAGE.
  const canEnter = useHasPermission(Permission.MARK_ENTER);

  const gridQuery = useMarkGrid(examId, sectionId, subjectId);
  const submitGrid = useSubmitMarkGrid(examId, sectionId, subjectId);
  const reopenGrid = useReopenMarkGrid(examId, sectionId, subjectId);

  const [submitOpen, setSubmitOpen] = React.useState(false);

  const autosave = useAutosave<MarkGridCell>({
    save: async (batch) => {
      await saveMarkBatch(examId, sectionId, subjectId, [...batch.values()]);
    },
  });

  // A blocking `Dialog`, not `window.confirm` — `no-window-alert` forbids
  // the native dialog, and `withResolver: true` gives us `resolver.proceed`
  // /`reset` to wire a real one to the pending navigation.
  const blocker = useBlocker({
    shouldBlockFn: () => autosave.pendingCount > 0,
    withResolver: true,
  });

  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        setSubmitOpen(true);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (gridQuery.isPending) return <Skeleton className="h-64 w-full" />;
  if (gridQuery.isError) {
    return <ErrorState message={t('marksGrid.caption')} onRetry={() => void gridQuery.refetch()} />;
  }

  const grid = gridQuery.data;
  const submitted = grid.state === 'SUBMITTED';
  const readOnly = submitted;
  const canReopen = submitted && role === UserRole.ADMIN;

  const blankCount = grid.students.reduce((count, student) => {
    const missing = grid.components
      .filter((c) => c.source !== 'DERIVED')
      .some((component) => {
        const cell = grid.cells.find(
          (c) => c.student_id === student.id && c.component_id === component.id,
        );
        return !cell || (cell.value === null && cell.status === 'PRESENT');
      });
    return missing ? count + 1 : count;
  }, 0);

  const saveStateLine =
    autosave.state === 'saving'
      ? t('saveState.saving')
      : autosave.state === 'error'
        ? t('saveState.error', { count: autosave.pendingCount })
        : autosave.lastSavedAt
          ? t('saveState.saved', {
              time: autosave.lastSavedAt.toLocaleTimeString(),
            })
          : t('saveState.idle');

  return (
    <div className="flex flex-col gap-4">
      <div className="sticky top-0 z-20 flex flex-col gap-2 border-b border-border-subtle bg-background p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-lg font-semibold">{t('marksGrid.caption')}</h1>
          <p
            className="text-sm text-muted-foreground"
            role="status"
            aria-live="polite"
            data-testid="save-state-line"
          >
            {saveStateLine}
          </p>
        </div>
        {submitted && (
          <p className="rounded-md border border-border-subtle bg-muted p-2 text-sm text-muted-foreground">
            {t('marksGrid.readOnlyBanner', {
              name: grid.submitted_by ?? '',
              time: grid.submitted_at ? new Date(grid.submitted_at).toLocaleString() : '',
            })}
            {canReopen && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="ml-2"
                loading={reopenGrid.isPending}
                onClick={() => reopenGrid.mutate()}
              >
                {t('marksGrid.reopenAction')}
              </Button>
            )}
          </p>
        )}
        {!submitted && canEnter && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => setSubmitOpen(true)}
          >
            {t('submitDialog.confirm')} ({t('submitDialog.shortcutHint')})
          </Button>
        )}
      </div>

      {isMobile ? (
        <MarksStepper
          students={grid.students}
          components={grid.components}
          cells={grid.cells}
          derived={grid.derived}
          readOnly={readOnly}
          onStage={autosave.stage}
          pendingKeys={autosave.pendingKeys}
          failedKeys={autosave.failedKeys}
        />
      ) : (
        <MarksGrid
          students={grid.students}
          components={grid.components}
          cells={grid.cells}
          derived={grid.derived}
          readOnly={readOnly}
          onStage={autosave.stage}
          pendingKeys={autosave.pendingKeys}
          failedKeys={autosave.failedKeys}
        />
      )}

      <SubmitDialog
        open={submitOpen}
        onOpenChange={setSubmitOpen}
        blankCount={blankCount}
        confirming={submitGrid.isPending}
        onConfirm={() => {
          submitGrid.mutate(undefined, {
            onSuccess: () => setSubmitOpen(false),
          });
        }}
      />

      <Dialog
        open={blocker.status === 'blocked'}
        onOpenChange={(open) => {
          if (!open) blocker.reset?.();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('saveState.navigationBlocked')}</DialogTitle>
            <DialogDescription>
              {t('saveState.error', { count: autosave.pendingCount })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => blocker.reset?.()}>
              {t('submitDialog.cancel')}
            </Button>
            <Button type="button" variant="outline" onClick={() => blocker.proceed?.()}>
              {t('saveState.leaveAnyway')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MarksGridPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label', { ns: 'nav' })} />;
}

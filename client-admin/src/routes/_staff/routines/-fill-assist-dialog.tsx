/**
 * [21.8.1] D1 — calls the greedy-fill proposer (`GET /routines/:id/
 * greedy-fill`, read-only), shows every proposed slot as a preview diff,
 * and only writes (`useCreateRoutineSlot` per accepted row) when the
 * admin confirms. Never touches an already-filled cell: `useGreedyFill`
 * only ever proposes for empty slots server-side, and this dialog itself
 * never mutates outside the explicit "Fill" click.
 */
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Skeleton,
  toast,
} from '@biddaloy/ui/components';
import {
  conflictViolations,
  useCreateRoutineSlot,
  useGreedyFill,
  usePeriodSlotLookup,
  useSubjects,
  useTeachers,
  type ProposedSlot,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import * as React from 'react';

import { subjectName } from './-subject-name';

export interface FillAssistDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  routineId: string;
  sectionId: string;
  weekdayLabels: Record<number, string>;
  onDone: () => void;
}

export function FillAssistDialog({
  open,
  onOpenChange,
  routineId,
  sectionId,
  weekdayLabels,
  onDone,
}: FillAssistDialogProps) {
  const { t, i18n } = useTranslation('routines');
  const config = useRegionConfig();
  const periodLookup = usePeriodSlotLookup();
  const greedyFill = useGreedyFill(routineId);
  const createSlot = useCreateRoutineSlot(routineId);
  const subjectsQuery = useSubjects({});
  const teachersQuery = useTeachers({});

  const [proposals, setProposals] = React.useState<ProposedSlot[] | null>(null);
  const [applying, setApplying] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setProposals(null);
      return;
    }
    greedyFill.mutate(undefined, {
      onSuccess: (result) => setProposals(result.filter((slot) => slot.section_id === sectionId)),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetch fresh proposals every time the dialog opens
  }, [open]);

  const subjectLabel = (id: string) =>
    subjectName(
      subjectsQuery.data?.data.find((subject) => subject.id === id),
      i18n.language,
    );
  const teacherNames = (ids: string[]) =>
    ids
      .map(
        (id) =>
          teachersQuery.data?.data.find((teacher) => teacher.id === id)?.user.full_name ?? '—',
      )
      .join(', ');
  const whenLabel = (proposal: ProposedSlot) => {
    const sequence = periodLookup.data?.[proposal.period_slot_id]?.sequence;
    const day = weekdayLabels[proposal.weekday] ?? '';
    return sequence === undefined
      ? day
      : t('fillAssist.rowWhen', { day, period: t('agenda.periodLabel', { sequence }) });
  };

  async function handleConfirm() {
    if (!proposals || proposals.length === 0) return;
    setApplying(true);
    // [21.8.1] The loop writes one proposal at a time — if proposal N of M
    // fails (e.g. a 409 because the grid changed after the preview),
    // proposals 1..N-1 already succeeded. Track how many landed so a
    // failure only leaves the still-unapplied ones in the dialog, and a
    // retry can't resubmit rows that already went through.
    let applied = 0;
    try {
      for (const proposal of proposals) {
        await createSlot.mutateAsync({
          section_id: proposal.section_id,
          period_slot_id: proposal.period_slot_id,
          weekday: proposal.weekday,
          subject_id: proposal.subject_id,
          teacher_ids: proposal.teacher_ids,
          recurrence: proposal.recurrence,
          recurrence_offset: proposal.recurrence_offset,
          valid_from: proposal.valid_from,
          valid_to: proposal.valid_to,
        });
        applied += 1;
      }
      onDone();
      onOpenChange(false);
    } catch (error) {
      setProposals((current) => current?.slice(applied) ?? null);
      const violations = conflictViolations(error);
      const first = violations?.[0];
      toast.error(
        first
          ? t(`conflictList.codes.${first.code}`, { defaultValue: t('conflictList.codes.unknown') })
          : t('builder.saveErrorToast'),
      );
      if (applied > 0) onDone();
    } finally {
      setApplying(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{t('fillAssist.title')}</DialogTitle>
          <DialogDescription>{t('fillAssist.description')}</DialogDescription>
        </DialogHeader>

        {greedyFill.isPending && (
          <div className="flex flex-col gap-2" aria-hidden="true">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        )}

        {proposals !== null && proposals.length === 0 && (
          <p className="text-text-secondary">{t('fillAssist.empty')}</p>
        )}

        {proposals !== null && proposals.length > 0 && (
          <ul className="max-h-80 divide-y divide-border-subtle overflow-y-auto">
            {proposals.map((proposal, index) => (
              <li
                key={`${proposal.weekday}-${proposal.period_slot_id}-${index}`}
                className="flex items-start gap-3 py-2"
              >
                <div>
                  <p className="font-medium">{whenLabel(proposal)}</p>
                  <p className="text-text-secondary">
                    {t('fillAssist.rowWhat', {
                      subject: subjectLabel(proposal.subject_id),
                      teachers: teacherNames(proposal.teacher_ids),
                    })}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('fillAssist.cancel')}
          </Button>
          <Button
            type="button"
            disabled={!proposals || proposals.length === 0}
            loading={applying}
            onClick={() => void handleConfirm()}
          >
            {t('fillAssist.confirm', {
              count: proposals?.length ?? 0,
              formattedCount: formatNumber(proposals?.length ?? 0, config),
            })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
} from '@biddaloy/ui/components';
import {
  useCreateRoutineSlot,
  useGreedyFill,
  useSubjects,
  useTeachers,
  type ProposedSlot,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

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
  const { t } = useTranslation('routines');
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

  const subjectName = (id: string) =>
    subjectsQuery.data?.data.find((subject) => subject.id === id)?.name_en ?? id;
  const teacherNames = (ids: string[]) =>
    ids
      .map((id) => teachersQuery.data?.data.find((teacher) => teacher.id === id)?.user.full_name)
      .filter(Boolean)
      .join(', ');

  async function handleConfirm() {
    if (!proposals || proposals.length === 0) return;
    setApplying(true);
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
      }
      onDone();
      onOpenChange(false);
    } finally {
      setApplying(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('fillAssist.title')}</DialogTitle>
          <DialogDescription>{t('fillAssist.description')}</DialogDescription>
        </DialogHeader>

        {greedyFill.isPending && (
          <div className="flex flex-col gap-2" aria-hidden="true">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        )}

        {proposals !== null && proposals.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('fillAssist.empty')}</p>
        )}

        {proposals !== null && proposals.length > 0 && (
          <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto text-sm">
            {proposals.map((proposal, index) => (
              <li
                key={`${proposal.weekday}-${proposal.period_slot_id}-${index}`}
                className="rounded-md border border-border-subtle p-2"
              >
                <span className="font-medium">{weekdayLabels[proposal.weekday]}</span> ·{' '}
                {subjectName(proposal.subject_id)} · {teacherNames(proposal.teacher_ids)}
              </li>
            ))}
          </ul>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t('fillAssist.cancel')}
          </Button>
          <Button
            type="button"
            disabled={!proposals || proposals.length === 0}
            loading={applying}
            onClick={() => void handleConfirm()}
          >
            {t('fillAssist.confirm', { count: proposals?.length ?? 0 })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

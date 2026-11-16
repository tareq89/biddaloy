/** [71.4.x] Pure: which "what to do now" card the desk shows for a round (#2204 D11). */
export type DeskStageKind = 'WRITTEN' | 'VIVA' | 'GPA' | 'LOTTERY' | 'FIRST_COME';

export interface DeskStage {
  id: string;
  kind: DeskStageKind;
  /** The stage's `cutoff_committed_at` is set (AdmissionDesk wires it). */
  done?: boolean;
}
export interface DeskList {
  kind: 'MERIT' | 'WAITING';
  sequence: number;
  act_by_date: string | null;
  activated_at: string | null;
}
export interface DeskCounts {
  applicants: number;
  feePending: number;
  seatsLeft: number;
  stages: DeskStage[];
  lists: DeskList[];
}
export type NextActionKey =
  'empty' | 'feePending' | 'enterMarks' | 'drawLottery' | 'makeMerit' | 'startWaiting' | 'publish';
export interface NextAction {
  key: NextActionKey;
  /** The `?step=` this card opens. */
  step: string;
  count?: number;
  n?: number;
  stageId?: string;
}

const listBefore = (lists: DeskList[], l: DeskList) =>
  lists.find((x) =>
    l.sequence === 1 ? x.kind === 'MERIT' : x.kind === 'WAITING' && x.sequence === l.sequence - 1,
  );

/** `today` is the school's calendar date (YYYY-MM-DD); offers stay open through `act_by_date`. */
export function nextAction(c: DeskCounts, today: string): NextAction {
  if (c.applicants === 0) return { key: 'empty', step: 'applicants' };
  if (c.feePending > 0) return { key: 'feePending', step: 'applicants', count: c.feePending };
  const hasMerit = c.lists.some((l) => l.kind === 'MERIT');
  if (!hasMerit) {
    const stage = c.stages.find((s) => s.kind !== 'FIRST_COME' && !s.done);
    if (stage) {
      return {
        key: stage.kind === 'LOTTERY' ? 'drawLottery' : 'enterMarks',
        step: stage.id,
        stageId: stage.id,
      };
    }
    return { key: 'makeMerit', step: 'merit' };
  }
  if (c.seatsLeft > 0) {
    const waiting = c.lists
      .filter((l) => l.kind === 'WAITING' && !l.activated_at)
      .sort((a, b) => a.sequence - b.sequence)[0];
    const prev = waiting && listBefore(c.lists, waiting);
    if (waiting && prev?.activated_at && prev.act_by_date && prev.act_by_date < today) {
      return { key: 'startWaiting', step: 'waiting', n: waiting.sequence };
    }
  }
  return { key: 'publish', step: 'admit' };
}

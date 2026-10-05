import type { ResolvedSlot } from '../routines/dto/resolve.dto';

/** The bits of a `PeriodSlot` row this module needs. */
export interface PeriodSlotLike {
  id: string;
  sequence: number;
  name: string | null;
  starts_at: string;
  ends_at: string;
}

/** One schedulable period of a section on one date. `period_no` is the
 * period slot's `sequence` (D21). */
export interface ResolvedPeriod {
  period_no: number;
  name: string | null;
  starts_at: string;
  ends_at: string;
  subject_id: string;
  teacher_ids: string[];
  substitute_teacher_id: string | null;
}

/**
 * Turns one date's resolved routine slots into the list of periods attendance
 * can be taken for: cancelled slots dropped, sorted by `period_no`. If two
 * slots share a `period_no` the first wins (a period number is a single
 * register). Pure.
 */
export function toPeriods(
  resolvedSlots: ResolvedSlot[],
  periodSlots: PeriodSlotLike[],
): ResolvedPeriod[] {
  const byId = new Map(periodSlots.map((p) => [p.id, p]));
  const byNo = new Map<number, ResolvedPeriod>();
  for (const slot of resolvedSlots) {
    if (slot.cancelled) continue;
    const ps = byId.get(slot.period_slot_id);
    if (!ps || byNo.has(ps.sequence)) continue;
    byNo.set(ps.sequence, {
      period_no: ps.sequence,
      name: ps.name,
      starts_at: ps.starts_at,
      ends_at: ps.ends_at,
      subject_id: slot.subject_id,
      teacher_ids: slot.teacher_ids,
      substitute_teacher_id: slot.substitute_teacher_id ?? null,
    });
  }
  return [...byNo.values()].sort((a, b) => a.period_no - b.period_no);
}

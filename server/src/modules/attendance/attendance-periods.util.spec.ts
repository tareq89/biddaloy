import { describe, it, expect } from 'vitest';
import type { ResolvedSlot } from '../routines/dto/resolve.dto';
import { toPeriods } from './attendance-periods.util';

const periodSlots = [
  { id: 'ps1', sequence: 1, name: 'First', starts_at: '08:00', ends_at: '08:45' },
  { id: 'ps2', sequence: 2, name: null, starts_at: '08:45', ends_at: '09:30' },
  { id: 'ps3', sequence: 3, name: 'Third', starts_at: '09:30', ends_at: '10:15' },
];

function slot(periodSlotId: string, over: Partial<ResolvedSlot> = {}): ResolvedSlot {
  return {
    date: '2026-09-02',
    routine_slot_id: `rs-${periodSlotId}`,
    section_id: 'sec',
    period_slot_id: periodSlotId,
    weekday: 3,
    subject_id: `subj-${periodSlotId}`,
    room_id: null,
    kind: 'CLASS',
    teacher_ids: ['t1'],
    substituted: false,
    cancelled: false,
    ...over,
  };
}

describe('toPeriods', () => {
  it('sorts by period slot sequence, not by input order', () => {
    const result = toPeriods([slot('ps3'), slot('ps1'), slot('ps2')], periodSlots);
    expect(result.map((p) => p.period_no)).toEqual([1, 2, 3]);
  });

  it('drops cancelled slots', () => {
    const result = toPeriods([slot('ps1'), slot('ps2', { cancelled: true })], periodSlots);
    expect(result.map((p) => p.period_no)).toEqual([1]);
  });

  it('carries the substitute teacher id, and null when there is none', () => {
    const result = toPeriods(
      [
        slot('ps1', { substituted: true, substitute_teacher_id: 't9', teacher_ids: ['t9'] }),
        slot('ps2'),
      ],
      periodSlots,
    );
    expect(result[0].substitute_teacher_id).toBe('t9');
    expect(result[1].substitute_teacher_id).toBeNull();
  });

  it('copies name, times and subject from the period slot and routine slot', () => {
    const [p] = toPeriods([slot('ps1')], periodSlots);
    expect(p).toMatchObject({
      period_no: 1,
      name: 'First',
      starts_at: '08:00',
      ends_at: '08:45',
      subject_id: 'subj-ps1',
      teacher_ids: ['t1'],
    });
  });

  it('keeps the first slot when two share a period number', () => {
    const result = toPeriods(
      [slot('ps1', { subject_id: 'a' }), slot('ps1', { subject_id: 'b' })],
      periodSlots,
    );
    expect(result).toHaveLength(1);
    expect(result[0].subject_id).toBe('a');
  });
});

import { describe, it, expect } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { FIELD_CATALOG } from '@biddaloy/shared';
import { AdmitCardResolver, buildSittingValues, type SittingSchedule } from './admit-card.resolver';

const sit = (id: string, date: string, start = '10:00', end = '13:00'): SittingSchedule => ({
  id,
  subject: `Sub ${id}`,
  date,
  starts_at: start,
  ends_at: end,
});
const alloc = (id: string, room: string, seat: string) => ({
  exam_schedule_id: id,
  room,
  seat,
});

describe('buildSittingValues', () => {
  it('sorts by date then time and blanks the unused slots', () => {
    const v = buildSittingValues(
      [sit('c', '2026-03-03'), sit('b', '2026-03-01', '14:00', '16:00'), sit('a', '2026-03-01')],
      [],
    );
    expect([1, 2, 3].map((n) => v[`exam.sitting.${n}.subject`])).toEqual([
      'Sub a',
      'Sub b',
      'Sub c',
    ]);
    expect(v['exam.sitting.1.time']).toBe('10:00–13:00');
    expect(v['exam.sitting.1.date']).toBe('2026-03-01');
    // Unused slots are absent here; blankValues() supplies the '' defaults.
    expect(v['exam.sitting.4.subject']).toBeUndefined();
  });

  it('fills the header when room and seat are the same everywhere', () => {
    const v = buildSittingValues(
      [sit('a', '2026-03-01'), sit('b', '2026-03-02')],
      [alloc('a', 'Room 1', 'A-1'), alloc('b', 'Room 1', 'A-1')],
    );
    expect(v['seat.room']).toBe('Room 1');
    expect(v['seat.number']).toBe('A-1');
  });

  it('blanks the header but keeps per-row rooms when a sitting differs (D35)', () => {
    const v = buildSittingValues(
      [sit('a', '2026-03-01'), sit('b', '2026-03-02')],
      [alloc('a', 'Room 1', 'A-1'), alloc('b', 'Room 2', 'A-1')],
    );
    expect(v['seat.room']).toBe('');
    expect(v['seat.number']).toBe('A-1');
    expect(v['exam.sitting.1.room']).toBe('Room 1');
    expect(v['exam.sitting.2.room']).toBe('Room 2');
  });

  it('leaves room and seat empty for a sitting with no allocation', () => {
    const v = buildSittingValues([sit('a', '2026-03-01')], []);
    expect(v['exam.sitting.1.room']).toBe('');
    expect(v['exam.sitting.1.seat']).toBe('');
    expect(v['seat.room']).toBe('');
  });

  it('lists only allocated sittings when the student has allocations', () => {
    const v = buildSittingValues(
      [sit('a', '2026-03-01'), sit('b', '2026-03-02'), sit('c', '2026-03-03')],
      [alloc('b', 'Room 1', 'A-1')],
    );
    expect(v['exam.sitting.1.subject']).toBe('Sub b');
    expect(v['exam.sitting.2.subject']).toBeUndefined();
  });

  it('refuses more than 15 sittings with TOO_MANY_SITTINGS', () => {
    const many = Array.from({ length: 16 }, (_, i) =>
      sit(`s${i}`, `2026-03-${String(i + 1).padStart(2, '0')}`),
    );
    let err: any;
    try {
      buildSittingValues(many, []);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse().details).toEqual({ code: 'TOO_MANY_SITTINGS', max: 15 });
  });

  it('only emits keys that exist in the catalog', () => {
    const keys = new Set(FIELD_CATALOG.EXAM_ADMIT_CARD.map((f) => f.key));
    const v = buildSittingValues([sit('a', '2026-03-01')], [alloc('a', 'R', '1')]);
    for (const k of Object.keys(v)) expect(keys.has(k)).toBe(true);
  });
});

describe('AdmitCardResolver', () => {
  it('rejects a call without an exam context with 400', async () => {
    await expect(new AdmitCardResolver().resolve('t1', ['s1'], {} as any)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

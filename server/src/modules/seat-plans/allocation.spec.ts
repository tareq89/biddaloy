import { describe, it, expect } from 'vitest';
import { SeatOrderMode } from '@biddaloy/shared';
import {
  computeRoster,
  checkCapacity,
  checkRoomConflicts,
  allocateSeats,
  reshuffleRoom,
  type ExistingSeatAssignment,
} from './allocation';

describe('computeRoster', () => {
  it('excludes inactive/dropped enrollments and non-covered sections', () => {
    const schedules = [
      {
        schedule: { id: 'sch-1', date: '2026-10-01', starts_at: '09:00', ends_at: '11:00' },
        sections: [{ class_id: 'c1', section_id: 's1' }],
      },
    ];
    const enrollments = [
      {
        student_id: 'st-1',
        roll_number: 1,
        section_id: 's1',
        class_id: 'c1',
        enrollment_status: 'ACTIVE',
      },
      {
        student_id: 'st-2',
        roll_number: 2,
        section_id: 's1',
        class_id: 'c1',
        enrollment_status: 'DROPPED',
      },
      {
        student_id: 'st-3',
        roll_number: 3,
        section_id: 's2',
        class_id: 'c1',
        enrollment_status: 'ACTIVE',
      },
    ];
    const roster = computeRoster(schedules, enrollments);
    expect(roster.map((r) => r.student_id)).toEqual(['st-1']);
  });
});

describe('checkCapacity', () => {
  it('returns ok when selected rooms cover the roster', () => {
    const roster = Array.from({ length: 5 }, (_, i) => ({
      exam_schedule_id: 'sch-1',
      student_id: `st-${i}`,
      roll_number: i,
      section_id: 's1',
    }));
    const result = checkCapacity(roster, [{ id: 'r1', capacity: 5 }], [{ id: 'r1', capacity: 5 }]);
    expect(result.ok).toBe(true);
  });

  it('returns a shortfall with suggested rooms sorted by free capacity', () => {
    const roster = Array.from({ length: 10 }, (_, i) => ({
      exam_schedule_id: 'sch-1',
      student_id: `st-${i}`,
      roll_number: i,
      section_id: 's1',
    }));
    const allRooms = [
      { id: 'r1', capacity: 5 },
      { id: 'r2', capacity: 3 },
      { id: 'r3', capacity: 6 },
    ];
    const result = checkCapacity(roster, [allRooms[0]], allRooms);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected shortfall');
    expect(result.shortfall).toBe(5);
    expect(result.suggested_rooms).toEqual([
      { room_id: 'r3', capacity: 6 },
      { room_id: 'r2', capacity: 3 },
    ]);
  });
});

describe('checkRoomConflicts', () => {
  it('catches an overlapping date/time in another PUBLISHED plan', () => {
    const conflicts = checkRoomConflicts(
      ['r1'],
      [{ id: 'sch-new', date: '2026-10-01', starts_at: '09:00', ends_at: '11:00' }],
      [
        {
          seat_plan_id: 'plan-old',
          room_id: 'r1',
          schedules: [{ id: 'sch-old', date: '2026-10-01', starts_at: '10:00', ends_at: '12:00' }],
        },
      ],
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ room_id: 'r1', conflicting_seat_plan_id: 'plan-old' });
  });

  it('ignores a non-overlapping date/time', () => {
    const conflicts = checkRoomConflicts(
      ['r1'],
      [{ id: 'sch-new', date: '2026-10-01', starts_at: '09:00', ends_at: '11:00' }],
      [
        {
          seat_plan_id: 'plan-old',
          room_id: 'r1',
          schedules: [{ id: 'sch-old', date: '2026-10-01', starts_at: '12:00', ends_at: '13:00' }],
        },
      ],
    );
    expect(conflicts).toHaveLength(0);
  });
});

describe('allocateSeats', () => {
  const roster = [
    ...Array.from({ length: 4 }, (_, i) => ({
      exam_schedule_id: 'sch-1',
      student_id: `a-${i}`,
      roll_number: i,
      section_id: 'sec-a',
    })),
    ...Array.from({ length: 4 }, (_, i) => ({
      exam_schedule_id: 'sch-1',
      student_id: `b-${i}`,
      roll_number: i,
      section_id: 'sec-b',
    })),
  ];
  const rooms = [
    { id: 'r1', capacity: 4 },
    { id: 'r2', capacity: 4 },
  ];

  it('mixes sections within a room — no room ends up single-section', () => {
    const { assignments } = allocateSeats(roster, rooms, SeatOrderMode.SEQUENTIAL);
    const sectionsByRoom = new Map<string, Set<string>>();
    for (const a of assignments) {
      const sectionId = a.student_id.startsWith('a-') ? 'sec-a' : 'sec-b';
      const set = sectionsByRoom.get(a.room_id) ?? new Set<string>();
      set.add(sectionId);
      sectionsByRoom.set(a.room_id, set);
    }
    for (const set of sectionsByRoom.values()) {
      expect(set.size).toBeGreaterThan(1);
    }
  });

  it('assigns seat numbers sequentially within each room regardless of order mode', () => {
    const { assignments } = allocateSeats(roster, rooms, SeatOrderMode.RANDOM, 42);
    const byRoom = new Map<string, string[]>();
    for (const a of assignments) {
      const list = byRoom.get(a.room_id) ?? [];
      list.push(a.seat_number);
      byRoom.set(a.room_id, list);
    }
    for (const seats of byRoom.values()) {
      expect(seats).toEqual(seats.slice().sort((x, y) => Number(x) - Number(y)));
      expect(seats).toEqual(seats.map((_, i) => String(i + 1)));
    }
  });

  it('SEQUENTIAL order matches roll-number order within the interleave', () => {
    // Single-section roster removes interleaving as a variable, isolating
    // the roll-number ordering itself.
    const singleSection = Array.from({ length: 6 }, (_, i) => ({
      exam_schedule_id: 'sch-1',
      student_id: `s-${5 - i}`,
      roll_number: 5 - i,
      section_id: 'sec-a',
    }));
    const { assignments } = allocateSeats(
      singleSection,
      [{ id: 'r1', capacity: 6 }],
      SeatOrderMode.SEQUENTIAL,
    );
    expect(assignments.map((a) => a.student_id)).toEqual([
      's-0',
      's-1',
      's-2',
      's-3',
      's-4',
      's-5',
    ]);
  });

  it('RANDOM order is a valid permutation of the same student set', () => {
    const { assignments } = allocateSeats(roster, rooms, SeatOrderMode.RANDOM, 7);
    const original = new Set(roster.map((r) => r.student_id));
    const shuffled = assignments.map((a) => a.student_id);
    expect(new Set(shuffled)).toEqual(original);
    expect(shuffled.length).toBe(roster.length);
    // Different seed should (overwhelmingly likely) produce a different order.
    const { assignments: assignments2 } = allocateSeats(roster, rooms, SeatOrderMode.RANDOM, 99);
    expect(assignments2.map((a) => a.student_id)).not.toEqual(shuffled);
  });
});

describe('reshuffleRoom', () => {
  it('only changes the targeted room, leaving other rooms untouched', () => {
    const existing: ExistingSeatAssignment[] = [
      {
        exam_schedule_id: 'sch-1',
        student_id: 'a-1',
        section_id: 'sec-a',
        roll_number: 1,
        room_id: 'r1',
        seat_number: '1',
      },
      {
        exam_schedule_id: 'sch-1',
        student_id: 'a-2',
        section_id: 'sec-a',
        roll_number: 2,
        room_id: 'r1',
        seat_number: '2',
      },
      {
        exam_schedule_id: 'sch-1',
        student_id: 'b-1',
        section_id: 'sec-b',
        roll_number: 1,
        room_id: 'r2',
        seat_number: '1',
      },
      {
        exam_schedule_id: 'sch-1',
        student_id: 'b-2',
        section_id: 'sec-b',
        roll_number: 2,
        room_id: 'r2',
        seat_number: '2',
      },
    ];
    const result = reshuffleRoom(existing, 'r1', SeatOrderMode.RANDOM, 3);
    const r2 = result.filter((a) => a.room_id === 'r2');
    expect(r2).toEqual([
      { exam_schedule_id: 'sch-1', student_id: 'b-1', room_id: 'r2', seat_number: '1' },
      { exam_schedule_id: 'sch-1', student_id: 'b-2', room_id: 'r2', seat_number: '2' },
    ]);
    const r1 = result.filter((a) => a.room_id === 'r1');
    expect(r1.map((a) => a.student_id).sort()).toEqual(['a-1', 'a-2']);
    expect(r1.map((a) => a.seat_number).sort()).toEqual(['1', '2']);
  });
});

import type {
  AdmitCardRoster,
  ExamComponent,
  ExamScheduleRow,
  SeatPlanDetail,
  Tabulation,
} from '@biddaloy/ui/hooks';
import { REGION_BD_EN } from '@biddaloy/ui/i18n';
import { describe, expect, it } from 'vitest';

import { marksPages, seatPages, stickerRows, tabulationProps } from './build-pages';

const sched = (id: string, date: string, start: string): ExamScheduleRow => ({
  id,
  exam_id: 'e1',
  subject_id: `sub-${id}`,
  subject: { id: `sub-${id}`, name_en: `Subject ${id}`, name_bn: `বিষয় ${id}` },
  date,
  starts_at: start,
  ends_at: '12:00',
  venue: null,
});
const SCHEDULES = [sched('s1', '2026-10-18', '10:00'), sched('s2', '2026-10-19', '10:00')];

const alloc = (schedule: string, student: string, seat: string, roll: number) => ({
  id: `${schedule}-${student}`,
  exam_schedule_id: schedule,
  student_id: student,
  student_name: `Student ${student}`,
  roll_number: roll,
  section_name: 'A',
  subject_name: null,
  subject_name_bn: null,
  exam_date: null,
  starts_at: null,
  ends_at: null,
  room_id: 'x',
  seat_number: seat,
});
const room = (id: string, no: string, allocations: ReturnType<typeof alloc>[]) => ({
  room_id: id,
  room_no: no,
  building: null,
  capacity: 40,
  invigilator_user_id: null,
  invigilator_name: null,
  allocations,
});
const PLAN = {
  id: 'p1',
  name: 'Plan',
  status: 'PUBLISHED',
  seat_order_mode: 'SEQUENTIAL',
  schedule_count: 3,
  room_count: 2,
  student_count: 2,
  rooms: [
    room('r2', '102', [
      alloc('s1', 'b', '2', 2),
      alloc('s1', 'a', '1', 1),
      alloc('s2', 'a', '1', 1),
    ]),
    room('r1', '101', [
      alloc('s1', 'c', '1', 3),
      alloc('s2', 'c', '1', 3),
      alloc('other-exam', 'c', '9', 3),
    ]),
  ],
} as SeatPlanDetail;

describe('seatPages', () => {
  const pages = seatPages([PLAN], SCHEDULES, 'en', REGION_BD_EN);

  it('makes one page per room x sitting of this exam and drops other exams', () => {
    expect(pages).toHaveLength(4);
    expect(pages.flatMap((p) => p.rows).some((r) => r.seat === '9')).toBe(false);
  });

  it('sorts by date, then room, then seat', () => {
    expect(pages.map((p) => p.room)).toEqual(['101', '102', '101', '102']);
    expect(pages[1]?.rows.map((r) => r.seat)).toEqual(['1', '2']);
  });
});

describe('stickerRows', () => {
  it('gives one sticker per student per room, from the first sitting', () => {
    const stickers = stickerRows([PLAN], SCHEDULES);
    expect(stickers.filter((s) => s.name === 'Student a')).toHaveLength(1);
    expect(stickers).toHaveLength(3);
  });
});

describe('marksPages', () => {
  it('makes sections x subjects with components in order', () => {
    const roster = {
      students: [
        { student_id: '1', full_name: 'B', roll_number: 2, section_name: 'A' },
        { student_id: '2', full_name: 'A', roll_number: 1, section_name: 'A' },
        { student_id: '3', full_name: 'C', roll_number: 1, section_name: 'B' },
      ],
    } as AdmitCardRoster;
    const comp = (subject: string, name: string, sequence: number) =>
      ({ subject_id: subject, name, sequence, full_marks: '50' }) as ExamComponent;
    const components = [comp('m', 'MCQ', 2), comp('m', 'CQ', 1), comp('b', 'CQ', 1)];
    const pages = marksPages(roster, components, new Map([['m', 'Math']]), 'Eight');
    expect(pages).toHaveLength(4);
    expect(pages[0]?.components.map((c) => c.name)).toEqual(['CQ', 'MCQ']);
    expect(pages[0]?.students.map((s) => s.roll)).toEqual([1, 2]);
    expect(marksPages(roster, components, new Map(), 'Eight', 'B')).toHaveLength(2);
  });
});

describe('tabulationProps', () => {
  it('keeps a missing cell undefined and counts passes', () => {
    const data = {
      subjects: [{ subject_id: 's', name_en: 'Math', name_bn: null, full_marks: 100 }],
      rows: [
        {
          student_id: '1',
          roll_number: 1,
          full_name: 'A',
          cells: {},
          total_marks: 0,
          gpa: 0,
          grade: 'F',
          section_position: null,
          is_fail: true,
        },
      ],
    } as unknown as Tabulation;
    const tp = tabulationProps(data, 'en');
    expect(tp.rows[0]?.cells['s']).toBeUndefined();
    expect(tp).toMatchObject({ examinees: 1, failed: 1, passed: 0 });
  });
});

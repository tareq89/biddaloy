import { describe, it, expect } from 'vitest';
import type { ScheduleLessonDto, SchedulePeriodDto } from './dto/plan-schedule.dto';
import {
  examSyllabus,
  expectedFinishDate,
  lastTaught,
  lessonAt,
  nextLessons,
  subjectBlock,
  type FamilyScheduleInput,
} from './family-study-plans.view';

function lesson(i: number, over: Partial<ScheduleLessonDto> = {}): ScheduleLessonDto {
  return {
    id: `l${i}`,
    title: `Lesson ${i}`,
    periods: 1,
    taught_periods: 0,
    status: 'UPCOMING',
    expected_date: `2026-10-${String(10 + i).padStart(2, '0')}`,
    expected_end_date: `2026-10-${String(10 + i).padStart(2, '0')}`,
    overflow: false,
    in_extra_class: false,
    ...over,
  };
}

function period(date: string, slot: string, lessonId: string | null, status: string) {
  return {
    date,
    period_slot_id: slot,
    kind: 'ROUTINE',
    status,
    lesson_id: lessonId,
  } as SchedulePeriodDto;
}

const SUMMARY = { periods_behind: 4, lessons_behind: 2, lessons_done: 2, lessons_total: 8 };

function schedule(over: Partial<FamilyScheduleInput> = {}): FamilyScheduleInput {
  return { lessons: [], periods: [], summary: SUMMARY, ...over };
}

describe('family study plans view', () => {
  describe('lastTaught', () => {
    it('is the lesson of the latest TAUGHT period, numbered by plan position', () => {
      const s = schedule({
        lessons: [lesson(1), lesson(2), lesson(3)],
        periods: [
          period('2026-10-01', 'p1', 'l1', 'TAUGHT'),
          period('2026-10-08', 'p1', 'l2', 'TAUGHT'),
        ],
      });
      expect(lastTaught(s)).toEqual({ number: 2, title: 'Lesson 2', date: '2026-10-08' });
    });

    it('does not count a PARTLY period as taught', () => {
      const s = schedule({
        lessons: [lesson(1), lesson(2)],
        periods: [
          period('2026-10-01', 'p1', 'l1', 'TAUGHT'),
          period('2026-10-08', 'p1', 'l2', 'PARTLY'),
        ],
      });
      expect(lastTaught(s)?.number).toBe(1);
    });

    it('is null when nothing was taught', () => {
      expect(lastTaught(schedule({ lessons: [lesson(1)] }))).toBeNull();
    });
  });

  describe('nextLessons', () => {
    it('skips DONE lessons, keeps order, caps at 5 and keeps plan numbers', () => {
      const lessons = [
        lesson(1, { status: 'DONE' }),
        lesson(2, { status: 'DONE' }),
        ...[3, 4, 5, 6, 7, 8, 9].map((i) => lesson(i)),
      ];
      const next = nextLessons(schedule({ lessons }));
      expect(next.map((n) => n.number)).toEqual([3, 4, 5, 6, 7]);
      expect(next[0]).toEqual({ number: 3, title: 'Lesson 3', expected_date: '2026-10-13' });
    });

    it('returns fewer than 5 when fewer are left', () => {
      const lessons = [lesson(1, { status: 'DONE' }), lesson(2), lesson(3)];
      expect(nextLessons(schedule({ lessons }))).toHaveLength(2);
    });

    it('gives overflow lessons a null expected date', () => {
      const lessons = [lesson(1, { overflow: true, expected_date: '2026-12-31' })];
      expect(nextLessons(schedule({ lessons }))[0]!.expected_date).toBeNull();
    });
  });

  describe('expectedFinishDate', () => {
    it("is the last lesson's end date", () => {
      const lessons = [lesson(1), lesson(2, { expected_end_date: '2026-12-10' })];
      expect(expectedFinishDate(schedule({ lessons }))).toBe('2026-12-10');
    });

    it('is null when any lesson overflows or there are no lessons', () => {
      expect(
        expectedFinishDate(schedule({ lessons: [lesson(1), lesson(2, { overflow: true })] })),
      ).toBeNull();
      expect(expectedFinishDate(schedule())).toBeNull();
    });
  });

  describe('examSyllabus', () => {
    const lessons = Array.from({ length: 30 }, (_, i) =>
      lesson(i + 1, { status: i < 18 ? 'DONE' : 'UPCOMING' }),
    );
    const exams = new Map([['e1', { name: 'Half yearly', date: '2026-11-20' }]]);

    it('counts lessons in the syllabus (24) and taught (18)', () => {
      const out = examSyllabus(
        schedule({ lessons }),
        [{ exam_id: 'e1', up_to_lesson_id: 'l24' }],
        exams,
      );
      expect(out).toEqual([
        {
          exam_id: 'e1',
          exam_name: 'Half yearly',
          exam_date: '2026-11-20',
          lessons_in_syllabus: 24,
          lessons_taught: 18,
        },
      ]);
    });

    it('drops a marker whose lesson or exam is gone', () => {
      const out = examSyllabus(
        schedule({ lessons }),
        [
          { exam_id: 'e1', up_to_lesson_id: 'removed' },
          { exam_id: 'gone', up_to_lesson_id: 'l3' },
        ],
        exams,
      );
      expect(out).toEqual([]);
    });
  });

  describe('lessonAt', () => {
    it('numbers the lesson by plan position and counts the part across periods', () => {
      const s = schedule({
        lessons: [lesson(1), lesson(2, { periods: 2 })],
        periods: [
          period('2026-10-05', 'p1', 'l1', 'TAUGHT'),
          period('2026-10-12', 'p1', 'l2', 'TAUGHT'),
          period('2026-10-12', 'p2', 'l2', 'TAUGHT'),
        ],
      });
      const seq = new Map([
        ['p1', 1],
        ['p2', 2],
      ]);
      expect(lessonAt(s, '2026-10-12', 'p1', seq)).toEqual({
        number: 2,
        title: 'Lesson 2',
        part: 1,
        of: 2,
      });
      expect(lessonAt(s, '2026-10-12', 'p2', seq)).toEqual({
        number: 2,
        title: 'Lesson 2',
        part: 2,
        of: 2,
      });
      expect(lessonAt(s, '2026-10-19', 'p1', seq)).toBeNull();
    });
  });

  it('never puts notes or unreported counts in the subject block', () => {
    const s = schedule({ lessons: [lesson(1)] });
    // Even if the upstream summary carried them, the block copies only the allowed counts.
    (s.summary as unknown as Record<string, unknown>).unreported_periods = 9;
    (s.lessons[0] as unknown as Record<string, unknown>).notes = 'secret';
    const block = subjectBlock({
      planId: 'p',
      subject: { id: 's', name_en: 'Maths', name_bn: null },
      teacherNames: ['T'],
      schedule: s,
      markers: [],
      exams: new Map(),
    });
    const json = JSON.stringify(block);
    expect(json).not.toContain('notes');
    expect(json).not.toContain('secret');
    expect(json).not.toContain('unreported');
  });
});

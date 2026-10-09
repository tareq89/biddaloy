import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource, QueryRunner } from 'typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ExamKind, ExamStatus } from '@biddaloy/shared';
import { School } from '../src/modules/schools/entities/school.entity';
import { AcademicYear } from '../src/modules/academics/entities/academic-year.entity';
import { Class } from '../src/modules/academics/entities/class.entity';
import { ClassSection } from '../src/modules/academics/entities/class-section.entity';
import { Subject } from '../src/modules/academics/entities/subject.entity';
import { AcademicTerm } from '../src/modules/calendar/entities/academic-term.entity';
import { Exam } from '../src/modules/exams/entities/exam.entity';
import { ExamSchedule } from '../src/modules/exams/entities/exam-schedule.entity';
import { Room } from '../src/modules/routines/entities/room.entity';
import { Shift } from '../src/modules/routines/entities/shift.entity';
import { SeatPlans1789800014000 } from '../src/migrations/1789800014000-SeatPlans';

/**
 * [25.1.1] Runs the seat-plans migration's `up`/`down` directly against the
 * test database (already migrated once by `global-setup.ts`, which includes
 * this migration). Follows `routines-migration.integration.spec.ts`'s
 * pattern: `down()` then `up()` inside one `it()`, schema restored in
 * `finally` so a later spec file in this worker isn't left broken.
 */
describe('SeatPlans1789800014000 (integration)', () => {
  let dataSource: DataSource;
  let queryRunner: QueryRunner;
  const migration = new SeatPlans1789800014000();

  const TABLES = ['seat_plans', 'seat_plan_schedules', 'seat_allocations'].sort();

  beforeAll(async () => {
    const module = await createTestModule(
      [
        School,
        AcademicYear,
        Class,
        ClassSection,
        Subject,
        AcademicTerm,
        Exam,
        ExamSchedule,
        Room,
        Shift,
      ],
      [],
    );
    dataSource = module.get(DataSource);
    queryRunner = dataSource.createQueryRunner();
  }, 60000);

  afterAll(async () => {
    await queryRunner.release();
    await dataSource.destroy();
  });

  async function existingSeatPlanTables(): Promise<string[]> {
    const rows: Array<{ table_name: string }> = await dataSource.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1)`,
      [TABLES],
    );
    return rows.map((r) => r.table_name).sort();
  }

  async function examSchedulesRoomIdExists(): Promise<boolean> {
    const rows = await dataSource.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'exam_schedules' AND column_name = 'room_id'`,
    );
    return rows.length > 0;
  }

  it('is up after global migrations run: all three tables and exam_schedules.room_id exist', async () => {
    expect(await existingSeatPlanTables()).toEqual(TABLES);
    expect(await examSchedulesRoomIdExists()).toBe(true);
  });

  it('down() drops the three tables and room_id; up() restores them and backfills room_id from a matching venue', async () => {
    const school = await dataSource
      .getRepository(School)
      .save({ name: 'Seat Plan Migration School', slug: `seat-plan-migration-${Date.now()}` });
    const year = await dataSource.getRepository(AcademicYear).save({
      name: '2026-2027',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      tenant_id: school.id,
    });
    const klass = await dataSource.getRepository(Class).save({
      name: 'Seat Plan Migration Class',
      academic_year_id: year.id,
      tenant_id: school.id,
    });
    const subject = await dataSource.getRepository(Subject).save({
      tenant_id: school.id,
      name_en: 'Mathematics',
      name_bn: 'গণিত',
      code: `MATH-${school.id.slice(0, 8)}`,
    });
    const subjectTwo = await dataSource.getRepository(Subject).save({
      tenant_id: school.id,
      name_en: 'English',
      name_bn: 'ইংরেজি',
      code: `ENG-${school.id.slice(0, 8)}`,
    });
    const exam = await dataSource.getRepository(Exam).save({
      tenant_id: school.id,
      academic_year_id: year.id,
      class_id: klass.id,
      name: 'Seat Plan Migration Exam',
      kind: ExamKind.TERM,
      status: ExamStatus.DRAFT,
    });
    const room = await dataSource.getRepository(Room).save({
      tenant_id: school.id,
      room_no: 'Room 204',
    });
    // Matches the room case-insensitively (with surrounding whitespace).
    const matchingSchedule = await dataSource.getRepository(ExamSchedule).save({
      tenant_id: school.id,
      exam_id: exam.id,
      subject_id: subject.id,
      date: '2027-01-10',
      starts_at: '09:00:00',
      ends_at: '11:00:00',
      venue: '  room 204  ',
    });
    // No matching room — must stay NULL, must not fail the migration.
    const unmatchedSchedule = await dataSource.getRepository(ExamSchedule).save({
      tenant_id: school.id,
      exam_id: exam.id,
      subject_id: subjectTwo.id,
      date: '2027-01-11',
      starts_at: '09:00:00',
      ends_at: '11:00:00',
      venue: 'Nowhere Hall',
    });

    await migration.down(queryRunner);
    try {
      expect(await existingSeatPlanTables()).toEqual([]);
      expect(await examSchedulesRoomIdExists()).toBe(false);
      // down() only drops room_id — venue must survive so up() can re-derive it.
      const [{ venue }] = await dataSource.query('SELECT venue FROM exam_schedules WHERE id = $1', [
        matchingSchedule.id,
      ]);
      expect(venue).toBe('  room 204  ');
    } finally {
      await migration.up(queryRunner);
    }

    expect(await existingSeatPlanTables()).toEqual(TABLES);
    expect(await examSchedulesRoomIdExists()).toBe(true);

    const [matched] = await dataSource.query('SELECT room_id FROM exam_schedules WHERE id = $1', [
      matchingSchedule.id,
    ]);
    expect(matched.room_id).toBe(room.id);

    const [unmatched] = await dataSource.query('SELECT room_id FROM exam_schedules WHERE id = $1', [
      unmatchedSchedule.id,
    ]);
    expect(unmatched.room_id).toBeNull();
  });
});

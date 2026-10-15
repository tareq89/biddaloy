import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID } from '@test/constants';
import { AttendanceModule } from './attendance.module';
import { AuthModule } from '../auth/auth.module';
import { AttendanceDashboardService } from './attendance-dashboard.service';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';

/**
 * [8.10.7.6.02] The dashboard's on-roll filter was rewritten from a per-row correlated EXISTS
 * to a once-per-(student, section) join. This runs the ORIGINAL SQL and the new query over the
 * same fixture and demands identical (date, status, count) rows.
 */
const OLD_SQL = `
  SELECT r.date::text AS date, r.status::text AS status, COUNT(*)::text AS count
  FROM attendance_records r
  INNER JOIN attendance_sessions s ON s.id = r.session_id AND s.tenant_id = r.tenant_id
  WHERE r.tenant_id = $1 AND s.period_no IS NULL AND s.state = 'FINALIZED'
    AND r.student_id = ANY($2::uuid[])
    AND EXISTS (
      SELECT 1 FROM enrollments e
      JOIN students st ON st.id = e.student_id AND st.tenant_id = e.tenant_id AND st.deleted_at IS NULL
      WHERE e.tenant_id = r.tenant_id AND e.student_id = r.student_id AND e.section_id = s.section_id
        AND (e.enrollment_status = 'ACTIVE' OR (
          SELECT MAX(le.occurred_on) FROM student_lifecycle_events le
          WHERE le.tenant_id = e.tenant_id AND le.student_id = e.student_id
            AND le.enrollment_id = e.id AND le.event_type <> 'READMITTED'
        ) > r.date))
  GROUP BY r.date, r.status ORDER BY 1, 2`;

describe('AttendanceDashboardService.dayRecords on-roll rule (old vs new)', () => {
  let ds: DataSource;
  let service: AttendanceDashboardService;
  const studentIds: string[] = [];

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [],
      [ConfigModule.forRoot({ isGlobal: true }), AttendanceModule, AuthModule],
    );
    service = module.get(AttendanceDashboardService);
    ds = module.get<DataSource>(getDataSourceToken());
  }, 60000);

  afterAll(async () => {
    await ds?.destroy();
  });

  // The test setup empties tables between tests, so the fixture is built inside the test.
  it('returns exactly the rows the old correlated EXISTS returned', async () => {
    const year = await ds
      .getRepository(AcademicYear)
      .save({
        name: 'Roll Year',
        start_date: '2026-01-01',
        end_date: '2026-12-31',
        tenant_id: SEED_TENANT_ID,
      });
    const oldYear = await ds
      .getRepository(AcademicYear)
      .save({
        name: 'Roll Old',
        start_date: '2025-01-01',
        end_date: '2025-12-31',
        tenant_id: SEED_TENANT_ID,
      });
    const klass = await ds
      .getRepository(Class)
      .save({ name: 'Roll Class', academic_year_id: year.id, tenant_id: SEED_TENANT_ID });
    const sec = await ds
      .getRepository(ClassSection)
      .save({ section_name: 'R', class_id: klass.id, tenant_id: SEED_TENANT_ID });
    const [session] = await ds.query(
      `INSERT INTO attendance_sessions (tenant_id, section_id, date, period_no, state, source, marked_at, finalized_at)
       VALUES ($1, $2, '2026-03-10', NULL, 'FINALIZED', 'SYSTEM', NOW(), NOW()) RETURNING id`,
      [SEED_TENANT_ID, sec.id],
    );

    // name -> enrollments [status, left-on date or null, year], deleted?
    const cases: Record<
      string,
      { enr: [string, string | null, 'cur' | 'old'][]; deleted?: boolean }
    > = {
      active: { enr: [['ACTIVE', null, 'cur']] },
      leftAfter: { enr: [['INACTIVE', '2026-04-01', 'cur']] }, // on the roll on 10 Mar
      leftBefore: { enr: [['INACTIVE', '2026-03-01', 'cur']] }, // off the roll
      leftNoEvent: { enr: [['INACTIVE', null, 'cur']] }, // off on every date
      // two enrollments in ONE section: one ended early, one with a later leave
      twoEnrollments: {
        enr: [
          ['INACTIVE', '2026-03-01', 'cur'],
          ['GRADUATED', '2026-05-01', 'old'],
        ],
      },
      deleted: { enr: [['ACTIVE', null, 'cur']], deleted: true },
    };
    for (const [name, c] of Object.entries(cases)) {
      const [st] = await ds.query(
        `INSERT INTO students (tenant_id, full_name, registration_number, roll_number, class_section_id, enrollment_status, deleted_at)
         VALUES ($1, $2, $3, $6, $4, 'ACTIVE', $5) RETURNING id`,
        [
          SEED_TENANT_ID,
          `Roll ${name}`,
          `ROLL-${name}-${Date.now()}`,
          sec.id,
          c.deleted ? new Date() : null,
          studentIds.length + 1,
        ],
      );
      studentIds.push(st.id);
      for (const [status, leftOn, which] of c.enr) {
        const [en] = await ds.query(
          `INSERT INTO enrollments (tenant_id, student_id, class_id, section_id, academic_year_id, enrollment_status, enrolled_at)
           VALUES ($1,$2,$3,$4,$5,$6::enrollments_status_enum,NOW()) RETURNING id`,
          [SEED_TENANT_ID, st.id, klass.id, sec.id, which === 'cur' ? year.id : oldYear.id, status],
        );
        if (leftOn) {
          await ds.query(
            `INSERT INTO student_lifecycle_events (tenant_id, student_id, enrollment_id, academic_year_id, event_type, occurred_on, reason)
             VALUES ($1,$2,$3,$4,'WITHDRAWN',$5,'test')`,
            [SEED_TENANT_ID, st.id, en.id, which === 'cur' ? year.id : oldYear.id, leftOn],
          );
        }
      }
      await ds.query(
        `INSERT INTO attendance_records (tenant_id, session_id, student_id, date, status, source)
         VALUES ($1,$2,$3,'2026-03-10','PRESENT','SYSTEM')`,
        [SEED_TENANT_ID, session.id, st.id],
      );
    }

    const oldRows = await ds.query(OLD_SQL, [SEED_TENANT_ID, studentIds]);
    const newRows = await (service as any)
      .dayRecords(SEED_TENANT_ID)
      .select('r.date::text', 'date')
      .addSelect('r.status::text', 'status')
      .addSelect('COUNT(*)::text', 'count')
      .andWhere('r.student_id IN (:...ids)', { ids: studentIds })
      .groupBy('r.date')
      .addGroupBy('r.status')
      .orderBy('r.date')
      .getRawMany();
    // Counted: active, leftAfter, twoEnrollments (the old-year row leaves after 10 Mar). Not
    // counted: leftBefore, leftNoEvent, deleted student.
    expect(oldRows).toEqual([{ date: '2026-03-10', status: 'PRESENT', count: '3' }]);
    expect(newRows).toEqual(oldRows);
  });
});

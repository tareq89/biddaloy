import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource, QueryRunner } from 'typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { StudentLifecycle1790800000000 } from '../src/migrations/1790800000000-StudentLifecycle';
import { EvaluationsAndPerformance1790900000000 } from '../src/migrations/1790900000000-EvaluationsAndPerformance';

/**
 * [39.1.2]/#1183 Runs against the real migrated schema (default
 * `synchronize: false`): the global setup has already applied
 * `StudentLifecycle1790800000000` against an empty DB. This spec seeds
 * enrollments in every status, then runs `down()` + `up()` — proving the
 * round-trip and exercising the D23 backfill on real rows — and checks
 * per-school `birth_reg_no` uniqueness and tenant isolation.
 */
describe('StudentLifecycle1790800000000 (integration)', () => {
  let ds: DataSource;
  const migration = new StudentLifecycle1790800000000();
  // Later migration that adds student_notes.rating (+ other tables) on top of
  // the table this one creates; see seedAndRoundTrip().
  const later = new EvaluationsAndPerformance1790900000000();

  const T1 = '39000000-0000-4000-8000-000000000001';
  const T2 = '39000000-0000-4000-8000-000000000002';
  let ctx1: { yearId: string; classId: string; sectionId: string };
  let ctx2: typeof ctx1;
  const ids = { year: {} as Record<string, string>, enrollments: {} as Record<string, string> };

  async function run(fn: (qr: QueryRunner) => Promise<void>) {
    const qr = ds.createQueryRunner();
    await qr.connect();
    try {
      await fn(qr);
    } finally {
      await qr.release();
    }
  }

  async function seedTenant(tenant: string, slug: string) {
    await ds.query(`INSERT INTO schools (id, name, slug) VALUES ($1, $2, $2)`, [tenant, slug]);
    const [year] = await ds.query(
      `INSERT INTO academic_years (name, start_date, end_date, is_current, tenant_id)
       VALUES ('lc-year', '2026-01-01', '2026-12-31', false, $1) RETURNING id`,
      [tenant],
    );
    const [klass] = await ds.query(
      `INSERT INTO classes (name, numeric_grade, academic_year_id, tenant_id)
       VALUES ('lc-class', 6, $1, $2) RETURNING id`,
      [year.id, tenant],
    );
    const [section] = await ds.query(
      `INSERT INTO class_sections (class_id, section_name, tenant_id) VALUES ($1, 'A', $2) RETURNING id`,
      [klass.id, tenant],
    );
    ids.year[tenant] = year.id;
    return {
      yearId: year.id as string,
      classId: klass.id as string,
      sectionId: section.id as string,
    };
  }

  async function seedStudentWithEnrollment(
    tenant: string,
    ctx: { yearId: string; classId: string; sectionId: string },
    n: number,
    status: string,
  ) {
    const [student] = await ds.query(
      `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [`LC ${n}`, `LC-${tenant.slice(-1)}-${n}`, n, ctx.sectionId, tenant],
    );
    const [enr] = await ds.query(
      `INSERT INTO enrollments (student_id, class_id, section_id, academic_year_id, enrollment_status, tenant_id, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, '2026-03-15T10:00:00Z') RETURNING id`,
      [student.id, ctx.classId, ctx.sectionId, ctx.yearId, status, tenant],
    );
    ids.enrollments[`${tenant}:${status}`] = enr.id;
    return student.id as string;
  }

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get(DataSource);
    ctx1 = await seedTenant(T1, 'lc-school-1');
    ctx2 = await seedTenant(T2, 'lc-school-2');
  });

  // Global per-test reset wipes students/enrollments, so seed inside the test.
  async function seedAndRoundTrip() {
    let n = 0;
    for (const status of ['ACTIVE', 'INACTIVE', 'TRANSFERRED', 'GRADUATED']) {
      await seedStudentWithEnrollment(T1, ctx1, (n += 1), status);
    }
    await seedStudentWithEnrollment(T2, ctx2, (n += 1), 'INACTIVE');
    // down() then up(): round-trip on a populated DB, and the backfill runs on real rows.
    // Revert the later migration first, as `migration:revert` would: this
    // down() drops student_notes and up() recreates it WITHOUT `rating`, which
    // 1790900000000 adds. Without the revert, every later spec file in this
    // worker (student-notes, evaluations-performance) sees a rating-less table.
    // Restore in `finally` so a failed step cannot poison them either.
    await run((qr) => later.down(qr));
    try {
      await run((qr) => migration.down(qr));
      await run((qr) => migration.up(qr));
    } finally {
      await run((qr) => later.up(qr));
    }
  }

  afterAll(async () => {
    if (!ds) return;
    await ds.query(`DELETE FROM student_lifecycle_events WHERE tenant_id IN ($1, $2)`, [T1, T2]);
    await ds.query(`DELETE FROM enrollments WHERE tenant_id IN ($1, $2)`, [T1, T2]);
    await ds.query(`DELETE FROM students WHERE tenant_id IN ($1, $2)`, [T1, T2]);
    await ds.query(`DELETE FROM class_sections WHERE tenant_id IN ($1, $2)`, [T1, T2]);
    await ds.query(`DELETE FROM classes WHERE tenant_id IN ($1, $2)`, [T1, T2]);
    await ds.query(`DELETE FROM academic_years WHERE tenant_id IN ($1, $2)`, [T1, T2]);
    await ds.query(`DELETE FROM schools WHERE id IN ($1, $2)`, [T1, T2]);
    await ds.destroy();
  });

  it('backfills one event per non-ACTIVE enrollment with the mapped type, and none for ACTIVE', async () => {
    await seedAndRoundTrip();
    const rows = await ds.query(
      `SELECT enrollment_id, event_type, occurred_on::text AS occurred_on, reason, remark, recorded_by_user_id
       FROM student_lifecycle_events WHERE tenant_id = $1`,
      [T1],
    );
    expect(rows).toHaveLength(3);
    const byEnrollment = new Map(rows.map((r: { enrollment_id: string }) => [r.enrollment_id, r]));
    const expected: Record<string, string> = {
      INACTIVE: 'WITHDRAWN',
      TRANSFERRED: 'TRANSFERRED_OUT',
      GRADUATED: 'GRADUATED',
    };
    for (const [status, type] of Object.entries(expected)) {
      expect(byEnrollment.get(ids.enrollments[`${T1}:${status}`])).toMatchObject({
        event_type: type,
        occurred_on: '2026-03-15',
        reason: 'backfilled',
        remark: 'backfilled',
        recorded_by_user_id: null,
      });
    }
    expect(byEnrollment.has(ids.enrollments[`${T1}:ACTIVE`])).toBe(false);
  });

  it('leaves later migrations intact: student_notes.rating survives the round-trip', async () => {
    await seedAndRoundTrip();
    const rows = await ds.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'student_notes' AND column_name = 'rating'`,
    );
    expect(rows).toHaveLength(1);
  });

  it('keeps events tenant-scoped', async () => {
    await seedAndRoundTrip();
    const t2 = await ds.query(
      `SELECT enrollment_id FROM student_lifecycle_events WHERE tenant_id = $1`,
      [T2],
    );
    expect(t2).toHaveLength(1);
    expect(t2[0].enrollment_id).toBe(ids.enrollments[`${T2}:INACTIVE`]);
  });

  it('scopes birth_reg_no uniqueness per school and ignores soft-deleted rows', async () => {
    const [{ id: sectionId1 }] = await ds.query(
      `SELECT id FROM class_sections WHERE tenant_id = $1`,
      [T1],
    );
    const [{ id: sectionId2 }] = await ds.query(
      `SELECT id FROM class_sections WHERE tenant_id = $1`,
      [T2],
    );
    const insert = (tenant: string, section: string, n: number, brn: string | null) =>
      ds.query(
        `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id, birth_reg_no)
         VALUES ('B', $1, $2, $3, $4, $5)`,
        [`BRN-${tenant.slice(-1)}-${n}`, 100 + n, section, tenant, brn],
      );

    await insert(T1, sectionId1, 1, 'BRN-1');
    await expect(insert(T1, sectionId1, 2, 'BRN-1')).rejects.toThrow(
      /IDX_students_tenant_birth_reg_no/,
    );
    await insert(T2, sectionId2, 1, 'BRN-1'); // same number, other school: fine
    await insert(T1, sectionId1, 3, null);
    await insert(T1, sectionId1, 4, null); // NULLs never collide

    await ds.query(
      `UPDATE students SET deleted_at = now() WHERE tenant_id = $1 AND birth_reg_no = 'BRN-1'`,
      [T1],
    );
    await insert(T1, sectionId1, 5, 'BRN-1'); // soft-deleted holder frees the number
  });
});

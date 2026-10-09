import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { DataSource, QueryRunner } from 'typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { School } from '../src/modules/schools/entities/school.entity';
import { StudyPlans1791500000000 } from '../src/migrations/1791500000000-StudyPlans';

/**
 * [66.1.02/#2000] Runs the study-plans migration against the test database
 * (already migrated by `global-setup.ts`). Proves the rules live in the
 * database: scope uniqueness (incl. NULL term), one delivery per
 * section/date/period, reason-iff-NOT_TAUGHT, jsonb array checks, cascades,
 * and RESTRICT on a delivery's period slot.
 * `down()` then `up()` run inside one test so later specs still see the tables.
 * This is the newest migration, so nothing has to be reverted first.
 */
describe('StudyPlans1791500000000 (integration)', () => {
  let dataSource: DataSource;
  let queryRunner: QueryRunner;
  const migration = new StudyPlans1791500000000();

  const TABLES = ['lesson_deliveries', 'study_plan_templates', 'study_plans'];
  const ENUMS = ['lesson_deliveries_reason_enum', 'lesson_deliveries_status_enum'];

  let tenantId: string;
  let otherTenantId: string;
  let yearId: string;
  let termA: string;
  let termB: string;
  let sectionId: string;
  let subjectA: string;
  let subjectB: string;
  let slotA: string;
  let slotB: string;
  let userId: string;

  beforeAll(async () => {
    const module = await createTestModule([School], []);
    dataSource = module.get(DataSource);
    queryRunner = dataSource.createQueryRunner();
  }, 60000);

  afterAll(async () => {
    await queryRunner.release();
    await dataSource.destroy();
  });

  const one = async (sql: string, params: unknown[] = []): Promise<string> => {
    const [{ id }] = await dataSource.query(sql, params);
    return id;
  };

  beforeEach(async () => {
    const tag = Math.random().toString(36).slice(2, 10);
    tenantId = await one(
      `INSERT INTO "schools" (name, slug) VALUES ('SP Test School', $1) RETURNING id`,
      [`sp-test-${tag}`],
    );
    otherTenantId = await one(
      `INSERT INTO "schools" (name, slug) VALUES ('SP Other School', $1) RETURNING id`,
      [`sp-other-${tag}`],
    );
    yearId = await one(
      `INSERT INTO "academic_years" (name, start_date, end_date, tenant_id) VALUES ($1, '2026-01-01', '2026-12-31', $2) RETURNING id`,
      [`SP ${tag}`, tenantId],
    );
    const term = (seq: number, from: string, to: string) =>
      one(
        `INSERT INTO "academic_terms" (tenant_id, academic_year_id, seq, name, start_date, end_date) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [tenantId, yearId, seq, `Term ${seq}`, from, to],
      );
    termA = await term(1, '2026-01-01', '2026-06-30');
    termB = await term(2, '2026-07-01', '2026-12-31');
    const classId = await one(
      `INSERT INTO "classes" (name, academic_year_id, tenant_id) VALUES ('SP Class', $1, $2) RETURNING id`,
      [yearId, tenantId],
    );
    sectionId = await one(
      `INSERT INTO "class_sections" (class_id, section_name, tenant_id) VALUES ($1, 'A', $2) RETURNING id`,
      [classId, tenantId],
    );
    const subject = (code: string) =>
      one(`INSERT INTO "subjects" (tenant_id, name_en, code) VALUES ($1, $2, $2) RETURNING id`, [
        tenantId,
        code,
      ]);
    subjectA = await subject('MATH');
    subjectB = await subject('ENG');
    const shiftId = await one(
      `INSERT INTO "shifts" (tenant_id, name, day_starts_at, day_ends_at, sequence) VALUES ($1, 'Morning', '08:00', '13:00', 1) RETURNING id`,
      [tenantId],
    );
    const slot = (seq: number, from: string, to: string) =>
      one(
        `INSERT INTO "period_slots" (tenant_id, shift_id, sequence, kind, starts_at, ends_at) VALUES ($1, $2, $3, 'CLASS', $4, $5) RETURNING id`,
        [tenantId, shiftId, seq, from, to],
      );
    slotA = await slot(1, '08:00', '08:45');
    slotB = await slot(2, '08:45', '09:30');
    userId = await one(
      `INSERT INTO "users" (email, full_name) VALUES ($1, 'SP Teacher') RETURNING id`,
      [`sp-${tag}@example.test`],
    );
  });

  afterEach(async () => {
    // ON DELETE CASCADE from schools clears the whole tree; users is global.
    await dataSource.query(`DELETE FROM "schools" WHERE id = ANY($1)`, [[tenantId, otherTenantId]]);
    await dataSource.query(`DELETE FROM "users" WHERE id = $1`, [userId]);
  });

  const insertPlan = (term: string | null, subject = subjectA) =>
    dataSource.query(
      `INSERT INTO "study_plans" (tenant_id, academic_year_id, academic_term_id, section_id, subject_id) VALUES ($1, $2, $3, $4, $5)`,
      [tenantId, yearId, term, sectionId, subject],
    );

  const insertDelivery = (
    over: { subject?: string; slot?: string; status?: string; reason?: string | null } = {},
    isExtra = false,
  ) =>
    dataSource.query(
      `INSERT INTO "lesson_deliveries" (tenant_id, section_id, subject_id, date, period_slot_id, status, reason, is_extra, recorded_by_user_id)
       VALUES ($1, $2, $3, '2026-03-02', $4, $5, $6, $7, $8)`,
      [
        tenantId,
        sectionId,
        over.subject ?? subjectA,
        over.slot ?? slotA,
        over.status ?? 'TAUGHT',
        over.reason ?? null,
        isExtra,
        userId,
      ],
    );

  const insertTemplate = (tenant: string, name: string, lessons = '[]') =>
    dataSource.query(
      `INSERT INTO "study_plan_templates" (tenant_id, name, class_grade, subject_code, lessons) VALUES ($1, $2, 6, 'MATH', $3::jsonb)`,
      [tenant, name, lessons],
    );

  async function tableNames(): Promise<string[]> {
    const rows: Array<{ table_name: string }> = await dataSource.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1)`,
      [TABLES],
    );
    return rows.map((r) => r.table_name).sort();
  }

  async function enumNames(): Promise<string[]> {
    const rows: Array<{ typname: string }> = await dataSource.query(
      `SELECT typname FROM pg_type WHERE typname = ANY($1)`,
      [ENUMS],
    );
    return rows.map((r) => r.typname).sort();
  }

  async function isNullable(table: string, column: string): Promise<string> {
    const [{ is_nullable }] = await dataSource.query(
      `SELECT is_nullable FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
      [table, column],
    );
    return is_nullable;
  }

  it('is up after global migrations: tables, enums and nullability', async () => {
    expect(await tableNames()).toEqual(TABLES);
    expect(await enumNames()).toEqual(ENUMS);
    expect(await isNullable('study_plans', 'academic_term_id')).toBe('YES');
    expect(await isNullable('lesson_deliveries', 'reason')).toBe('YES');
    expect(await isNullable('lesson_deliveries', 'recorded_by_user_id')).toBe('YES');
    expect(await isNullable('study_plans', 'section_id')).toBe('NO');
  });

  it('rejects a second live plan for the same (section, subject, term) with 23505', async () => {
    await insertPlan(termA);
    await expect(insertPlan(termA)).rejects.toMatchObject({ code: '23505' });
  });

  it('rejects two live whole-year plans (NULL term) - NULLS NOT DISTINCT', async () => {
    await insertPlan(null);
    await expect(insertPlan(null)).rejects.toMatchObject({ code: '23505' });
  });

  it('allows a new plan after the first is soft-deleted', async () => {
    await insertPlan(termA);
    await dataSource.query(`UPDATE "study_plans" SET deleted_at = now() WHERE section_id = $1`, [
      sectionId,
    ]);
    await expect(insertPlan(termA)).resolves.toBeDefined();
  });

  it('allows the same (section, subject) in different terms', async () => {
    await insertPlan(termA);
    await expect(insertPlan(termB)).resolves.toBeDefined();
  });

  it('rejects a non-array lessons / exam_markers value', async () => {
    await expect(
      dataSource.query(
        `INSERT INTO "study_plans" (tenant_id, academic_year_id, section_id, subject_id, lessons) VALUES ($1, $2, $3, $4, '{}'::jsonb)`,
        [tenantId, yearId, sectionId, subjectA],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      dataSource.query(
        `INSERT INTO "study_plans" (tenant_id, academic_year_id, section_id, subject_id, exam_markers) VALUES ($1, $2, $3, $4, '{}'::jsonb)`,
        [tenantId, yearId, sectionId, subjectA],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('rejects two deliveries for one (section, date, period) even for different subjects', async () => {
    await insertDelivery();
    await expect(insertDelivery({ subject: subjectB })).rejects.toMatchObject({ code: '23505' });
    // A different period on the same day is fine.
    await expect(insertDelivery({ slot: slotB })).resolves.toBeDefined();
  });

  it('enforces reason present exactly when NOT_TAUGHT, and no extra NOT_TAUGHT', async () => {
    await expect(insertDelivery({ status: 'NOT_TAUGHT' })).rejects.toMatchObject({
      code: '23514',
    });
    await expect(insertDelivery({ status: 'TAUGHT', reason: 'EXAM' })).rejects.toMatchObject({
      code: '23514',
    });
    await expect(
      insertDelivery({ status: 'NOT_TAUGHT', reason: 'EXAM' }, true),
    ).rejects.toMatchObject({ code: '23514' });
    // Valid shapes: NOT_TAUGHT + reason, and an extra TAUGHT class.
    await expect(insertDelivery({ status: 'NOT_TAUGHT', reason: 'EXAM' })).resolves.toBeDefined();
    await expect(insertDelivery({ slot: slotB }, true)).resolves.toBeDefined();
  });

  it('rejects a non-array template lessons value', async () => {
    await expect(insertTemplate(tenantId, 'Bad', '{}')).rejects.toMatchObject({ code: '23514' });
  });

  it('rejects a duplicate live template name per tenant but allows another tenant', async () => {
    await insertTemplate(tenantId, 'Annual');
    await expect(insertTemplate(tenantId, 'Annual')).rejects.toMatchObject({ code: '23505' });
    await expect(insertTemplate(otherTenantId, 'Annual')).resolves.toBeDefined();
  });

  it('nulls recorded_by_user_id when the user is deleted', async () => {
    await insertDelivery();
    await dataSource.query(`DELETE FROM "users" WHERE id = $1`, [userId]);
    const [row] = await dataSource.query(
      `SELECT recorded_by_user_id FROM "lesson_deliveries" WHERE tenant_id = $1`,
      [tenantId],
    );
    expect(row.recorded_by_user_id).toBeNull();
  });

  it('refuses to delete a period slot that a delivery points at (RESTRICT, 23503)', async () => {
    await insertDelivery();
    await expect(
      dataSource.query(`DELETE FROM "period_slots" WHERE id = $1`, [slotA]),
    ).rejects.toMatchObject({ code: '23503' });
    // An unreferenced slot still deletes.
    await expect(
      dataSource.query(`DELETE FROM "period_slots" WHERE id = $1`, [slotB]),
    ).resolves.toBeDefined();
  });

  it('cascades all three tables when the school is deleted', async () => {
    await insertPlan(termA);
    await insertDelivery();
    await insertTemplate(tenantId, 'Cascade');
    await dataSource.query(`DELETE FROM "schools" WHERE id = $1`, [tenantId]);
    for (const table of TABLES) {
      const [{ count }] = await dataSource.query(
        `SELECT count(*)::int AS count FROM "${table}" WHERE tenant_id = $1`,
        [tenantId],
      );
      expect(count).toBe(0);
    }
  });

  it('down() drops the tables and both enums; up() restores them', async () => {
    try {
      await migration.down(queryRunner);
      expect(await tableNames()).toEqual([]);
      expect(await enumNames()).toEqual([]);
    } finally {
      // Always restore so a failed assertion cannot strand later specs.
      if ((await tableNames()).length === 0) await migration.up(queryRunner);
    }
    expect(await tableNames()).toEqual(TABLES);
    expect(await enumNames()).toEqual(ENUMS);
  });
});

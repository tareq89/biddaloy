import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { DataSource, QueryRunner } from 'typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { School } from '../src/modules/schools/entities/school.entity';
import { SubjectChoiceGroups1791100000000 } from '../src/migrations/1791100000000-SubjectChoiceGroups';

/**
 * [35.1.7/#1299] Subject choice groups migration + triggers. `down()` then
 * `up()` run in one test so later specs still see the columns.
 */
describe('SubjectChoiceGroups1791100000000 (integration)', () => {
  let ds: DataSource;
  let queryRunner: QueryRunner;
  let tenantId: string;
  let yearId: string;
  let classId: string;
  let studentId: string;
  let sectionId: string;
  let seq = 0;
  const migration = new SubjectChoiceGroups1791100000000();

  beforeAll(async () => {
    const module = await createTestModule([School], []);
    ds = module.get(DataSource);
    queryRunner = ds.createQueryRunner();
  }, 60000);

  afterAll(async () => {
    await queryRunner.release();
    await ds.destroy();
  });

  async function seedTenant() {
    const [{ id: t }] = await ds.query(
      `INSERT INTO "schools" (id, name, slug) VALUES (gen_random_uuid(), 'SCG Test School', 'scg-test-' || substr(gen_random_uuid()::text, 1, 8)) RETURNING id`,
    );
    const [{ id: y }] = await ds.query(
      `INSERT INTO "academic_years" (id, tenant_id, name, start_date, end_date, is_current) VALUES (gen_random_uuid(), $1, '2026', '2026-01-01', '2026-12-31', true) RETURNING id`,
      [t],
    );
    const [{ id: c }] = await ds.query(
      `INSERT INTO "classes" (id, tenant_id, name, academic_year_id) VALUES (gen_random_uuid(), $1, 'C', $2) RETURNING id`,
      [t, y],
    );
    const [{ id: s }] = await ds.query(
      `INSERT INTO "class_sections" (id, tenant_id, class_id, section_name) VALUES (gen_random_uuid(), $1, $2, 'A') RETURNING id`,
      [t, c],
    );
    return { t, y, c, s };
  }

  async function student(t: string, s: string): Promise<string> {
    seq += 1;
    const [{ id }] = await ds.query(
      `INSERT INTO "students" (id, tenant_id, full_name, registration_number, roll_number, class_section_id) VALUES (gen_random_uuid(), $1, 'S', $2, $3, $4) RETURNING id`,
      [t, `SCG-${Date.now()}-${seq}`, seq, s],
    );
    return id;
  }

  async function subject(t: string): Promise<string> {
    seq += 1;
    const [{ id }] = await ds.query(
      `INSERT INTO "subjects" (id, tenant_id, name_en, code) VALUES (gen_random_uuid(), $1, 'Sub', $2) RETURNING id`,
      [t, `S${seq}${Date.now() % 100000}`],
    );
    return id;
  }

  async function classSubject(
    group: string | null,
    extra: { optional?: boolean; groupName?: string | null } = {},
    t = tenantId,
    y = yearId,
    c = classId,
  ): Promise<string> {
    const [{ id }] = await ds.query(
      `INSERT INTO "class_subjects" (id, tenant_id, class_id, subject_id, academic_year_id, is_optional, group_name, choice_group)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [t, c, await subject(t), y, extra.optional ?? false, extra.groupName ?? null, group],
    );
    return id;
  }

  const pick = (csId: string, fourth = false, st = studentId, t = tenantId, y = yearId) =>
    ds.query(
      `INSERT INTO "student_subject_choices" (tenant_id, student_id, class_subject_id, academic_year_id, is_fourth)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, choice_group`,
      [t, st, csId, y, fourth],
    );

  const code = async (p: Promise<unknown>) =>
    p.then(
      () => null,
      (e: { code?: string; message?: string }) =>
        e.code === 'P0001' ? e.message : (e.code ?? e.message),
    );

  beforeEach(async () => {
    const s = await seedTenant();
    tenantId = s.t;
    yearId = s.y;
    classId = s.c;
    sectionId = s.s;
    studentId = await student(tenantId, sectionId);
  });

  afterEach(async () => {
    await ds.query(`DELETE FROM "schools" WHERE id = $1`, [tenantId]);
  });

  const columns = (table: string) =>
    ds.query(
      `SELECT is_nullable FROM information_schema.columns WHERE table_name = $1 AND column_name = 'choice_group'`,
      [table],
    );

  it('up adds both nullable columns', async () => {
    expect(await columns('class_subjects')).toEqual([{ is_nullable: 'YES' }]);
    expect(await columns('student_subject_choices')).toEqual([{ is_nullable: 'YES' }]);
  });

  it('class-subject CHECK rejects optional, group_name and blank groups', async () => {
    expect(await code(classSubject('G', { optional: true }))).toBe('23514');
    expect(await code(classSubject('G', { groupName: 'Science' }))).toBe('23514');
    expect(await code(classSubject('  '))).toBe('23514');
    expect(await code(classSubject('G'))).toBeNull();
  });

  it('a pick copies choice_group from its class subject', async () => {
    const [{ choice_group }] = await pick(await classSubject('Lang'));
    expect(choice_group).toBe('Lang');
    const [{ choice_group: none }] = await pick(await classSubject(null));
    expect(none).toBeNull();
  });

  it('second pick in the same group for the same student+year fails 23505', async () => {
    await pick(await classSubject('Lang'));
    expect(await code(pick(await classSubject('Lang')))).toBe('23505');
    // other student is fine
    const other = await student(tenantId, sectionId);
    expect(await code(pick(await classSubject('Lang'), false, other))).toBeNull();
  });

  it('is_fourth pick on a group member fails 23514', async () => {
    expect(await code(pick(await classSubject('Lang'), true))).toBe('23514');
  });

  it('renaming the group updates existing picks', async () => {
    const cs = await classSubject('Lang');
    await pick(cs);
    await ds.query(`UPDATE "class_subjects" SET choice_group = 'Language' WHERE id = $1`, [cs]);
    const rows = await ds.query(
      `SELECT choice_group FROM "student_subject_choices" WHERE class_subject_id = $1`,
      [cs],
    );
    expect(rows).toEqual([{ choice_group: 'Language' }]);
    await ds.query(`UPDATE "class_subjects" SET choice_group = NULL WHERE id = $1`, [cs]);
    const [{ choice_group }] = await ds.query(
      `SELECT choice_group FROM "student_subject_choices" WHERE class_subject_id = $1`,
      [cs],
    );
    expect(choice_group).toBeNull();
  });

  it('rename cascade raises 23514 on an existing is_fourth pick and 23505 when it merges groups', async () => {
    const fourth = await classSubject(null, { optional: true });
    await pick(fourth, true);
    // is_optional=true blocks the group via CHECK first; make it non-optional.
    await ds.query(`UPDATE "class_subjects" SET is_optional = false WHERE id = $1`, [fourth]);
    expect(
      await code(
        ds.query(`UPDATE "class_subjects" SET choice_group = 'X' WHERE id = $1`, [fourth]),
      ),
    ).toBe('23514');

    const a = await classSubject('A');
    const b = await classSubject('B');
    await pick(a);
    await pick(b);
    expect(
      await code(ds.query(`UPDATE "class_subjects" SET choice_group = 'A' WHERE id = $1`, [b])),
    ).toBe('23505');
  });

  it('an UPDATE cannot forge choice_group, and repointing a pick re-copies it', async () => {
    const cs = await classSubject('Lang');
    const [{ id }] = await pick(cs);
    const groupOf = async () =>
      (await ds.query(`SELECT choice_group FROM "student_subject_choices" WHERE id = $1`, [id]))[0]
        .choice_group;
    // Clearing it would dodge the one-per-group index; the trigger re-copies it.
    await ds.query(`UPDATE "student_subject_choices" SET choice_group = NULL WHERE id = $1`, [id]);
    expect(await groupOf()).toBe('Lang');
    await ds.query(`UPDATE "student_subject_choices" SET class_subject_id = $2 WHERE id = $1`, [
      id,
      await classSubject(null),
    ]);
    expect(await groupOf()).toBeNull();
  });

  it('rejects a pick whose tenant differs from its class subject', async () => {
    const cs = await classSubject('Lang');
    const other = await seedTenant();
    const otherStudent = await student(other.t, other.s);
    try {
      expect(await code(pick(cs, false, otherStudent, other.t, other.y))).toMatch(
        /tenant mismatch/,
      );
      // a non-group class subject is guarded too
      const plain = await classSubject(null);
      expect(await code(pick(plain, false, otherStudent, other.t, other.y))).toMatch(
        /tenant mismatch/,
      );
    } finally {
      await ds.query(`DELETE FROM "schools" WHERE id = $1`, [other.t]);
    }
  });

  it('existing rows keep NULL after up over populated tables', async () => {
    await migration.down(queryRunner);
    const cs = await classSubject(null).catch(async () => {
      // column is gone after down: insert without it
      const [{ id }] = await ds.query(
        `INSERT INTO "class_subjects" (id, tenant_id, class_id, subject_id, academic_year_id) VALUES (gen_random_uuid(), $1, $2, $3, $4) RETURNING id`,
        [tenantId, classId, await subject(tenantId), yearId],
      );
      return id as string;
    });
    await ds.query(
      `INSERT INTO "student_subject_choices" (tenant_id, student_id, class_subject_id, academic_year_id) VALUES ($1, $2, $3, $4)`,
      [tenantId, studentId, cs, yearId],
    );
    await migration.up(queryRunner);
    const [a] = await ds.query(`SELECT choice_group FROM "class_subjects" WHERE id = $1`, [cs]);
    const [b] = await ds.query(
      `SELECT choice_group FROM "student_subject_choices" WHERE class_subject_id = $1`,
      [cs],
    );
    expect(a.choice_group).toBeNull();
    expect(b.choice_group).toBeNull();
  });

  it('down removes everything; up restores', async () => {
    const names = async () => ({
      cols: [...(await columns('class_subjects')), ...(await columns('student_subject_choices'))]
        .length,
      cons: (
        await ds.query(
          `SELECT conname FROM pg_constraint WHERE conname IN ('CHK_class_subjects_choice_group_exclusive','CHK_student_subject_choices_group_not_fourth')`,
        )
      ).length,
      idx: (
        await ds.query(
          `SELECT 1 FROM pg_indexes WHERE indexname = 'IDX_student_subject_choices_one_per_choice_group'`,
        )
      ).length,
      trg: (
        await ds.query(
          `SELECT 1 FROM pg_trigger WHERE tgname IN ('trg_ssc_copy_choice_group','trg_cs_cascade_choice_group')`,
        )
      ).length,
      fn: (
        await ds.query(
          `SELECT 1 FROM pg_proc WHERE proname IN ('ssc_copy_choice_group','cs_cascade_choice_group')`,
        )
      ).length,
    });
    await migration.down(queryRunner);
    expect(await names()).toEqual({ cols: 0, cons: 0, idx: 0, trg: 0, fn: 0 });
    await migration.up(queryRunner);
    expect(await names()).toEqual({ cols: 2, cons: 2, idx: 1, trg: 2, fn: 2 });
  });
});

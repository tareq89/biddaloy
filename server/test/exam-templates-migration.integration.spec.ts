import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { DataSource, QueryRunner } from 'typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { School } from '../src/modules/schools/entities/school.entity';
import { AddExamTemplatesAndClassSubjectGroup1791000000000 } from '../src/migrations/1791000000000-AddExamTemplatesAndClassSubjectGroup';
import { SubjectChoiceGroups1791100000000 } from '../src/migrations/1791100000000-SubjectChoiceGroups';

/**
 * [35.1.3/#1266] Runs the exam-templates migration's `up`/`down` against the
 * test database (already migrated by `global-setup.ts`). `down()` then
 * `up()` run in one test so later specs still see the tables.
 */
describe('AddExamTemplatesAndClassSubjectGroup1791000000000 (integration)', () => {
  let dataSource: DataSource;
  let queryRunner: QueryRunner;
  let tenantId: string;
  const migration = new AddExamTemplatesAndClassSubjectGroup1791000000000();
  // [35.1.7] Depends on class_subjects.group_name (CHECK), so it must be reverted first.
  const later = new SubjectChoiceGroups1791100000000();

  beforeAll(async () => {
    const module = await createTestModule([School], []);
    dataSource = module.get(DataSource);
    queryRunner = dataSource.createQueryRunner();
  }, 60000);

  afterAll(async () => {
    await queryRunner.release();
    await dataSource.destroy();
  });

  beforeEach(async () => {
    const [{ id }] = await dataSource.query(
      `INSERT INTO "schools" (id, name, slug) VALUES (gen_random_uuid(), 'Exam Tpl Test School', 'exam-tpl-test-' || substr(gen_random_uuid()::text, 1, 8)) RETURNING id`,
    );
    tenantId = id;
  });

  afterEach(async () => {
    // FK ON DELETE CASCADE clears templates + components.
    await dataSource.query(`DELETE FROM "schools" WHERE id = $1`, [tenantId]);
  });

  async function tableNames(): Promise<string[]> {
    const rows: Array<{ table_name: string }> = await dataSource.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('exam_templates', 'exam_template_components')`,
    );
    return rows.map((r) => r.table_name).sort();
  }

  async function groupNameColumn(): Promise<
    Array<{ is_nullable: string; column_default: string | null }>
  > {
    return dataSource.query(
      `SELECT is_nullable, column_default FROM information_schema.columns WHERE table_name = 'class_subjects' AND column_name = 'group_name'`,
    );
  }

  async function insertTemplate(name: string): Promise<string> {
    const [{ id }] = await dataSource.query(
      `INSERT INTO "exam_templates" (tenant_id, name, kind) VALUES ($1, $2, 'TERM') RETURNING id`,
      [tenantId, name],
    );
    return id;
  }

  const insertComponent = (templateId: string, name: string, full: number, pass: number) =>
    dataSource.query(
      `INSERT INTO "exam_template_components" (tenant_id, template_id, class_grade, subject_code, sequence, name, kind, full_marks, pass_marks)
       VALUES ($1, $2, 6, 'MATH', 1, $3, 'WRITTEN', $4, $5)`,
      [tenantId, templateId, name, full, pass],
    );

  it('is up after global migrations: both tables exist, group_name is nullable with no default', async () => {
    expect(await tableNames()).toEqual(['exam_template_components', 'exam_templates']);
    expect(await groupNameColumn()).toEqual([{ is_nullable: 'YES', column_default: null }]);
  });

  it('down() removes tables + column but keeps the shared enums; up() restores', async () => {
    // Revert the later migration first, as `migration:revert` would: dropping
    // group_name silently drops its CHK_class_subjects_choice_group_exclusive,
    // leaving this worker's DB broken for later spec files.
    await later.down(queryRunner);
    await migration.down(queryRunner);
    expect(await tableNames()).toEqual([]);
    expect(await groupNameColumn()).toEqual([]);
    const enums: Array<{ typname: string }> = await dataSource.query(
      `SELECT typname FROM pg_type WHERE typname IN ('exams_kind_enum', 'exam_components_kind_enum')`,
    );
    expect(enums).toHaveLength(2);

    await migration.up(queryRunner);
    await later.up(queryRunner);
    expect(await tableNames()).toEqual(['exam_template_components', 'exam_templates']);
    expect(await groupNameColumn()).toHaveLength(1);
  });

  it('rejects a duplicate live template name per tenant but allows it after soft delete', async () => {
    const id = await insertTemplate('Annual');
    await expect(insertTemplate('Annual')).rejects.toThrow();
    await dataSource.query(`UPDATE "exam_templates" SET deleted_at = now() WHERE id = $1`, [id]);
    await expect(insertTemplate('Annual')).resolves.toBeDefined();
  });

  it('rejects a duplicate (template, class_grade, subject_code, name) component', async () => {
    const t = await insertTemplate('Dup');
    await insertComponent(t, 'Written', 100, 33);
    await expect(insertComponent(t, 'Written', 50, 20)).rejects.toThrow();
  });

  it('enforces the marks CHECK: pass > full, full <= 0, pass < 0 rejected; pass = full ok', async () => {
    const t = await insertTemplate('Check');
    await expect(insertComponent(t, 'a', 50, 60)).rejects.toThrow();
    await expect(insertComponent(t, 'b', 0, 0)).rejects.toThrow();
    await expect(insertComponent(t, 'c', 50, -1)).rejects.toThrow();
    await expect(insertComponent(t, 'd', 50, 50)).resolves.toBeDefined();
  });

  it('cascades component deletes from the template', async () => {
    const t = await insertTemplate('Cascade');
    await insertComponent(t, 'Written', 100, 33);
    await dataSource.query(`DELETE FROM "exam_templates" WHERE id = $1`, [t]);
    const [{ count }] = await dataSource.query(
      `SELECT count(*)::int FROM "exam_template_components" WHERE template_id = $1`,
      [t],
    );
    expect(count).toBe(0);
  });
});

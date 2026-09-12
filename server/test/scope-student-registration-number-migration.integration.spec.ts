import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { DataSource, QueryRunner } from 'typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { School } from '../src/modules/schools/entities/school.entity';
import { ScopeStudentRegistrationNumberToTenant1789600000000 } from '../src/migrations/1789600000000-ScopeStudentRegistrationNumberToTenant';

/**
 * [14.x/#700 follow-up] Runs the registration-number migration's `up`/`down`
 * directly against the test database (already migrated once by
 * `server/test/global-setup.ts`, which includes this migration).
 *
 * This is deliberately a migration-level test, not a `StudentService`
 * integration test: `students.service.integration.spec.ts` builds its
 * DataSource with `{ synchronize: true, dropSchema: true }`, which
 * generates the schema straight from entity decorators — `Student`'s own
 * `@Index(['tenant_id', 'registration_number'], { unique: true })` already
 * matches the *intended* schema, so that file's tests pass identically with
 * or without this migration and can never catch a real migration gap. Only
 * a DataSource that goes through the actual migration files (this file's
 * `createTestModule([School], [])`, `synchronize: false` by default)
 * exercises the schema real tenants actually run on.
 */
describe('ScopeStudentRegistrationNumberToTenant1789600000000 (integration)', () => {
  let dataSource: DataSource;
  let queryRunner: QueryRunner;
  const migration = new ScopeStudentRegistrationNumberToTenant1789600000000();

  beforeAll(async () => {
    const module = await createTestModule([School], []);
    dataSource = module.get(DataSource);
    queryRunner = dataSource.createQueryRunner();
  }, 60000);

  afterAll(async () => {
    await queryRunner.release();
  });

  afterEach(async () => {
    await dataSource.query(`DELETE FROM "students"`);
    await dataSource.query(`DELETE FROM "class_sections"`);
    await dataSource.query(`DELETE FROM "classes"`);
    await dataSource.query(`DELETE FROM "academic_years"`);
    await dataSource.query(`DELETE FROM "schools"`);
  });

  async function uniqueConstraints(): Promise<string[]> {
    const rows: Array<{ conname: string }> = await dataSource.query(
      `SELECT conname FROM pg_constraint WHERE conrelid = 'students'::regclass AND contype = 'u'`,
    );
    return rows.map((r) => r.conname).sort();
  }

  it('is up after global migrations run: the global constraint is gone, the tenant-scoped index exists', async () => {
    expect(await uniqueConstraints()).not.toContain('UQ_82946fdb5652b83cacb81e9083e');

    const indexes: Array<{ indexdef: string }> = await dataSource.query(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'students' AND indexname = 'IDX_students_tenant_id_registration_number'`,
    );
    expect(indexes).toHaveLength(1);
    expect(indexes[0].indexdef).toContain('UNIQUE');
    expect(indexes[0].indexdef).toContain('tenant_id');
    expect(indexes[0].indexdef).toContain('registration_number');
  });

  it('down() restores the global constraint, up() re-scopes it to tenant', async () => {
    await migration.down(queryRunner);
    expect(await uniqueConstraints()).toContain('UQ_82946fdb5652b83cacb81e9083e');

    await migration.up(queryRunner);
    expect(await uniqueConstraints()).not.toContain('UQ_82946fdb5652b83cacb81e9083e');
  });

  /** Minimal fixtures for the constraint test below — a school, one
   * academic year, one class, one section, reused by both tenants. */
  async function seedTenant(): Promise<{
    tenantId: string;
    academicYearId: string;
    classId: string;
    sectionId: string;
  }> {
    const [{ id: tenantId }] = await dataSource.query(
      `INSERT INTO "schools" (id, name, slug)
       VALUES (gen_random_uuid(), 'Reg Number Test School', 'reg-number-test-' || substr(gen_random_uuid()::text, 1, 8))
       RETURNING id`,
    );
    const [{ id: academicYearId }] = await dataSource.query(
      `INSERT INTO "academic_years" (id, tenant_id, name, start_date, end_date, is_current)
       VALUES (gen_random_uuid(), $1, '2026-2027', '2026-01-01', '2026-12-31', true)
       RETURNING id`,
      [tenantId],
    );
    const [{ id: classId }] = await dataSource.query(
      `INSERT INTO "classes" (id, tenant_id, name, academic_year_id)
       VALUES (gen_random_uuid(), $1, 'Class One', $2)
       RETURNING id`,
      [tenantId, academicYearId],
    );
    const [{ id: sectionId }] = await dataSource.query(
      `INSERT INTO "class_sections" (id, tenant_id, class_id, section_name)
       VALUES (gen_random_uuid(), $1, $2, 'A')
       RETURNING id`,
      [tenantId, classId],
    );
    return { tenantId, academicYearId, classId, sectionId };
  }

  it('lets two different tenants each insert the same registration_number', async () => {
    const tenantA = await seedTenant();
    const tenantB = await seedTenant();

    // Both tenants' "first student of the year" legitimately computes the
    // identical REG-2026-0001 (see StudentService.create) — this must
    // succeed for both, which is exactly what the removed global
    // constraint used to reject on the second insert.
    await dataSource.query(
      `INSERT INTO "students" (id, tenant_id, full_name, registration_number, roll_number, class_section_id)
       VALUES (gen_random_uuid(), $1, 'Student A', 'REG-2026-0001', 1, $2)`,
      [tenantA.tenantId, tenantA.sectionId],
    );

    await expect(
      dataSource.query(
        `INSERT INTO "students" (id, tenant_id, full_name, registration_number, roll_number, class_section_id)
         VALUES (gen_random_uuid(), $1, 'Student B', 'REG-2026-0001', 1, $2)`,
        [tenantB.tenantId, tenantB.sectionId],
      ),
    ).resolves.not.toThrow();
  });

  it('still rejects a duplicate registration_number within the same tenant', async () => {
    const tenant = await seedTenant();

    await dataSource.query(
      `INSERT INTO "students" (id, tenant_id, full_name, registration_number, roll_number, class_section_id)
       VALUES (gen_random_uuid(), $1, 'Student A', 'REG-2026-0001', 1, $2)`,
      [tenant.tenantId, tenant.sectionId],
    );

    await expect(
      dataSource.query(
        `INSERT INTO "students" (id, tenant_id, full_name, registration_number, roll_number, class_section_id)
         VALUES (gen_random_uuid(), $1, 'Student B', 'REG-2026-0001', 2, $2)`,
        [tenant.tenantId, tenant.sectionId],
      ),
    ).rejects.toThrow();
  });
});

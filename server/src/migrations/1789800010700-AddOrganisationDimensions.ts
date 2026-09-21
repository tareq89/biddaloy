import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [33.2.1] Adds the tenant-defined shift/version dimension to `classes`
 * and group to `class_sections` (vocabulary lives in
 * `TenantSettings.organisation`, written on the service side, [33.1.1]).
 *
 * `classes` uniqueness must widen to include shift/version — two classes
 * both named "Class 6" in the same year are legitimately distinct once
 * one is "Morning" and the other "Day". Postgres treats `NULL`s as
 * distinct by default, so a plain `UNIQUE(name, academic_year_id,
 * tenant_id, shift, version)` would let two `NULL`-shift "Class 6" rows
 * coexist — silently weakening today's guarantee for every tenant that
 * doesn't use shifts. `NULLS NOT DISTINCT` (PG15+, CI runs PG16,
 * `.github/workflows/ci.yml`) closes that gap without a `COALESCE`
 * expression index. TypeORM's `@Index` decorator cannot express `NULLS
 * NOT DISTINCT`, so this migration (not the entity decorator) is the
 * source of truth for the index — `class.entity.ts` documents this but
 * does not declare it, to avoid drifting from the real DB schema.
 *
 * `class_sections`' own unique index (`class_id`, `section_name`, partial
 * on `deleted_at IS NULL`) is untouched — group does not change what
 * makes a section name unique within a class.
 */
export class AddOrganisationDimensions1789800010700 implements MigrationInterface {
  name = 'AddOrganisationDimensions1789800010700';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "classes" ADD "shift" character varying(50)`);
    await queryRunner.query(`ALTER TABLE "classes" ADD "version" character varying(50)`);
    await queryRunner.query(`ALTER TABLE "class_sections" ADD "group_name" character varying(50)`);

    await queryRunner.query(`DROP INDEX "public"."IDX_cl_name_year_tenant"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_cl_name_year_tenant_shift_version" ON "classes" ("name", "academic_year_id", "tenant_id", "shift", "version") NULLS NOT DISTINCT`,
    );
  }

  /**
   * Rollback must first reconcile rows the wider `NULLS NOT DISTINCT`
   * index allowed but the original `(name, academic_year_id, tenant_id)`
   * index would not — two classes with the same name/year/tenant but
   * different shift/version (or both `NULL`). There is no natural
   * renumbering axis here (unlike `occurrence` in
   * `StudentFeesPartialUniqueIndex1789800007000`), so `down()` refuses to
   * guess which row should win: it raises if any collision exists,
   * leaving the operator to resolve it (rename/merge/soft-delete) before
   * retrying the rollback, rather than silently dropping shift/version
   * distinctions.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    const [{ count }] = await queryRunner.query(`
      SELECT COUNT(*) AS count FROM (
        SELECT "name", "academic_year_id", "tenant_id"
        FROM "classes"
        GROUP BY "name", "academic_year_id", "tenant_id"
        HAVING COUNT(*) > 1
      ) collisions
    `);
    if (Number(count) > 0) {
      throw new Error(
        `AddOrganisationDimensions1789800010700.down(): ${count} (name, academic_year_id, ` +
          `tenant_id) group(s) have more than one row once shift/version stop distinguishing ` +
          `them. Resolve the collisions (rename, merge, or soft-delete) before rolling back.`,
      );
    }

    await queryRunner.query(`DROP INDEX "public"."IDX_cl_name_year_tenant_shift_version"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_cl_name_year_tenant" ON "classes" ("name", "academic_year_id", "tenant_id")`,
    );

    await queryRunner.query(`ALTER TABLE "class_sections" DROP COLUMN "group_name"`);
    await queryRunner.query(`ALTER TABLE "classes" DROP COLUMN "version"`);
    await queryRunner.query(`ALTER TABLE "classes" DROP COLUMN "shift"`);
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [2885] A soft-deleted class must not keep its name. `IDX_cl_name_year_tenant_shift_version`
 * (see `1791900000400-CaseInsensitiveAcademicNames.ts`) had no `deleted_at` predicate, so a new
 * class could not reuse a deleted class's name in the same year, shift and version. This adds
 * `WHERE deleted_at IS NULL`. The index name is unchanged, so the unique-violation mapping in
 * `known-errors.ts` still applies. No table or column changes; demo seed is unaffected.
 *
 * `up()` cannot fail: a live-only unique index is looser than the old one.
 * `down()` restores the unconditional index, so it refuses (changing nothing) while a deleted
 * class and another class share a name; it names the table, the group count and school ids,
 * never a name.
 */
const NAME = 'IDX_cl_name_year_tenant_shift_version';
const COLS = `(lower("name"), "academic_year_id", "tenant_id", "shift", "version") NULLS NOT DISTINCT`;

export class ClassNameUniqueLiveOnly1791900000500 implements MigrationInterface {
  name = 'ClassNameUniqueLiveOnly1791900000500';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."${NAME}"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "${NAME}" ON "classes" ${COLS} WHERE "deleted_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const rows: { tenant_id: string }[] = await queryRunner.query(
      `SELECT tenant_id FROM classes GROUP BY tenant_id, academic_year_id, shift, version, lower(name) HAVING count(*) > 1`,
    );
    if (rows.length > 0) {
      const tenants = [...new Set(rows.map((r) => r.tenant_id))].join(', ');
      throw new Error(
        `Cannot restore the unconditional class name index: ${rows.length} group(s) of classes in table classes share a name once deleted classes are counted (school ids: ${tenants}). Rename them by hand, then rerun.`,
      );
    }
    await queryRunner.query(`DROP INDEX "public"."${NAME}"`);
    await queryRunner.query(`CREATE UNIQUE INDEX "${NAME}" ON "classes" ${COLS}`);
  }
}

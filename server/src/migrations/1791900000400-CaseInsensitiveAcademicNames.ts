import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [2657, D35/D36] Names that differ only by letter case are the same name, inside one school:
 *
 * - academic years: `IDX_ay_name_tenant`, per school, live rows only;
 * - classes: `IDX_cl_name_year_tenant_shift_version`, per year, shift and version (NULLS NOT DISTINCT);
 * - sections: `IDX_cs_name_class`, per class, live rows only.
 *
 * Each index keeps its name and predicate; only the name column becomes `lower("...")`. The
 * existing unique-violation mapping (`known-errors.ts`) is keyed by index name, so it needs no edit.
 * `lower` leaves Bengali script unchanged, so Bangla names behave exactly as before.
 *
 * This migration never renames a row. If a school already holds a case-only duplicate, `up()`
 * stops before changing anything, naming the table, the number of clashing groups and the school
 * ids (never a name). Run these read-only audits on every environment before deploy, rename the
 * rows by hand, then deploy:
 *
 *   SELECT tenant_id, lower(name), count(*) FROM academic_years
 *    WHERE deleted_at IS NULL GROUP BY tenant_id, lower(name) HAVING count(*) > 1;
 *   SELECT tenant_id, academic_year_id, shift, version, lower(name), count(*) FROM classes
 *    GROUP BY tenant_id, academic_year_id, shift, version, lower(name) HAVING count(*) > 1;
 *   SELECT tenant_id, class_id, lower(section_name), count(*) FROM class_sections
 *    WHERE deleted_at IS NULL GROUP BY tenant_id, class_id, lower(section_name) HAVING count(*) > 1;
 *
 * Out of scope, both unchanged: the old unconditional `IDX_63d2faa7e6351f234ede380634` on
 * `class_sections`, and the class index having no `deleted_at` predicate. A soft-deleted class
 * or section name still cannot be reused.
 *
 * `down()` restores the exact-case indexes. Case-insensitive unique implies exact-case unique,
 * so it always succeeds, also on an empty database.
 */
const INDEXES = [
  {
    table: 'academic_years',
    name: 'IDX_ay_name_tenant',
    up: `CREATE UNIQUE INDEX "IDX_ay_name_tenant" ON "academic_years" (lower("name"), "tenant_id") WHERE "deleted_at" IS NULL`,
    down: `CREATE UNIQUE INDEX "IDX_ay_name_tenant" ON "academic_years" ("name", "tenant_id") WHERE "deleted_at" IS NULL`,
    audit: `SELECT tenant_id FROM academic_years WHERE deleted_at IS NULL GROUP BY tenant_id, lower(name) HAVING count(*) > 1`,
  },
  {
    table: 'classes',
    name: 'IDX_cl_name_year_tenant_shift_version',
    up: `CREATE UNIQUE INDEX "IDX_cl_name_year_tenant_shift_version" ON "classes" (lower("name"), "academic_year_id", "tenant_id", "shift", "version") NULLS NOT DISTINCT`,
    down: `CREATE UNIQUE INDEX "IDX_cl_name_year_tenant_shift_version" ON "classes" ("name", "academic_year_id", "tenant_id", "shift", "version") NULLS NOT DISTINCT`,
    audit: `SELECT tenant_id FROM classes GROUP BY tenant_id, academic_year_id, shift, version, lower(name) HAVING count(*) > 1`,
  },
  {
    table: 'class_sections',
    name: 'IDX_cs_name_class',
    up: `CREATE UNIQUE INDEX "IDX_cs_name_class" ON "class_sections" ("class_id", lower("section_name")) WHERE "deleted_at" IS NULL`,
    down: `CREATE UNIQUE INDEX "IDX_cs_name_class" ON "class_sections" ("class_id", "section_name") WHERE "deleted_at" IS NULL`,
    audit: `SELECT tenant_id FROM class_sections WHERE deleted_at IS NULL GROUP BY tenant_id, class_id, lower(section_name) HAVING count(*) > 1`,
  },
];

export class CaseInsensitiveAcademicNames1791900000400 implements MigrationInterface {
  name = 'CaseInsensitiveAcademicNames1791900000400';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Refuse first: nothing changes while a case-only duplicate exists.
    for (const i of INDEXES) {
      const rows: { tenant_id: string }[] = await queryRunner.query(i.audit);
      if (rows.length > 0) {
        const tenants = [...new Set(rows.map((r) => r.tenant_id))].join(', ');
        throw new Error(
          `Cannot make ${i.table} names case-insensitive: ${rows.length} group(s) of names differ only by case (school ids: ${tenants}). Rename them by hand, then rerun.`,
        );
      }
    }
    for (const i of INDEXES) {
      await queryRunner.query(`DROP INDEX "public"."${i.name}"`);
      await queryRunner.query(i.up);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const i of INDEXES) {
      await queryRunner.query(`DROP INDEX "public"."${i.name}"`);
      await queryRunner.query(i.down);
    }
  }
}

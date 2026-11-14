import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [#2343] Two drift fixes the schema-drift guard had pinned:
 *  - drop the old unconditional UNIQUE (class_id, section_name) on `class_sections`: it
 *    ignored soft delete, so a deleted section's name could never be reused. The
 *    soft-delete-aware, case-insensitive unique index `IDX_cs_name_class` stays.
 *  - create the four tenant/class indexes the entities declare (names are TypeORM's own hashes,
 *    so the guard sees no drift). Performance only; `IF NOT EXISTS` makes a re-run safe.
 */
export class SchemaDriftIndexes1792300000000 implements MigrationInterface {
  name = 'SchemaDriftIndexes1792300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_63d2faa7e6351f234ede380634"`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_9109b53fca5cef7720aca72974" ON "payments" ("tenant_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_e25a5bebd3d7ca85860cf9ede3" ON "fee_structures" ("tenant_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_59eaaec324d70a1e337f31db40" ON "class_sections" ("class_id", "tenant_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_8b2981d62fb0165dc2719af0f0" ON "teachers" ("tenant_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const name of [
      'IDX_8b2981d62fb0165dc2719af0f0',
      'IDX_59eaaec324d70a1e337f31db40',
      'IDX_e25a5bebd3d7ca85860cf9ede3',
      'IDX_9109b53fca5cef7720aca72974',
    ]) {
      await queryRunner.query(`DROP INDEX IF EXISTS "public"."${name}"`);
    }
    // Restoring the unconditional unique can fail if a deleted section shares a name with a live
    // one; that is the bug being removed, so the down is allowed to fail loudly.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_63d2faa7e6351f234ede380634" ON "class_sections" ("class_id", "section_name")`,
    );
  }
}

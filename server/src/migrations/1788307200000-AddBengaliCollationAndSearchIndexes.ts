import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [8.14.9] Bengali-aware name sorting and search-support indexes.
 *
 * Postgres's default `en_US.utf8` (libc) collation sorts Bengali script in
 * raw codepoint order, which is not Bengali dictionary order — e.g. a name
 * spelled with the precomposed ড় (U+09DC) sorts far away from the
 * canonically-equivalent decomposed ড + nukta (U+09A1 U+09BC) spelling.
 * `bn_icu` (ICU locale `bn-u-co-standard`) fixes that. It is applied only at
 * `ORDER BY ... COLLATE "bn_icu"` sites (see `server/src/common/constants/
 * collation.ts`), never as a column's default collation — changing a
 * column's default collation would rewrite every dependent index/constraint
 * and change equality semantics, which is out of scope here.
 *
 * This migration hard-fails if the target Postgres was built without ICU
 * support (no `CREATE COLLATION ... provider = icu`). That is intentional:
 * the feature cannot work without it. Verified present on `postgres:16-alpine`,
 * which is what dev, CI integration, CI e2e, and nightly e2e all run. Before
 * deploying to any other Postgres provider, confirm with:
 * `SELECT count(*) FROM pg_collation WHERE collname = 'und-x-icu';` (must be >= 1).
 *
 * `pg_trgm`/GIN indexes for the ILIKE search columns are deliberately
 * deferred — enabling an extension is a separate infra decision, and the
 * per-tenant list volumes here are small enough that plain btree (for the
 * collated/exact columns below) is sufficient for now.
 */
export class AddBengaliCollationAndSearchIndexes1788307200000 implements MigrationInterface {
  name = 'AddBengaliCollationAndSearchIndexes1788307200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE COLLATION IF NOT EXISTS "bn_icu" (provider = icu, locale = 'bn-u-co-standard')`,
    );

    // Collated name indexes, tenant-leading so they are usable by the
    // tenant-scoped queries that will sort by them.
    await queryRunner.query(
      `CREATE INDEX "IDX_students_tenant_name_bn" ON "students" ("tenant_id", "full_name" COLLATE "bn_icu")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_guardians_tenant_name_bn" ON "guardians" ("tenant_id", "full_name" COLLATE "bn_icu")`,
    );
    // Users are not tenant-scoped on their own row — tenancy comes through
    // `user_tenants` — so this index is not tenant-leading.
    await queryRunner.query(
      `CREATE INDEX "IDX_users_name_bn" ON "users" ("full_name" COLLATE "bn_icu")`,
    );

    // Plain btree support for newly searchable exact-ish columns.
    await queryRunner.query(
      `CREATE INDEX "IDX_students_tenant_registration_number" ON "students" ("tenant_id", "registration_number")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_reminder_batches_tenant_created" ON "reminder_batches" ("tenant_id", "created_at" DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_reminder_batches_tenant_created"`);
    await queryRunner.query(`DROP INDEX "IDX_students_tenant_registration_number"`);
    await queryRunner.query(`DROP INDEX "IDX_users_name_bn"`);
    await queryRunner.query(`DROP INDEX "IDX_guardians_tenant_name_bn"`);
    await queryRunner.query(`DROP INDEX "IDX_students_tenant_name_bn"`);
    await queryRunner.query(`DROP COLLATION IF EXISTS "bn_icu"`);
  }
}

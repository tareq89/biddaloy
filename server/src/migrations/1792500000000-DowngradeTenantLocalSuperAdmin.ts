import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [#1313] Legacy tenant-local `SUPER_ADMIN` memberships.
 *
 * Platform authority lives in `platform_admins` (Epic 98), but a `user_tenants` row with role
 * `SUPER_ADMIN` on an ordinary school still passes every role check inside that school
 * (`RolesGuard`). Those rows were minted before `UserService.create` refused the role.
 *
 * Conservative on purpose:
 * - Only schools that are NOT the platform school (`schools.is_platform = false`). When no
 *   platform school exists yet the platform cannot be told apart, so nothing is touched.
 * - The person most likely runs that school, so the row becomes `ADMIN`. When they already hold
 *   an `ADMIN` row there (live or soft-deleted, the unique key is user+school+role), the
 *   `SUPER_ADMIN` row is soft-deleted instead.
 * - Every change leaves one `audit_logs` row (event `LEGACY_SUPER_ADMIN_DOWNGRADE`) with the old
 *   role, so `down()` can put the rows back and an operator can see who was changed.
 */
const EVENT = 'LEGACY_SUPER_ADMIN_DOWNGRADE';

export class DowngradeTenantLocalSuperAdmin1792500000000 implements MigrationInterface {
  name = 'DowngradeTenantLocalSuperAdmin1792500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const [{ count }] = await queryRunner.query(
      `SELECT COUNT(*)::int AS count FROM "schools" WHERE "is_platform" = true`,
    );
    if (count === 0) return;

    // A downgraded person's access token still carries `SUPER_ADMIN` in its memberships claim.
    // Cut those tokens off (Rule 8); the cutoff is a JS Date, like SessionCutoffService.
    const now = new Date();

    // 1. Already an ADMIN of that school: drop the SUPER_ADMIN row, keep the ADMIN one.
    await queryRunner.query(
      `WITH gone AS (
         UPDATE "user_tenants" ut SET "deleted_at" = now()
          FROM "schools" s
         WHERE s."id" = ut."tenant_id" AND s."is_platform" = false
           AND ut."role" = 'SUPER_ADMIN' AND ut."deleted_at" IS NULL
           AND EXISTS (SELECT 1 FROM "user_tenants" a
                        WHERE a."user_id" = ut."user_id" AND a."tenant_id" = ut."tenant_id"
                          AND a."role" = 'ADMIN')
         RETURNING ut."id", ut."user_id", ut."tenant_id"
       ),
       bump AS (
         UPDATE "users" SET "tokens_valid_after" = GREATEST(COALESCE("tokens_valid_after", $1), $1)
          WHERE "id" IN (SELECT "user_id" FROM gone)
       )
       INSERT INTO "audit_logs" ("tenant_id", "action", "entity_type", "entity_id", "old_values", "new_values")
       SELECT g."tenant_id", 'DELETE', 'User', g."user_id",
              jsonb_build_object('user_tenant_id', g."id", 'role', 'SUPER_ADMIN'),
              jsonb_build_object('event', '${EVENT}', 'outcome', 'removed')
         FROM gone g`,
      [now],
    );

    // 2. Everyone else becomes ADMIN of their own school.
    await queryRunner.query(
      `WITH moved AS (
         UPDATE "user_tenants" ut SET "role" = 'ADMIN'
          FROM "schools" s
         WHERE s."id" = ut."tenant_id" AND s."is_platform" = false
           AND ut."role" = 'SUPER_ADMIN' AND ut."deleted_at" IS NULL
         RETURNING ut."id", ut."user_id", ut."tenant_id"
       ),
       bump AS (
         UPDATE "users" SET "tokens_valid_after" = GREATEST(COALESCE("tokens_valid_after", $1), $1)
          WHERE "id" IN (SELECT "user_id" FROM moved)
       )
       INSERT INTO "audit_logs" ("tenant_id", "action", "entity_type", "entity_id", "old_values", "new_values")
       SELECT m."tenant_id", 'UPDATE', 'User', m."user_id",
              jsonb_build_object('user_tenant_id', m."id", 'role', 'SUPER_ADMIN'),
              jsonb_build_object('event', '${EVENT}', 'outcome', 'downgraded', 'role', 'ADMIN')
         FROM moved m`,
      [now],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Put back every row this migration changed, from its audit trail. An audit row already
    // reverted by an earlier down() is skipped (`source_audit_id`), so a row an operator revoked
    // after that is not restored again by a later up/down cycle.
    await queryRunner.query(
      `UPDATE "user_tenants" ut SET "role" = 'SUPER_ADMIN'
        FROM "audit_logs" a
       WHERE a."new_values"->>'event' = '${EVENT}' AND a."new_values"->>'outcome' = 'downgraded'
         AND ut."id" = (a."old_values"->>'user_tenant_id')::uuid
         AND NOT EXISTS (SELECT 1 FROM "audit_logs" r
                          WHERE r."new_values"->>'event' = '${EVENT}_REVERTED'
                            AND r."new_values"->>'source_audit_id' = a."id"::text)`,
    );
    await queryRunner.query(
      `UPDATE "user_tenants" ut SET "deleted_at" = NULL
        FROM "audit_logs" a
       WHERE a."new_values"->>'event' = '${EVENT}' AND a."new_values"->>'outcome' = 'removed'
         AND ut."id" = (a."old_values"->>'user_tenant_id')::uuid
         AND NOT EXISTS (SELECT 1 FROM "audit_logs" r
                          WHERE r."new_values"->>'event' = '${EVENT}_REVERTED'
                            AND r."new_values"->>'source_audit_id' = a."id"::text)`,
    );
    // `audit_logs` is write-only: the trail of the downgrade stays, and the restore is recorded.
    await queryRunner.query(
      `INSERT INTO "audit_logs" ("tenant_id", "action", "entity_type", "entity_id", "old_values", "new_values")
       SELECT a."tenant_id", 'UPDATE', 'User', a."entity_id", a."new_values",
              jsonb_build_object('event', '${EVENT}_REVERTED', 'user_tenant_id', a."old_values"->'user_tenant_id',
                                 'source_audit_id', a."id")
         FROM "audit_logs" a
        WHERE a."new_values"->>'event' = '${EVENT}'
          AND NOT EXISTS (SELECT 1 FROM "audit_logs" r
                           WHERE r."new_values"->>'event' = '${EVENT}_REVERTED'
                             AND r."new_values"->>'source_audit_id' = a."id"::text)`,
    );
  }
}

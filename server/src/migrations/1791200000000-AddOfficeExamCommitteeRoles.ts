import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [24.2.2]/#1359 — `UserRole` gains OFFICE_STAFF, EXAM_CONTROLLER and
 * COMMITTEE. `user_tenants.role` is the only column that stores a role
 * (`users_role_enum` was dropped in MultiTenantAuth), so only this type grows.
 */
export class AddOfficeExamCommitteeRoles1791200000000 implements MigrationInterface {
  name = 'AddOfficeExamCommitteeRoles1791200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const role of ['OFFICE_STAFF', 'EXAM_CONTROLLER', 'COMMITTEE']) {
      await queryRunner.query(
        `ALTER TYPE "public"."user_tenants_role_enum" ADD VALUE IF NOT EXISTS '${role}'`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Postgres has no `ALTER TYPE ... DROP VALUE` — recreate the type without
    // the added values. Fails loudly (by design) if any user_tenants row
    // already holds one of them: rolling back into data the old type can't
    // represent should error, not silently drop rows.
    await queryRunner.query(
      `ALTER TYPE "public"."user_tenants_role_enum" RENAME TO "user_tenants_role_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."user_tenants_role_enum" AS ENUM('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'TEACHER', 'PARENT', 'STUDENT', 'EXECUTIVE')`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_tenants" ALTER COLUMN "role" TYPE "public"."user_tenants_role_enum" USING "role"::text::"public"."user_tenants_role_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."user_tenants_role_enum_old"`);
  }
}

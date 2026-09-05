import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAdminPasswordReset1789000000000 implements MigrationInterface {
  name = 'AddAdminPasswordReset1789000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "credential_version" integer NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE "users" ADD "password_change_required" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "users" ADD "temporary_password_expires_at" TIMESTAMPTZ`);
    await queryRunner.query(`ALTER TABLE "users" ADD "temporary_password_tenant_id" uuid`);
    await queryRunner.query(`ALTER TABLE "refresh_tokens" ADD "credential_version" integer NOT NULL DEFAULT 0`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const pending = await queryRunner.query(`SELECT 1 FROM "users" WHERE "password_change_required" = true LIMIT 1`);
    if (pending.length > 0) {
      throw new Error('Cannot roll back admin password reset while pending temporary credentials exist');
    }
    await queryRunner.query(`ALTER TABLE "refresh_tokens" DROP COLUMN "credential_version"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "temporary_password_tenant_id"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "temporary_password_expires_at"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "password_change_required"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "credential_version"`);
  }
}

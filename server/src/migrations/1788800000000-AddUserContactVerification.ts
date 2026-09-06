import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [12.7] `email_verified_at` / `phone_verified_at` on `users`. No backfill:
 * every existing contact starts unverified, which is the truth — nothing in
 * the system before this ticket ever confirmed possession of an email or
 * phone number. Nullable, no default — `NULL` means "not verified", a
 * timestamp means "verified at this moment".
 */
export class AddUserContactVerification1788800000000 implements MigrationInterface {
  name = 'AddUserContactVerification1788800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "email_verified_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "users" ADD "phone_verified_at" TIMESTAMP WITH TIME ZONE`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "phone_verified_at"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "email_verified_at"`);
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [13.1.2]/#1613 — columns and table the user-onboarding epic needs.
 * Schools that exist today have finished onboarding (D36); `seat_limit` and
 * `trial_ends_at` stay NULL (= unlimited, no trial).
 */
export class OnboardingFoundation1791400000000 implements MigrationInterface {
  name = 'OnboardingFoundation1791400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "schools" ADD "country_code" character varying(2)`);
    await queryRunner.query(`ALTER TABLE "schools" ADD "trial_ends_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(
      `ALTER TABLE "schools" ADD "seat_limit" integer CONSTRAINT "CHK_schools_seat_limit" CHECK ("seat_limit" >= 0)`,
    );
    await queryRunner.query(`ALTER TABLE "schools" ADD "onboarding" jsonb`);
    await queryRunner.query(
      `UPDATE "schools" SET "onboarding" = jsonb_build_object('finished_at', now())`,
    );
    await queryRunner.query(`ALTER TABLE "user_tenants" ADD "deleted_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(
      `CREATE TABLE "user_identities" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "provider" character varying(20) NOT NULL,
        "subject" character varying(255) NOT NULL,
        "email" character varying(255),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_identities" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_user_identities_provider_subject" UNIQUE ("provider", "subject"),
        CONSTRAINT "UQ_user_identities_user_provider" UNIQUE ("user_id", "provider"),
        CONSTRAINT "FK_user_identities_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "user_identities"`);
    await queryRunner.query(`ALTER TABLE "user_tenants" DROP COLUMN "deleted_at"`);
    await queryRunner.query(`ALTER TABLE "schools" DROP COLUMN "onboarding"`);
    await queryRunner.query(`ALTER TABLE "schools" DROP CONSTRAINT "CHK_schools_seat_limit"`);
    await queryRunner.query(`ALTER TABLE "schools" DROP COLUMN "seat_limit"`);
    await queryRunner.query(`ALTER TABLE "schools" DROP COLUMN "trial_ends_at"`);
    await queryRunner.query(`ALTER TABLE "schools" DROP COLUMN "country_code"`);
  }
}

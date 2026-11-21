import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [59.1.02] Legal acceptances + photo consent.
 * - `legal_acceptances`: one row per (user, school, document, version) a person accepted.
 * - `students.photo_consent*`: existing students read UNKNOWN (D25).
 * - `admission_applicants.photo_consent`: NULL = applied before this change.
 */
export class LegalAndPhotoConsent1792500000001 implements MigrationInterface {
  name = 'LegalAndPhotoConsent1792500000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."photo_consent_enum" AS ENUM('GIVEN', 'REFUSED', 'UNKNOWN')`,
    );
    await queryRunner.query(
      `ALTER TABLE "students" ADD "photo_consent" "public"."photo_consent_enum" NOT NULL DEFAULT 'UNKNOWN'`,
    );
    await queryRunner.query(`ALTER TABLE "students" ADD "photo_consent_recorded_at" TIMESTAMPTZ`);
    await queryRunner.query(`ALTER TABLE "students" ADD "photo_consent_recorded_by" uuid`);
    await queryRunner.query(
      `ALTER TABLE "students" ADD CONSTRAINT "FK_238aea63cedf1ad98a1441c156a" FOREIGN KEY ("photo_consent_recorded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "admission_applicants" ADD "photo_consent" "public"."photo_consent_enum"`,
    );
    await queryRunner.query(
      `CREATE TABLE "legal_acceptances" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "document" character varying(16) NOT NULL,
        "version" character varying(16) NOT NULL,
        "accepted_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "ip" character varying(64),
        CONSTRAINT "PK_legal_acceptances" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_legal_acceptances_document" CHECK ("document" IN ('terms', 'privacy', 'dpa', 'sla')),
        CONSTRAINT "UQ_legal_acceptances_user_tenant_doc_version" UNIQUE ("user_id", "tenant_id", "document", "version"),
        CONSTRAINT "FK_21c966a3647e5cd30e0582fe8b8" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_ba24e5ee75f613af8f4a25f19a1" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_14d90279f37452e472a7182c89" ON "legal_acceptances" ("user_id", "tenant_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_14d90279f37452e472a7182c89"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "legal_acceptances"`);
    await queryRunner.query(`ALTER TABLE "admission_applicants" DROP COLUMN "photo_consent"`);
    await queryRunner.query(
      `ALTER TABLE "students" DROP CONSTRAINT "FK_238aea63cedf1ad98a1441c156a"`,
    );
    await queryRunner.query(`ALTER TABLE "students" DROP COLUMN "photo_consent_recorded_by"`);
    await queryRunner.query(`ALTER TABLE "students" DROP COLUMN "photo_consent_recorded_at"`);
    await queryRunner.query(`ALTER TABLE "students" DROP COLUMN "photo_consent"`);
    await queryRunner.query(`DROP TYPE "public"."photo_consent_enum"`);
  }
}

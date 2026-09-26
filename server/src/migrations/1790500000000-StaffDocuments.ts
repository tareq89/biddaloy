import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [23.6] `staff_documents` — one uploaded identity/HR document (NID, birth
 * certificate, photo, other) per staff member. Keyed by
 * `(tenant_id, staff_user_id)`, not a FK to `staff_hr_records` (D1) — a
 * staff member can have documents on file before an HR record exists.
 */
export class StaffDocuments1790500000000 implements MigrationInterface {
  name = 'StaffDocuments1790500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."staff_documents_document_type_enum" AS ENUM('NID', 'BIRTH_CERTIFICATE', 'PHOTO', 'OTHER')`,
    );
    await queryRunner.query(`
      CREATE TABLE "staff_documents" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "staff_user_id" uuid NOT NULL,
        "document_type" "public"."staff_documents_document_type_enum" NOT NULL,
        "storage_key" varchar(500) NOT NULL,
        "original_filename" varchar(255) NOT NULL,
        "content_type" varchar(100) NOT NULL,
        "uploaded_by_user_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_staff_documents" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_staff_documents_tenant" ON "staff_documents" ("tenant_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_staff_documents_tenant_staff_type" ON "staff_documents" ("tenant_id", "staff_user_id", "document_type")`,
    );
    await queryRunner.query(
      `ALTER TABLE "staff_documents" ADD CONSTRAINT "FK_staff_documents_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "staff_documents" ADD CONSTRAINT "FK_staff_documents_staff_user" FOREIGN KEY ("staff_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "staff_documents" ADD CONSTRAINT "FK_staff_documents_uploaded_by" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "staff_documents"`);
    await queryRunner.query(`DROP TYPE "public"."staff_documents_document_type_enum"`);
  }
}

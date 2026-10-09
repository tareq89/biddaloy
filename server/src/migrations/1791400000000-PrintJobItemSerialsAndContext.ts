import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [48.1.2] `print_job_items` serial number, serial year and exam context
 * (Epic 48 D7, D8, D24, D33, D41).
 *
 * The copy key splits in two partial unique indexes:
 *  - serial_no IS NULL     -> per (tenant, subject, kind, context, copy)
 *  - serial_no IS NOT NULL -> per (tenant, kind, serial_year, serial_no, copy)
 * Existing rows all have serial_no NULL and no context, so they keep exactly
 * today's uniqueness. `revoke_reason` already exists (1790700000000-PrintModule).
 */
export class PrintJobItemSerialsAndContext1791400000000 implements MigrationInterface {
  name = 'PrintJobItemSerialsAndContext1791400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "print_job_items"
        ADD COLUMN "serial_no" int,
        ADD COLUMN "serial_year" smallint,
        ADD COLUMN "context_type" varchar(20),
        ADD COLUMN "context_id" uuid
    `);
    // ponytail: no FK on context_id; add one per type if a second context type appears
    await queryRunner.query(
      `ALTER TABLE "print_job_items" ADD CONSTRAINT "CK_print_job_items_serial_pair" CHECK (("serial_no" IS NULL) = ("serial_year" IS NULL))`,
    );
    await queryRunner.query(
      `ALTER TABLE "print_job_items" ADD CONSTRAINT "CK_print_job_items_serial_range" CHECK ("serial_no" IS NULL OR "serial_no" BETWEEN 1 AND 99999)`,
    );
    await queryRunner.query(
      `ALTER TABLE "print_job_items" ADD CONSTRAINT "CK_print_job_items_context_pair" CHECK (("context_type" IS NULL) = ("context_id" IS NULL))`,
    );
    await queryRunner.query(
      `ALTER TABLE "print_job_items" DROP CONSTRAINT "UQ_print_job_items_copy"`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_print_job_items_copy" ON "print_job_items"
        ("tenant_id", "subject_type", "subject_id", "document_kind", "context_type", "context_id", "copy_number")
        NULLS NOT DISTINCT WHERE "serial_no" IS NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_print_job_items_serial_copy" ON "print_job_items"
        ("tenant_id", "document_kind", "serial_year", "serial_no", "copy_number")
        WHERE "serial_no" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_print_job_items_context" ON "print_job_items"
        ("tenant_id", "context_type", "context_id", "document_kind")
        WHERE "context_id" IS NOT NULL
    `);
  }

  /**
   * Fails once two exams' admit cards (or two serial rows of one student and
   * kind) share a copy number under the old key: intended, it refuses to
   * silently merge them.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_print_job_items_context"`);
    await queryRunner.query(`DROP INDEX "UQ_print_job_items_serial_copy"`);
    await queryRunner.query(`DROP INDEX "UQ_print_job_items_copy"`);
    await queryRunner.query(
      `ALTER TABLE "print_job_items" DROP CONSTRAINT "CK_print_job_items_context_pair"`,
    );
    await queryRunner.query(
      `ALTER TABLE "print_job_items" DROP CONSTRAINT "CK_print_job_items_serial_range"`,
    );
    await queryRunner.query(
      `ALTER TABLE "print_job_items" DROP CONSTRAINT "CK_print_job_items_serial_pair"`,
    );
    await queryRunner.query(
      `ALTER TABLE "print_job_items" ADD CONSTRAINT "UQ_print_job_items_copy" UNIQUE NULLS NOT DISTINCT ("tenant_id", "subject_type", "subject_id", "document_kind", "copy_number")`,
    );
    await queryRunner.query(`
      ALTER TABLE "print_job_items"
        DROP COLUMN "context_id",
        DROP COLUMN "context_type",
        DROP COLUMN "serial_year",
        DROP COLUMN "serial_no"
    `);
  }
}

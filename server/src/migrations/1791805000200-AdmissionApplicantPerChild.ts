import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [68.3 LIFE-10] One application per CHILD per intake, not per guardian
 * phone: twins under one parent phone can both apply. The partial unique
 * index widens from (tenant, intake, phone) to
 * (tenant, intake, phone, date_of_birth, applicant_name).
 */
export class AdmissionApplicantPerChild1791805000200 implements MigrationInterface {
  name = 'AdmissionApplicantPerChild1791805000200';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_admission_applicants_intake_phone"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_admission_applicants_intake_child" ON "admission_applicants" ("tenant_id", "intake_id", "guardian_phone", "date_of_birth", "applicant_name") WHERE "deleted_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Siblings under one phone can't fit the old per-phone index; refuse
    // rather than silently deleting or combining real applications.
    const dupes = await queryRunner.query(
      `SELECT 1 FROM "admission_applicants" WHERE "deleted_at" IS NULL
       GROUP BY "tenant_id", "intake_id", "guardian_phone" HAVING COUNT(*) > 1 LIMIT 1`,
    );
    if (dupes.length > 0) {
      throw new Error(
        'Cannot revert AdmissionApplicantPerChild: live applicants for different children share a guardian phone within one intake. Remove or re-key them first.',
      );
    }
    await queryRunner.query(`DROP INDEX "IDX_admission_applicants_intake_child"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_admission_applicants_intake_phone" ON "admission_applicants" ("tenant_id", "intake_id", "guardian_phone") WHERE "deleted_at" IS NULL`,
    );
  }
}

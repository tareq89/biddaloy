import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [69.1.02] `academic_years.closed_at` / `closed_by_user_id` (Epic 69, D4, D21).
 * A closed year is read-only; the CHECK makes the database itself refuse a closed current year.
 * The FK and partial index use explicit names, so the entity shows no drift.
 */
export class AcademicYearClosed1791900003700 implements MigrationInterface {
  name = 'AcademicYearClosed1791900003700';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "academic_years" ADD "closed_at" TIMESTAMP WITH TIME ZONE, ADD "closed_by_user_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "academic_years" ADD CONSTRAINT "FK_2f502d34732881e291a71966d1f" FOREIGN KEY ("closed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "academic_years" ADD CONSTRAINT "CHK_academic_years_closed_not_current" CHECK ("closed_at" IS NULL OR "is_current" = false)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_academic_years_tenant_closed" ON "academic_years" ("tenant_id", "closed_at") WHERE "closed_at" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_academic_years_tenant_closed"`);
    await queryRunner.query(
      `ALTER TABLE "academic_years" DROP CONSTRAINT "CHK_academic_years_closed_not_current"`,
    );
    await queryRunner.query(
      `ALTER TABLE "academic_years" DROP CONSTRAINT "FK_2f502d34732881e291a71966d1f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "academic_years" DROP COLUMN "closed_by_user_id", DROP COLUMN "closed_at"`,
    );
  }
}

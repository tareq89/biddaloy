import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `students.registration_number` has carried a plain, non-tenant-scoped
 * `UNIQUE` constraint since the initial schema (`UQ_82946fdb5652b83cacb81e9083e`
 * on `registration_number` alone). `Student`'s own entity has separately
 * declared the intended `@Index(['tenant_id', 'registration_number'], {
 * unique: true })` — this migration was simply never written to match it.
 *
 * Two different tenants' students legitimately share registration numbers
 * (both schools' first-ever student is `REG-2026-0001`, since numbering is
 * per-tenant-per-year — see `StudentService.create`), so the global
 * constraint rejects a perfectly normal second school's first student.
 * Confirmed as a real, deterministic collision (not a rare coincidence) by
 * Epic 14's backup/restore e2e journey, which provisions its own tenant and
 * hit this on every run.
 *
 * Not tied to #698 (which groups `teachers.employee_id` and `users.email`,
 * both of which need an actual product decision) — for this column the
 * tenant-scoped index is already the codebase's stated intent, just never
 * migrated. Safe to apply with no product-level ambiguity.
 */
export class ScopeStudentRegistrationNumberToTenant1789600000000 implements MigrationInterface {
  name = 'ScopeStudentRegistrationNumberToTenant1789600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "students" DROP CONSTRAINT "UQ_82946fdb5652b83cacb81e9083e"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_students_tenant_id_registration_number" ON "students" ("tenant_id", "registration_number")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_students_tenant_id_registration_number"`);
    await queryRunner.query(
      `ALTER TABLE "students" ADD CONSTRAINT "UQ_82946fdb5652b83cacb81e9083e" UNIQUE ("registration_number")`,
    );
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/** [14.2.2/#585] History table for every workbook export, snapshot and
 * restore. Creates no rows — existing tenants simply have no job history
 * until they run their first export, and every read is tenant-scoped, so
 * there is nothing to backfill.
 *
 * Rollback: `down` drops the table (with its index and both FKs) and then
 * the three enum types, in reverse creation order. It is a hard
 * `DROP TABLE` — all job history is lost — which is safe while no 14.x
 * code writes rows yet, and after that is a destructive operation to run
 * deliberately, not routinely.
 */
export class AddWorkbookJobs1789500000000 implements MigrationInterface {
  name = 'AddWorkbookJobs1789500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."workbook_jobs_kind_enum" AS ENUM('EXPORT', 'SNAPSHOT', 'RESTORE')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."workbook_jobs_status_enum" AS ENUM('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'DELETED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."workbook_jobs_source_enum" AS ENUM('MANUAL', 'SCHEDULED', 'SNAPSHOT')`,
    );
    await queryRunner.query(
      `CREATE TABLE "workbook_jobs" (` +
        `"id" uuid NOT NULL DEFAULT uuid_generate_v4(), ` +
        `"tenant_id" uuid NOT NULL, ` +
        `"kind" "public"."workbook_jobs_kind_enum" NOT NULL, ` +
        `"status" "public"."workbook_jobs_status_enum" NOT NULL DEFAULT 'QUEUED', ` +
        `"source" "public"."workbook_jobs_source_enum" NOT NULL DEFAULT 'MANUAL', ` +
        `"requested_by_user_id" uuid, ` +
        `"storage_key" text, ` +
        `"size_bytes" bigint, ` +
        `"row_counts" jsonb, ` +
        `"progress" jsonb, ` +
        `"staging_id" text, ` +
        `"snapshot_job_id" uuid, ` +
        `"failed_tab" text, ` +
        `"error" text, ` +
        `"pinned" boolean NOT NULL DEFAULT false, ` +
        `"expires_at" TIMESTAMP WITH TIME ZONE, ` +
        `"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), ` +
        `"finished_at" TIMESTAMP WITH TIME ZONE, ` +
        `CONSTRAINT "PK_workbook_jobs" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_workbook_jobs_tenant_created" ON "workbook_jobs" ("tenant_id", "created_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_workbook_jobs_tenant_kind_status" ON "workbook_jobs" ("tenant_id", "kind", "status")`,
    );
    await queryRunner.query(
      `ALTER TABLE "workbook_jobs" ADD CONSTRAINT "FK_workbook_jobs_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "workbook_jobs" ADD CONSTRAINT "FK_workbook_jobs_requested_by" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "workbook_jobs" DROP CONSTRAINT "FK_workbook_jobs_requested_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "workbook_jobs" DROP CONSTRAINT "FK_workbook_jobs_tenant"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_workbook_jobs_tenant_kind_status"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_workbook_jobs_tenant_created"`);
    await queryRunner.query(`DROP TABLE "workbook_jobs"`);
    await queryRunner.query(`DROP TYPE "public"."workbook_jobs_source_enum"`);
    await queryRunner.query(`DROP TYPE "public"."workbook_jobs_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."workbook_jobs_kind_enum"`);
  }
}

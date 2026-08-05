import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTenantIdToCommunicationLogs1785304003457 implements MigrationInterface {
  name = 'AddTenantIdToCommunicationLogs1785304003457';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "communication_logs" ADD "tenant_id" uuid`);

    // Backfill from whichever of student/guardian is set.
    await queryRunner.query(`
            UPDATE "communication_logs" cl
            SET "tenant_id" = COALESCE(
                (SELECT s."tenant_id" FROM "students" s WHERE s."id" = cl."student_id"),
                (SELECT g."tenant_id" FROM "guardians" g WHERE g."id" = cl."guardian_id")
            )
            WHERE cl."tenant_id" IS NULL
        `);

    // A freeform send (neither student nor guardian set) has no tenant to
    // derive from, so fall back to the oldest school — otherwise the
    // SET NOT NULL below would fail and roll back the whole migration.
    // Same fallback the tenant-isolation migration (1784175065080) uses
    // for the other tables that gained a tenant_id.
    await queryRunner.query(`
            UPDATE "communication_logs"
            SET "tenant_id" = (SELECT "id" FROM "schools" ORDER BY "created_at" ASC LIMIT 1)
            WHERE "tenant_id" IS NULL
        `);

    await queryRunner.query(
      `ALTER TABLE "communication_logs" ALTER COLUMN "tenant_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "communication_logs" ADD CONSTRAINT "FK_cml_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_cml_tenant" ON "communication_logs" ("tenant_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_cml_tenant"`);
    await queryRunner.query(`ALTER TABLE "communication_logs" DROP CONSTRAINT "FK_cml_tenant"`);
    await queryRunner.query(`ALTER TABLE "communication_logs" DROP COLUMN "tenant_id"`);
  }
}

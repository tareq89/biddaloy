import { MigrationInterface, QueryRunner } from "typeorm";

export class AddTenantIdToCommunicationLogs1785304003457 implements MigrationInterface {
    name = 'AddTenantIdToCommunicationLogs1785304003457'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "communication_logs" ADD "tenant_id" uuid`);

        // Backfill from whichever of student/guardian is set — a freeform
        // send (neither set) has no tenant to derive, so it's left NULL
        // here and must be supplied going forward (see CommunicationsService).
        await queryRunner.query(`
            UPDATE "communication_logs" cl
            SET "tenant_id" = COALESCE(
                (SELECT s."tenant_id" FROM "students" s WHERE s."id" = cl."student_id"),
                (SELECT g."tenant_id" FROM "guardians" g WHERE g."id" = cl."guardian_id")
            )
            WHERE cl."tenant_id" IS NULL
        `);

        await queryRunner.query(`ALTER TABLE "communication_logs" ALTER COLUMN "tenant_id" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "communication_logs" ADD CONSTRAINT "FK_cml_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`CREATE INDEX "IDX_cml_tenant" ON "communication_logs" ("tenant_id")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_cml_tenant"`);
        await queryRunner.query(`ALTER TABLE "communication_logs" DROP CONSTRAINT "FK_cml_tenant"`);
        await queryRunner.query(`ALTER TABLE "communication_logs" DROP COLUMN "tenant_id"`);
    }
}

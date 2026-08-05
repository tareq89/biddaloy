import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReminderBatchTenantAndLogLink1785316147772 implements MigrationInterface {
  name = 'AddReminderBatchTenantAndLogLink1785316147772';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "reminder_batches" ADD "tenant_id" uuid`);

    // A batch's only pre-existing relation is initiated_by_user_id, so the
    // tenant is derivable from the initiating user's membership when they
    // belong to exactly one school.
    await queryRunner.query(`
            UPDATE "reminder_batches" rb
            SET "tenant_id" = (
                SELECT ut."tenant_id" FROM "user_tenants" ut
                WHERE ut."user_id" = rb."initiated_by_user_id"
                ORDER BY ut."created_at" ASC LIMIT 1
            )
            WHERE rb."tenant_id" IS NULL
        `);

    // Anything still unattributable falls back to the oldest school, the
    // same fallback migration 1784175065080 uses — without it SET NOT NULL
    // below would fail and roll back the whole migration.
    await queryRunner.query(`
            UPDATE "reminder_batches"
            SET "tenant_id" = (SELECT "id" FROM "schools" ORDER BY "created_at" ASC LIMIT 1)
            WHERE "tenant_id" IS NULL
        `);

    await queryRunner.query(`ALTER TABLE "reminder_batches" ALTER COLUMN "tenant_id" SET NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE "reminder_batches" ADD CONSTRAINT "FK_rb_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_rb_tenant" ON "reminder_batches" ("tenant_id")`);

    // Links each dispatched message back to the batch that produced it, so
    // the worker can attribute success/failure counts. Nullable because
    // one-off sends have no batch; SET NULL on delete keeps the audit row.
    await queryRunner.query(`ALTER TABLE "communication_logs" ADD "reminder_batch_id" uuid`);
    await queryRunner.query(
      `ALTER TABLE "communication_logs" ADD CONSTRAINT "FK_cml_reminder_batch" FOREIGN KEY ("reminder_batch_id") REFERENCES "reminder_batches"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cml_reminder_batch" ON "communication_logs" ("reminder_batch_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_cml_reminder_batch"`);
    await queryRunner.query(
      `ALTER TABLE "communication_logs" DROP CONSTRAINT "FK_cml_reminder_batch"`,
    );
    await queryRunner.query(`ALTER TABLE "communication_logs" DROP COLUMN "reminder_batch_id"`);

    await queryRunner.query(`DROP INDEX "public"."IDX_rb_tenant"`);
    await queryRunner.query(`ALTER TABLE "reminder_batches" DROP CONSTRAINT "FK_rb_tenant"`);
    await queryRunner.query(`ALTER TABLE "reminder_batches" DROP COLUMN "tenant_id"`);
  }
}

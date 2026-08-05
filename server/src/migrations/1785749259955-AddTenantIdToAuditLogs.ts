import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTenantIdToAuditLogs1785749259955 implements MigrationInterface {
  name = 'AddTenantIdToAuditLogs1785749259955';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // The write-only trigger fires on UPDATE for every row, including the
    // backfill below — drop it for the duration of this migration and
    // recreate it identically once the column is in place.
    await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_audit_logs_write_only" ON "audit_logs"`);

    // Nullable, unlike the AddTenantIdToCommunicationLogs/
    // AddReminderBatchTenantAndLogLink precedent: those tables are only
    // ever written from inside an already-tenant-scoped request
    // (CurrentTenant already resolved). audit_logs also records LOGIN/
    // LOGIN_FAILED, which happen at /auth/login *before* a tenant is
    // selected — for an unrecognized identifier there is no tenant to
    // attribute the attempt to, and forcing one (e.g. the oldest school)
    // would misattribute a security-relevant record to an unrelated
    // tenant's trail. Left NULL, that row simply doesn't surface on any
    // tenant-scoped read — which is correct, not a gap this ticket's
    // (deliberately tenant-scoped) admin endpoint needs to close.
    await queryRunner.query(`ALTER TABLE "audit_logs" ADD "tenant_id" uuid`);

    // A log row's only pre-existing relation is performed_by_user_id, so
    // the tenant is derivable from that user's earliest membership. Same
    // pattern as AddReminderBatchTenantAndLogLink (1785316147772), minus
    // its oldest-school fallback for the reason above.
    await queryRunner.query(`
            UPDATE "audit_logs" al
            SET "tenant_id" = (
                SELECT ut."tenant_id" FROM "user_tenants" ut
                WHERE ut."user_id" = al."performed_by_user_id"
                ORDER BY ut."created_at" ASC LIMIT 1
            )
            WHERE al."tenant_id" IS NULL
        `);

    // RESTRICT rather than the CASCADE used elsewhere: a cascaded DELETE
    // (or a CASCADE/SET NULL's own UPDATE) landing on audit_logs would
    // fire trg_audit_logs_write_only and abort — the write-only
    // guarantee has no exception for FK-driven writes. RESTRICT instead
    // fails the school deletion itself with an ordinary FK-violation
    // error, which is the correct outcome: a tenant with audit history
    // was never deletable safely anyway.
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ADD CONSTRAINT "FK_al_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_al_tenant" ON "audit_logs" ("tenant_id")`);

    await queryRunner.query(
      `CREATE TRIGGER "trg_audit_logs_write_only" BEFORE UPDATE OR DELETE ON "audit_logs" FOR EACH ROW EXECUTE FUNCTION "public"."block_audit_logs_write_only"()`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_audit_logs_write_only" ON "audit_logs"`);

    await queryRunner.query(`DROP INDEX "public"."IDX_al_tenant"`);
    await queryRunner.query(`ALTER TABLE "audit_logs" DROP CONSTRAINT "FK_al_tenant"`);
    await queryRunner.query(`ALTER TABLE "audit_logs" DROP COLUMN "tenant_id"`);

    await queryRunner.query(
      `CREATE TRIGGER "trg_audit_logs_write_only" BEFORE UPDATE OR DELETE ON "audit_logs" FOR EACH ROW EXECUTE FUNCTION "public"."block_audit_logs_write_only"()`,
    );
  }
}

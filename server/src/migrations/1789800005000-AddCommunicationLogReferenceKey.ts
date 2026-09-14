import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [16.3.4] `communication_logs.reference_key` — an idempotency key an
 * automated dispatcher sets when it creates a log row, so a re-emitted
 * event (e.g. `fees.generated` replayed by an at-least-once event bus) does
 * not queue a second message for the same recipient. Confirmed genuinely
 * absent before this migration (`rg -n "reference_key|referenceKey"
 * server/src` — zero hits).
 *
 * Nullable: only automated dispatchers that need this guarantee set it
 * (fee-notifications today); manual sends and bulk-reminder batches (which
 * already dedupe via `reminder_batch_id` + one log per resolved recipient)
 * leave it null. A partial unique index — scoped to `(tenant_id,
 * reference_key)`, only when non-null — is what the "one send per
 * (feeGenerationId, guardianId)" guarantee actually rests on: a plain
 * unique constraint would reject every row after the first NULL.
 */
export class AddCommunicationLogReferenceKey1789800005000 implements MigrationInterface {
  name = 'AddCommunicationLogReferenceKey1789800005000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "communication_logs" ADD "reference_key" character varying(200)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_communication_logs_tenant_reference_key" ON "communication_logs" ("tenant_id", "reference_key") WHERE "reference_key" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_communication_logs_tenant_reference_key"`);
    await queryRunner.query(`ALTER TABLE "communication_logs" DROP COLUMN "reference_key"`);
  }
}

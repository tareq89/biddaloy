import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSingleReminderCommunicationTrigger1787486700000 implements MigrationInterface {
  name = 'AddSingleReminderCommunicationTrigger1787486700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."communication_logs_trigger_enum" ADD VALUE 'SINGLE_REMINDER'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Postgres has no `ALTER TYPE ... DROP VALUE` — recreate the type
    // without it. Fails loudly (by design) if any communication_logs row
    // already uses 'SINGLE_REMINDER': rolling back into data the old type
    // can't represent should error, not silently drop rows or truncate
    // data.
    await queryRunner.query(
      `ALTER TYPE "public"."communication_logs_trigger_enum" RENAME TO "communication_logs_trigger_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."communication_logs_trigger_enum" AS ENUM('MANUAL', 'AUTOMATED', 'BULK_REMINDER')`,
    );
    await queryRunner.query(
      `ALTER TABLE "communication_logs" ALTER COLUMN "trigger" TYPE "public"."communication_logs_trigger_enum" USING "trigger"::text::"public"."communication_logs_trigger_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."communication_logs_trigger_enum_old"`);
  }
}

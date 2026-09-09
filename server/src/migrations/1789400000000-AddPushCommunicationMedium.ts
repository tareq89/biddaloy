import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * #555: `communication_logs.medium` gets a `PUSH` value so the automated
 * dispatcher can log a push-delivered routine notification. Deliberately
 * NOT added to the shared `CommunicationMedium` enum/type used elsewhere
 * (e.g. `guardians.preferred_communication`) — see
 * `communication-log.entity.ts`'s `CommunicationLogMedium` doc comment.
 * Same ALTER TYPE ... ADD VALUE pattern as
 * 1787616000000-AddReminderPreviewedAuditAction.ts.
 */
export class AddPushCommunicationMedium1789400000000 implements MigrationInterface {
  name = 'AddPushCommunicationMedium1789400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."communication_logs_medium_enum" ADD VALUE 'PUSH'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Postgres has no `ALTER TYPE ... DROP VALUE` — recreate the type
    // without it. Fails loudly (by design) if any communication_logs row
    // already uses 'PUSH': rolling back into data the old type can't
    // represent should error, not silently drop rows or truncate data.
    await queryRunner.query(
      `ALTER TYPE "public"."communication_logs_medium_enum" RENAME TO "communication_logs_medium_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."communication_logs_medium_enum" AS ENUM('SMS', 'WHATSAPP', 'EMAIL', 'PHONE_CALL', 'MESSENGER')`,
    );
    await queryRunner.query(
      `ALTER TABLE "communication_logs" ALTER COLUMN "medium" TYPE "public"."communication_logs_medium_enum" USING "medium"::text::"public"."communication_logs_medium_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."communication_logs_medium_enum_old"`);
  }
}

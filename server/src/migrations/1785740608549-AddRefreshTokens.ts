import { MigrationInterface, QueryRunner } from "typeorm";

export class AddRefreshTokens1785740608549 implements MigrationInterface {
    name = 'AddRefreshTokens1785740608549'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TYPE "public"."audit_logs_action_enum" ADD VALUE 'TOKEN_REUSE_DETECTED'`);
        await queryRunner.query(`CREATE TABLE "refresh_tokens" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "family_id" uuid NOT NULL, "token_hash" character varying(64) NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "revoked_at" TIMESTAMP WITH TIME ZONE, "replaced_by_id" uuid, "ip_address" character varying(45), "user_agent" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_refresh_tokens" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_rt_user" ON "refresh_tokens" ("user_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_rt_family" ON "refresh_tokens" ("family_id") `);
        await queryRunner.query(`ALTER TABLE "refresh_tokens" ADD CONSTRAINT "FK_rt_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "refresh_tokens" DROP CONSTRAINT "FK_rt_user"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_rt_family"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_rt_user"`);
        await queryRunner.query(`DROP TABLE "refresh_tokens"`);

        // Postgres has no `ALTER TYPE ... DROP VALUE` — recreate the type
        // without it. Fails loudly (by design) if any audit_logs row already
        // uses 'TOKEN_REUSE_DETECTED': rolling back into data the old type
        // can't represent should error, not silently drop rows or truncate
        // data. See AddLoginFailedAuditAction1785702546209 for the same
        // pattern.
        await queryRunner.query(`ALTER TYPE "public"."audit_logs_action_enum" RENAME TO "audit_logs_action_enum_old"`);
        await queryRunner.query(`CREATE TYPE "public"."audit_logs_action_enum" AS ENUM('CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'PAYMENT_RECEIVED', 'INVOICE_GENERATED', 'BULK_UPLOAD', 'REMINDER_SENT', 'FEE_STRUCTURE_CHANGE')`);
        await queryRunner.query(`ALTER TABLE "audit_logs" ALTER COLUMN "action" TYPE "public"."audit_logs_action_enum" USING "action"::text::"public"."audit_logs_action_enum"`);
        await queryRunner.query(`DROP TYPE "public"."audit_logs_action_enum_old"`);
    }
}

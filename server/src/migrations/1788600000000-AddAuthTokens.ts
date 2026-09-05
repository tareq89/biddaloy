import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAuthTokens1788600000000 implements MigrationInterface {
  name = 'AddAuthTokens1788600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."auth_tokens_purpose_enum" AS ENUM('INVITE', 'PASSWORD_RESET', 'EMAIL_VERIFY')`,
    );
    await queryRunner.query(
      `CREATE TABLE "auth_tokens" (` +
        `"id" uuid NOT NULL DEFAULT uuid_generate_v4(), ` +
        `"user_id" uuid NOT NULL, ` +
        `"tenant_id" uuid, ` +
        `"purpose" "public"."auth_tokens_purpose_enum" NOT NULL, ` +
        `"token_hash" character varying(64) NOT NULL, ` +
        `"expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, ` +
        `"consumed_at" TIMESTAMP WITH TIME ZONE, ` +
        `"revoked_at" TIMESTAMP WITH TIME ZONE, ` +
        `"created_by_user_id" uuid, ` +
        `"metadata" jsonb, ` +
        `"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "UQ_auth_tokens_token_hash" UNIQUE ("token_hash"), ` +
        `CONSTRAINT "PK_auth_tokens" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_auth_tokens_user_purpose" ON "auth_tokens" ("user_id", "purpose")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_auth_tokens_token_hash" ON "auth_tokens" ("token_hash")`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth_tokens" ADD CONSTRAINT "FK_auth_tokens_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth_tokens" ADD CONSTRAINT "FK_auth_tokens_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth_tokens" ADD CONSTRAINT "FK_auth_tokens_created_by" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "auth_tokens" DROP CONSTRAINT "FK_auth_tokens_created_by"`,
    );
    await queryRunner.query(`ALTER TABLE "auth_tokens" DROP CONSTRAINT "FK_auth_tokens_tenant"`);
    await queryRunner.query(`ALTER TABLE "auth_tokens" DROP CONSTRAINT "FK_auth_tokens_user"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_auth_tokens_token_hash"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_auth_tokens_user_purpose"`);
    await queryRunner.query(`DROP TABLE "auth_tokens"`);
    await queryRunner.query(`DROP TYPE "public"."auth_tokens_purpose_enum"`);
  }
}

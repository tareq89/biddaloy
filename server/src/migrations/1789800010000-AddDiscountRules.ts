import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [16.7.3]/#677 — `discount_rules`: one standing discount on one student,
 * applied by `DiscountRulesService` at fee-generation time. Every write is
 * approval-gated (`DISCOUNT_RULE_MANAGE` + `ApprovalScope.DISCOUNT_RULES_MANAGE`).
 */
export class AddDiscountRules1789800010000 implements MigrationInterface {
  name = 'AddDiscountRules1789800010000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."discount_rules_kind_enum" AS ENUM('PERCENT', 'FLAT')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."discount_rules_fee_types_enum" AS ENUM(
        'MONTHLY_TUITION', 'EXAM_FEE', 'LIBRARY_FEE', 'LAB_FEE', 'SPORTS_FEE',
        'COMPUTER_FEE', 'TRANSPORT_FEE', 'ANNUAL_FEE', 'ADMISSION_FEE', 'LATE_FEE', 'OTHER'
      )`,
    );
    await queryRunner.query(`
      CREATE TABLE "discount_rules" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "student_id" uuid NOT NULL,
        "kind" "public"."discount_rules_kind_enum" NOT NULL,
        "value" decimal(10,2) NOT NULL,
        "fee_types" "public"."discount_rules_fee_types_enum"[],
        "starts_on" date,
        "ends_on" date,
        "reason" character varying(200) NOT NULL,
        "created_by_user_id" uuid NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "approved_by_user_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "PK_discount_rules" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_discount_rules_percent_range"
          CHECK ("kind" <> 'PERCENT' OR ("value" >= 0 AND "value" <= 100))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_discount_rules_tenant_id" ON "discount_rules" ("tenant_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_discount_rules_student_id" ON "discount_rules" ("student_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "discount_rules" ADD CONSTRAINT "FK_discount_rules_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "discount_rules" ADD CONSTRAINT "FK_discount_rules_student" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "discount_rules" ADD CONSTRAINT "FK_discount_rules_approved_by_user_id" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "discount_rules"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."discount_rules_fee_types_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."discount_rules_kind_enum"`);
  }
}

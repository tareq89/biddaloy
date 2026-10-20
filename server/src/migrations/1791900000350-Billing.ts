import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [49.4/#1818] Billing tables: `seat_orders` and `platform_payments`.
 * Platform-owned money, so no tenant RLS and no workbook tab. Amount cap is
 * MONEY_MAX (99,999,999.99) in paisa. Demo seed: the `billing` slice (owedBy #2184) covers both tables; #2184 fills it.
 * Money records survive school deletion, so both FKs are ON DELETE RESTRICT.
 */
export class Billing1791900000350 implements MigrationInterface {
  name = 'Billing1791900000350';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."seat_orders_status_enum" AS ENUM('PENDING', 'PAID', 'FAILED', 'CANCELLED', 'REFUNDED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."platform_payments_method_enum" AS ENUM('BKASH', 'OFFLINE_BANK', 'OFFLINE_CASH', 'GRANT')`,
    );
    await queryRunner.query(
      `CREATE TABLE "seat_orders" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "school_id" uuid NOT NULL,
        "seats" integer NOT NULL,
        "months" integer NOT NULL,
        "unit_price_paisa" integer NOT NULL,
        "amount_paisa" bigint NOT NULL,
        "period_start" date NOT NULL,
        "period_end" date NOT NULL,
        "status" "public"."seat_orders_status_enum" NOT NULL,
        "idempotency_key" text NOT NULL,
        "created_by_user_id" uuid,
        "paid_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_seat_orders" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_seat_orders_school_idempotency" UNIQUE ("school_id", "idempotency_key"),
        CONSTRAINT "CHK_seat_orders_seats" CHECK ("seats" >= 1),
        CONSTRAINT "CHK_seat_orders_months" CHECK ("months" BETWEEN 1 AND 24),
        CONSTRAINT "CHK_seat_orders_unit_price" CHECK ("unit_price_paisa" >= 0),
        CONSTRAINT "CHK_seat_orders_amount" CHECK ("amount_paisa" BETWEEN 0 AND 9999999999),
        CONSTRAINT "CHK_seat_orders_period" CHECK ("period_end" >= "period_start"),
        CONSTRAINT "FK_0d8ec982faee726e1b710f65eb2" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_db0e858e48d901002bf6ffaff91" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_seat_orders_school_status_period" ON "seat_orders" ("school_id", "status", "period_end")`,
    );
    await queryRunner.query(
      `CREATE TABLE "platform_payments" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "seat_order_id" uuid NOT NULL,
        "method" "public"."platform_payments_method_enum" NOT NULL,
        "gateway_ref" text,
        "amount_paisa" bigint NOT NULL,
        "raw" jsonb,
        "recorded_by_user_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_platform_payments" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_platform_payments_method_gateway_ref" UNIQUE ("method", "gateway_ref"),
        CONSTRAINT "CHK_platform_payments_amount" CHECK ("amount_paisa" BETWEEN 0 AND 9999999999),
        CONSTRAINT "FK_028a5245bbd31ec3d6f94053c2e" FOREIGN KEY ("seat_order_id") REFERENCES "seat_orders"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_2dc17dea74386576a59ffe55372" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_platform_payments_order" ON "platform_payments" ("seat_order_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "platform_payments"`);
    await queryRunner.query(`DROP TABLE "seat_orders"`);
    await queryRunner.query(`DROP TYPE "public"."platform_payments_method_enum"`);
    await queryRunner.query(`DROP TYPE "public"."seat_orders_status_enum"`);
  }
}

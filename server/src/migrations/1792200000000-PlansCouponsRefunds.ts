import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [100.3.gC-01/#3867] Plans, coupons and refunds.
 *
 * - `plans` (every school is on one; fixed default 'Standard' id, D42), `schools.plan_id`.
 * - `coupons`, `coupon_schools`, `coupon_redemptions` (one coupon per order, D25).
 * - `seat_orders`: plan/coupon/discount and refund columns, `CHK_seat_orders_discount`.
 * - `sms_bundle_orders.refunded_by_user_id` (refunded_at/refund_reason came with SmsLots);
 *   `sms_credit_lots.status` gains REFUNDED.
 * - Seeds the `billing.vat` key in `platform_settings` from BILLING_VAT_REGISTRATION (read once, here).
 * The `COUPON` payment method and the audit enum labels were added by SmsLots1792100000000.
 * Platform-owned money: no tenant RLS, no workbook tab. Demo seed: the `billing` slice (#3875).
 */
export const DEFAULT_PLAN_ID = '00000000-0000-4000-8000-000000000001';

export class PlansCouponsRefunds1792200000000 implements MigrationInterface {
  name = 'PlansCouponsRefunds1792200000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TABLE "plans" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" varchar(60) NOT NULL,
        "unit_price_paisa" integer NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "is_default" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_plans" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_plans_unit_price" CHECK ("unit_price_paisa" BETWEEN 1 AND 100000000),
        CONSTRAINT "CHK_plans_default_active" CHECK (NOT "is_default" OR "active")
      )`,
    );
    await q.query(`CREATE UNIQUE INDEX "UQ_plans_name_lower" ON "plans" (lower("name"))`);
    await q.query(
      `CREATE UNIQUE INDEX "UQ_plans_one_default" ON "plans" ("is_default") WHERE "is_default"`,
    );
    await q.query(
      `INSERT INTO "plans" ("id", "name", "unit_price_paisa", "active", "is_default")
       VALUES ('${DEFAULT_PLAN_ID}', 'Standard', 1000, true, true)`,
    );

    await q.query(`ALTER TABLE "schools" ADD "plan_id" uuid DEFAULT '${DEFAULT_PLAN_ID}'`);
    await q.query(`UPDATE "schools" SET "plan_id" = '${DEFAULT_PLAN_ID}' WHERE "plan_id" IS NULL`);
    await q.query(`ALTER TABLE "schools" ALTER COLUMN "plan_id" SET NOT NULL`);
    await q.query(
      `ALTER TABLE "schools" ADD CONSTRAINT "FK_schools_plan" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT`,
    );

    await q.query(
      `CREATE TABLE "coupons" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "code" varchar(20) NOT NULL,
        "discount_kind" varchar(10) NOT NULL,
        "percent" smallint,
        "fixed_paisa" integer,
        "max_months" smallint,
        "max_discount_paisa" bigint,
        "min_order_paisa" bigint,
        "scope" varchar(10) NOT NULL DEFAULT 'ALL',
        "max_uses" integer,
        "uses_count" integer NOT NULL DEFAULT 0,
        "per_school_max" integer NOT NULL DEFAULT 1,
        "starts_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "ends_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "created_by_user_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_coupons" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_coupons_code" UNIQUE ("code"),
        CONSTRAINT "CHK_coupons_code_upper" CHECK ("code" = upper("code")),
        CONSTRAINT "CHK_coupons_kind" CHECK ("discount_kind" IN ('PERCENT','FIXED')),
        CONSTRAINT "CHK_coupons_value" CHECK (
          ("discount_kind" = 'PERCENT' AND "percent" IS NOT NULL AND "percent" BETWEEN 1 AND 100 AND "fixed_paisa" IS NULL)
          OR ("discount_kind" = 'FIXED' AND "fixed_paisa" IS NOT NULL AND "fixed_paisa" >= 1 AND "percent" IS NULL)),
        CONSTRAINT "CHK_coupons_max_months" CHECK ("max_months" IS NULL OR "max_months" BETWEEN 1 AND 24),
        CONSTRAINT "CHK_coupons_max_discount" CHECK ("max_discount_paisa" IS NULL OR "max_discount_paisa" > 0),
        CONSTRAINT "CHK_coupons_min_order" CHECK ("min_order_paisa" IS NULL OR "min_order_paisa" > 0),
        CONSTRAINT "CHK_coupons_scope" CHECK ("scope" IN ('ALL','SCHOOLS')),
        CONSTRAINT "CHK_coupons_max_uses" CHECK ("max_uses" IS NULL OR "max_uses" >= 1),
        CONSTRAINT "CHK_coupons_uses_count" CHECK ("uses_count" >= 0 AND ("max_uses" IS NULL OR "uses_count" <= "max_uses")),
        CONSTRAINT "CHK_coupons_per_school_max" CHECK ("per_school_max" >= 1),
        CONSTRAINT "CHK_coupons_window" CHECK ("ends_at" > "starts_at"),
        CONSTRAINT "FK_coupons_created_by" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL
      )`,
    );
    await q.query(
      `CREATE TABLE "coupon_schools" (
        "coupon_id" uuid NOT NULL,
        "school_id" uuid NOT NULL,
        CONSTRAINT "PK_coupon_schools" PRIMARY KEY ("coupon_id", "school_id"),
        CONSTRAINT "FK_coupon_schools_coupon" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_coupon_schools_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT
      )`,
    );

    // seat_orders before coupon_redemptions: the redemption points at it.
    await q.query(`ALTER TABLE "seat_orders" ADD "plan_id" uuid`);
    await q.query(`ALTER TABLE "seat_orders" ADD "coupon_id" uuid`);
    await q.query(`ALTER TABLE "seat_orders" ADD "discount_paisa" bigint NOT NULL DEFAULT 0`);
    await q.query(`ALTER TABLE "seat_orders" ADD "refunded_at" TIMESTAMP WITH TIME ZONE`);
    await q.query(`ALTER TABLE "seat_orders" ADD "refund_reason" varchar(500)`);
    await q.query(`ALTER TABLE "seat_orders" ADD "refunded_by_user_id" uuid`);
    await q.query(
      `ALTER TABLE "seat_orders" ADD CONSTRAINT "FK_seat_orders_plan" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT`,
    );
    await q.query(
      `ALTER TABLE "seat_orders" ADD CONSTRAINT "FK_seat_orders_coupon" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE RESTRICT`,
    );
    await q.query(
      `ALTER TABLE "seat_orders" ADD CONSTRAINT "FK_seat_orders_refunded_by" FOREIGN KEY ("refunded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL`,
    );
    await q.query(
      `ALTER TABLE "seat_orders" ADD CONSTRAINT "CHK_seat_orders_discount_nonneg" CHECK ("discount_paisa" >= 0)`,
    );
    // NOT VALID then VALIDATE: a bad old row fails the migration loudly (D42: unit_price stays the list price).
    await q.query(
      `ALTER TABLE "seat_orders" ADD CONSTRAINT "CHK_seat_orders_discount" CHECK ("amount_paisa" = "seats"::bigint * "months" * "unit_price_paisa" - "discount_paisa") NOT VALID`,
    );
    await q.query(`ALTER TABLE "seat_orders" VALIDATE CONSTRAINT "CHK_seat_orders_discount"`);

    await q.query(
      `CREATE TABLE "coupon_redemptions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "coupon_id" uuid NOT NULL,
        "school_id" uuid NOT NULL,
        "seat_order_id" uuid NOT NULL,
        "discount_paisa" bigint NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_coupon_redemptions" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_coupon_redemptions_order" UNIQUE ("seat_order_id"),
        CONSTRAINT "CHK_coupon_redemptions_discount" CHECK ("discount_paisa" >= 0),
        CONSTRAINT "FK_coupon_redemptions_coupon" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_coupon_redemptions_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_coupon_redemptions_order" FOREIGN KEY ("seat_order_id") REFERENCES "seat_orders"("id") ON DELETE RESTRICT
      )`,
    );
    await q.query(
      `CREATE INDEX "IDX_coupon_redemptions_coupon_school" ON "coupon_redemptions" ("coupon_id", "school_id")`,
    );

    await q.query(`ALTER TABLE "sms_bundle_orders" ADD "refunded_by_user_id" uuid`);
    await q.query(
      `ALTER TABLE "sms_bundle_orders" ADD CONSTRAINT "FK_sms_bundle_orders_refunded_by" FOREIGN KEY ("refunded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL`,
    );
    await q.query(`ALTER TABLE "sms_credit_lots" DROP CONSTRAINT "CHK_sms_credit_lots_status"`);
    await q.query(
      `ALTER TABLE "sms_credit_lots" ADD CONSTRAINT "CHK_sms_credit_lots_status" CHECK ("status" IN ('ACTIVE','USED_UP','EXPIRED','REFUNDED'))`,
    );

    await q.query(
      `INSERT INTO "platform_settings" ("key", "value") VALUES ('billing.vat', $1::jsonb) ON CONFLICT DO NOTHING`,
      [
        JSON.stringify({
          rate_bp: null,
          label: 'VAT',
          registration: process.env.BILLING_VAT_REGISTRATION?.trim() || null,
        }),
      ],
    );
  }

  /** Enum values added elsewhere (COUPON, audit labels) cannot be dropped, so they stay. */
  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM "platform_settings" WHERE "key" = 'billing.vat'`);
    await q.query(`UPDATE "sms_credit_lots" SET "status" = 'EXPIRED' WHERE "status" = 'REFUNDED'`);
    await q.query(
      `ALTER TABLE "sms_credit_lots" DROP CONSTRAINT IF EXISTS "CHK_sms_credit_lots_status"`,
    );
    await q.query(
      `ALTER TABLE "sms_credit_lots" ADD CONSTRAINT "CHK_sms_credit_lots_status" CHECK ("status" IN ('ACTIVE','USED_UP','EXPIRED'))`,
    );
    await q.query(`ALTER TABLE "sms_bundle_orders" DROP COLUMN IF EXISTS "refunded_by_user_id"`);
    await q.query(`DROP TABLE IF EXISTS "coupon_redemptions"`);
    await q.query(`ALTER TABLE "seat_orders" DROP CONSTRAINT IF EXISTS "CHK_seat_orders_discount"`);
    await q.query(
      `ALTER TABLE "seat_orders" DROP CONSTRAINT IF EXISTS "CHK_seat_orders_discount_nonneg"`,
    );
    for (const c of [
      'plan_id',
      'coupon_id',
      'discount_paisa',
      'refunded_at',
      'refund_reason',
      'refunded_by_user_id',
    ]) {
      await q.query(`ALTER TABLE "seat_orders" DROP COLUMN IF EXISTS "${c}"`);
    }
    await q.query(`DROP TABLE IF EXISTS "coupon_schools"`);
    await q.query(`DROP TABLE IF EXISTS "coupons"`);
    await q.query(`ALTER TABLE "schools" DROP COLUMN IF EXISTS "plan_id"`);
    await q.query(`DROP TABLE IF EXISTS "plans"`);
  }
}

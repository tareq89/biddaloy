import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [100.1.02/#3851] SMS credit lots (with expiry), the package catalog and its orders, the owner's
 * stock entries, the provider balance readings, and the link from a payment to a bundle order.
 * This is the ONLY migration of Epic 100 wave 1 (D28). Money is whole paisa with CHECKs (Rule 26).
 *
 * Demo seed: rows for the new tables land in #3854 (slices carry `owedBy: '#3854'`).
 *
 * Postgres cannot use an enum value in the transaction that adds it. The backfill below writes
 * only lot/draw rows (no ledger row, no audit row), so none of the new labels is used here.
 * Backfill is idempotent: it skips a tenant that already has a LEGACY lot.
 */
const AUDIT_LABELS = [
  'SMS_BUNDLE_CREATED',
  'SMS_BUNDLE_UPDATED',
  'SMS_BUNDLE_TOGGLED',
  'SMS_BUNDLE_ORDERED',
  'SMS_BUNDLE_PAID',
  'SMS_STOCK_RECORDED',
  'SMS_STOCK_DELETED',
  'SMS_SOURCE_CHANGED',
  'PLAN_CREATED',
  'PLAN_UPDATED',
  'PLAN_DEACTIVATED',
  'PLAN_ASSIGNED',
  'COUPON_CREATED',
  'COUPON_UPDATED',
  'COUPON_DISABLED',
  'COUPON_REDEEMED',
  'ORDER_REFUNDED',
  'PLATFORM_VAT_CHANGED',
];
const KIND_LABELS = ['PURCHASE', 'EXPIRE'];
const REF_LABELS = ['bundle_order', 'lot'];

export class SmsLots1792150000000 implements MigrationInterface {
  name = 'SmsLots1792150000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const l of AUDIT_LABELS) {
      await queryRunner.query(
        `ALTER TYPE "public"."audit_logs_action_enum" ADD VALUE IF NOT EXISTS '${l}'`,
      );
    }
    // #3850 added `COUPON` to `PlatformPaymentMethod` in shared; the DB label lands here.
    await queryRunner.query(
      `ALTER TYPE "public"."platform_payments_method_enum" ADD VALUE IF NOT EXISTS 'COUPON'`,
    );
    for (const l of KIND_LABELS) {
      await queryRunner.query(
        `ALTER TYPE "public"."sms_credit_ledger_kind_enum" ADD VALUE IF NOT EXISTS '${l}'`,
      );
    }
    for (const l of REF_LABELS) {
      await queryRunner.query(
        `ALTER TYPE "public"."sms_credit_ledger_reference_type_enum" ADD VALUE IF NOT EXISTS '${l}'`,
      );
    }

    await queryRunner.query(
      `CREATE TABLE "sms_bundle_catalog" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" varchar(120) NOT NULL,
        "sms_count" integer NOT NULL,
        "validity_days" integer NOT NULL,
        "price_paisa" bigint NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "sort_order" integer NOT NULL DEFAULT 0,
        "created_by_user_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_sms_bundle_catalog" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_sms_bundle_catalog_sms_count" CHECK ("sms_count" BETWEEN 100 AND 1000000),
        CONSTRAINT "CHK_sms_bundle_catalog_validity" CHECK ("validity_days" BETWEEN 1 AND 365),
        CONSTRAINT "CHK_sms_bundle_catalog_price" CHECK ("price_paisa" BETWEEN 0 AND 9999999999),
        CONSTRAINT "FK_4be68fe55d23572078584bf9d36" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_sms_bundle_catalog_active_name" ON "sms_bundle_catalog" (lower("name")) WHERE "active"`,
    );

    await queryRunner.query(
      `CREATE TABLE "sms_bundle_orders" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "school_id" uuid NOT NULL,
        "catalog_id" uuid NOT NULL,
        "name_snapshot" varchar(120) NOT NULL,
        "sms_count" integer NOT NULL,
        "validity_days" integer NOT NULL,
        "price_paisa" bigint NOT NULL,
        "cost_paisa_per_sms" numeric(12,4),
        "status" varchar(20) NOT NULL,
        "idempotency_key" text NOT NULL,
        "receipt_number" text,
        "receipt_snapshot" jsonb,
        "paid_at" TIMESTAMP WITH TIME ZONE,
        "cancelled_at" TIMESTAMP WITH TIME ZONE,
        "refunded_at" TIMESTAMP WITH TIME ZONE,
        "refund_reason" text,
        "created_by_user_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_sms_bundle_orders" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_sms_bundle_orders_school_idempotency" UNIQUE ("school_id", "idempotency_key"),
        CONSTRAINT "CHK_sms_bundle_orders_status" CHECK ("status" IN ('PENDING_PAYMENT','PAID','ACTIVE','USED_UP','EXPIRED','CANCELLED','REFUNDED')),
        CONSTRAINT "CHK_sms_bundle_orders_sms_count" CHECK ("sms_count" > 0),
        CONSTRAINT "CHK_sms_bundle_orders_validity" CHECK ("validity_days" BETWEEN 1 AND 365),
        CONSTRAINT "CHK_sms_bundle_orders_price" CHECK ("price_paisa" BETWEEN 0 AND 9999999999),
        CONSTRAINT "CHK_sms_bundle_orders_cost" CHECK ("cost_paisa_per_sms" IS NULL OR "cost_paisa_per_sms" >= 0),
        CONSTRAINT "FK_96c976a6ba75e200ceabe15fa0b" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_9036be76269c4ba1c43b38c2434" FOREIGN KEY ("catalog_id") REFERENCES "sms_bundle_catalog"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_716e360a354999967b8764f5355" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_sms_bundle_orders_receipt_number" ON "sms_bundle_orders" ("receipt_number") WHERE "receipt_number" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sms_bundle_orders_school_status" ON "sms_bundle_orders" ("school_id", "status")`,
    );

    await queryRunner.query(
      `CREATE TABLE "sms_credit_lots" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "source" varchar(10) NOT NULL,
        "bundle_order_id" uuid,
        "units_total" integer NOT NULL,
        "remaining" integer NOT NULL,
        "reserved_units" integer NOT NULL DEFAULT 0,
        "debited_units" integer NOT NULL DEFAULT 0,
        "expired_units" integer NOT NULL DEFAULT 0,
        "expires_at" TIMESTAMP WITH TIME ZONE,
        "status" varchar(10) NOT NULL DEFAULT 'ACTIVE',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_sms_credit_lots" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_sms_credit_lots_source" CHECK ("source" IN ('BUNDLE','MANUAL','LEGACY')),
        CONSTRAINT "CHK_sms_credit_lots_status" CHECK ("status" IN ('ACTIVE','USED_UP','EXPIRED')),
        CONSTRAINT "CHK_sms_credit_lots_total" CHECK ("units_total" > 0),
        CONSTRAINT "CHK_sms_credit_lots_counters" CHECK ("remaining" >= 0 AND "reserved_units" >= 0 AND "debited_units" >= 0 AND "expired_units" >= 0),
        CONSTRAINT "CHK_sms_credit_lots_sum" CHECK ("remaining" + "reserved_units" + "debited_units" + "expired_units" = "units_total"),
        CONSTRAINT "CHK_sms_credit_lots_bundle" CHECK (("source" = 'BUNDLE') = ("bundle_order_id" IS NOT NULL)),
        CONSTRAINT "FK_52eb9de7773f122454ad1754404" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_5c2331305015b9c9ae4017c0a78" FOREIGN KEY ("bundle_order_id") REFERENCES "sms_bundle_orders"("id") ON DELETE RESTRICT
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sms_credit_lots_draw" ON "sms_credit_lots" ("tenant_id", "expires_at" NULLS LAST) WHERE "remaining" > 0`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_sms_credit_lots_bundle_order" ON "sms_credit_lots" ("bundle_order_id") WHERE "bundle_order_id" IS NOT NULL`,
    );

    await queryRunner.query(
      `CREATE TABLE "sms_credit_lot_draws" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "lot_id" uuid NOT NULL,
        "reserve_key" text NOT NULL,
        "units" integer NOT NULL,
        "open_units" integer NOT NULL,
        CONSTRAINT "PK_sms_credit_lot_draws" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_sms_credit_lot_draws_key_lot" UNIQUE ("tenant_id", "reserve_key", "lot_id"),
        CONSTRAINT "CHK_sms_credit_lot_draws_units" CHECK ("units" > 0 AND "open_units" BETWEEN 0 AND "units"),
        CONSTRAINT "FK_299662316c28ae21d4bcbe25b9a" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_586583824a208b2e1329f56268f" FOREIGN KEY ("lot_id") REFERENCES "sms_credit_lots"("id") ON DELETE RESTRICT
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sms_credit_lot_draws_key" ON "sms_credit_lot_draws" ("tenant_id", "reserve_key")`,
    );

    await queryRunner.query(
      `CREATE TABLE "sms_stock_entries" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "bought_on" date NOT NULL,
        "sms_count" integer NOT NULL,
        "cost_paisa" bigint NOT NULL,
        "note" varchar(500),
        "entered_by_user_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "deleted_by_user_id" uuid,
        "delete_reason" text,
        CONSTRAINT "PK_sms_stock_entries" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_sms_stock_entries_count" CHECK ("sms_count" > 0),
        CONSTRAINT "CHK_sms_stock_entries_cost" CHECK ("cost_paisa" BETWEEN 0 AND 9999999999),
        CONSTRAINT "FK_df9942186269bb0afcf9b445276" FOREIGN KEY ("entered_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_5b82b7350b90529e2a757b5af77" FOREIGN KEY ("deleted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL
      )`,
    );
    await queryRunner.query(
      `CREATE TABLE "sms_provider_balance_readings" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "sms_balance" integer NOT NULL,
        "entered_by_user_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_sms_provider_balance_readings" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_sms_provider_balance_readings_balance" CHECK ("sms_balance" >= 0),
        CONSTRAINT "FK_12a249a357721c8b9fa17528ce6" FOREIGN KEY ("entered_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL
      )`,
    );

    await queryRunner.query(
      `ALTER TABLE "platform_payments" ALTER COLUMN "seat_order_id" DROP NOT NULL`,
    );
    await queryRunner.query(`ALTER TABLE "platform_payments" ADD "bundle_order_id" uuid`);
    await queryRunner.query(
      `ALTER TABLE "platform_payments" ADD CONSTRAINT "FK_9b09ec4c0d99ea0b7dcb16ba973" FOREIGN KEY ("bundle_order_id") REFERENCES "sms_bundle_orders"("id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_platform_payments_bundle_order" ON "platform_payments" ("bundle_order_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "platform_payments" ADD CONSTRAINT "CHK_platform_payments_one_order" CHECK (("seat_order_id" IS NOT NULL) <> ("bundle_order_id" IS NOT NULL))`,
    );

    await SmsLots1792150000000.backfill(queryRunner);
  }

  /** D27: every funded balance becomes one no-expiry LEGACY lot. Re-runnable. */
  static async backfill(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "sms_credit_lots" ("tenant_id", "source", "units_total", "remaining", "reserved_units", "status")
       SELECT b."tenant_id", 'LEGACY', b."available" + b."reserved", b."available", b."reserved", 'ACTIVE'
         FROM "sms_credit_balance" b
        WHERE b."available" + b."reserved" > 0
          AND NOT EXISTS (SELECT 1 FROM "sms_credit_lots" l WHERE l."tenant_id" = b."tenant_id" AND l."source" = 'LEGACY')`,
    );
    await queryRunner.query(
      `INSERT INTO "sms_credit_lot_draws" ("tenant_id", "lot_id", "reserve_key", "units", "open_units")
       SELECT l."tenant_id", l."id", 'legacy:' || l."tenant_id", l."reserved_units", l."reserved_units"
         FROM "sms_credit_lots" l
        WHERE l."source" = 'LEGACY' AND l."reserved_units" > 0
          AND NOT EXISTS (SELECT 1 FROM "sms_credit_lot_draws" d WHERE d."lot_id" = l."id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const [{ n }] = await queryRunner.query(
      `SELECT count(*)::int AS n FROM "platform_payments" WHERE "seat_order_id" IS NULL`,
    );
    if (n > 0) {
      throw new Error('Cannot roll back: bundle payments exist (seat_order_id would be NULL)');
    }
    await queryRunner.query(
      `ALTER TABLE "platform_payments" DROP CONSTRAINT "CHK_platform_payments_one_order"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_platform_payments_bundle_order"`);
    await queryRunner.query(
      `ALTER TABLE "platform_payments" DROP CONSTRAINT "FK_9b09ec4c0d99ea0b7dcb16ba973"`,
    );
    await queryRunner.query(`ALTER TABLE "platform_payments" DROP COLUMN "bundle_order_id"`);
    await queryRunner.query(
      `ALTER TABLE "platform_payments" ALTER COLUMN "seat_order_id" SET NOT NULL`,
    );
    await queryRunner.query(`DROP TABLE "sms_provider_balance_readings"`);
    await queryRunner.query(`DROP TABLE "sms_stock_entries"`);
    await queryRunner.query(`DROP TABLE "sms_credit_lot_draws"`);
    await queryRunner.query(`DROP TABLE "sms_credit_lots"`);
    await queryRunner.query(`DROP TABLE "sms_bundle_orders"`);
    await queryRunner.query(`DROP TABLE "sms_bundle_catalog"`);

    // Postgres has no DROP VALUE: recreate each enum without the labels this migration added.
    // A row still using a removed label makes the cast fail loudly, which is intended.
    const R = SmsLots1792150000000.recreateEnum;
    await R(queryRunner, 'platform_payments', 'method', 'platform_payments_method_enum', [
      'COUPON',
    ]);
    await R(queryRunner, 'audit_logs', 'action', 'audit_logs_action_enum', AUDIT_LABELS);
    await R(queryRunner, 'sms_credit_ledger', 'kind', 'sms_credit_ledger_kind_enum', KIND_LABELS);
    await R(
      queryRunner,
      'sms_credit_ledger',
      'reference_type',
      'sms_credit_ledger_reference_type_enum',
      REF_LABELS,
    );
  }

  private static async recreateEnum(
    queryRunner: QueryRunner,
    table: string,
    column: string,
    type: string,
    removed: string[],
  ): Promise<void> {
    const list = removed.map((l) => `'${l}'`).join(', ');
    await queryRunner.query(`ALTER TYPE "public"."${type}" RENAME TO "${type}_old"`);
    await queryRunner.query(`DO $$
      DECLARE labels text;
      BEGIN
        SELECT string_agg(quote_literal(enumlabel), ', ' ORDER BY enumsortorder) INTO labels
          FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
          WHERE t.typname = '${type}_old' AND enumlabel NOT IN (${list});
        EXECUTE 'CREATE TYPE "public"."${type}" AS ENUM(' || labels || ')';
      END $$`);
    await queryRunner.query(
      `ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE "public"."${type}" USING "${column}"::text::"public"."${type}"`,
    );
    await queryRunner.query(`DROP TYPE "public"."${type}_old"`);
  }
}

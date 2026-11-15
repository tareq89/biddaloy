import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [3.x/#3961] Epic 3.0 payment submissions: the submission, its bills, proof files and an
 * append-only event history. Per-row CHECKs and the TrxID partial unique are here; cross-row
 * rules (one waiting proof per bill, 5 waiting per guardian, proof amount = bills total) live in
 * the submit service (#3965). Money is `decimal(10,2)` like `payments.total_amount`.
 *
 * Demo seed: rows land in #3973 (PROOF) and #3988 (ONLINE); `owedBy` entries are added by #3964
 * in `server/src/scripts/demo-seed/slices.ts`.
 */
const SRC = `'ONLINE','PROOF'`;
const STATUS = `'PENDING','CONFIRMED','REJECTED','DISCARDED','WITHDRAWN','COMPLETED','FAILED','CANCELLED','EXPIRED','REVERSED'`;
const METHOD = `'CASH','CHEQUE','BANK_TRANSFER','CARD','BKASH','NAGAD','ROCKET'`;
const REASON = `'TRXID_NOT_FOUND','AMOUNT_MISMATCH','IMAGE_UNCLEAR','DUPLICATE','OTHER'`;

const TYPES = [
  'payment_submissions_source_enum',
  'payment_submissions_status_enum',
  'payment_submissions_method_enum',
  'payment_submissions_provider_enum',
  'payment_submissions_environment_enum',
  'payment_submissions_reject_reason_enum',
  'payment_submission_events_from_status_enum',
  'payment_submission_events_to_status_enum',
];

export class PaymentSubmissions1792300000000 implements MigrationInterface {
  name = 'PaymentSubmissions1792300000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TYPE "public"."payment_submissions_source_enum" AS ENUM(${SRC})`);
    await q.query(`CREATE TYPE "public"."payment_submissions_status_enum" AS ENUM(${STATUS})`);
    await q.query(`CREATE TYPE "public"."payment_submissions_method_enum" AS ENUM(${METHOD})`);
    await q.query(`CREATE TYPE "public"."payment_submissions_provider_enum" AS ENUM('BKASH')`);
    await q.query(
      `CREATE TYPE "public"."payment_submissions_environment_enum" AS ENUM('SANDBOX','PRODUCTION')`,
    );
    await q.query(
      `CREATE TYPE "public"."payment_submissions_reject_reason_enum" AS ENUM(${REASON})`,
    );
    await q.query(
      `CREATE TYPE "public"."payment_submission_events_from_status_enum" AS ENUM(${STATUS})`,
    );
    await q.query(
      `CREATE TYPE "public"."payment_submission_events_to_status_enum" AS ENUM(${STATUS})`,
    );

    await q.query(`CREATE TABLE "payment_submissions" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "tenant_id" uuid NOT NULL,
      "source" "public"."payment_submissions_source_enum" NOT NULL,
      "status" "public"."payment_submissions_status_enum" NOT NULL DEFAULT 'PENDING',
      "submitted_by_user_id" uuid NOT NULL,
      "method" "public"."payment_submissions_method_enum",
      "amount" numeric(10,2) NOT NULL,
      "paid_on" date,
      "reference_raw" character varying(100),
      "reference_normalised" character varying(100),
      "provider" "public"."payment_submissions_provider_enum",
      "environment" "public"."payment_submissions_environment_enum",
      "provider_payment_id" character varying(100),
      "provider_trx_id" character varying(100),
      "reject_reason" "public"."payment_submissions_reject_reason_enum",
      "reject_note" text,
      "decided_by_user_id" uuid,
      "decided_at" TIMESTAMP WITH TIME ZONE,
      "discard_reason" text,
      "unmatched" boolean NOT NULL DEFAULT false,
      "started_at" TIMESTAMP WITH TIME ZONE,
      "settled_at" TIMESTAMP WITH TIME ZONE,
      "expires_at" TIMESTAMP WITH TIME ZONE,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_6e48a6cd040ffd8c74193b2425e" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_payment_submissions_amount" CHECK ("amount" > 0 AND "amount" <= 99999999.99),
      CONSTRAINT "CHK_payment_submissions_proof" CHECK ("source" <> 'PROOF' OR ("method" IS NOT NULL AND "paid_on" IS NOT NULL AND "provider" IS NULL)),
      CONSTRAINT "CHK_payment_submissions_online" CHECK ("source" <> 'ONLINE' OR ("provider" IS NOT NULL AND "method" IS NULL)),
      CONSTRAINT "CHK_payment_submissions_reject_note" CHECK ("reject_reason" IS DISTINCT FROM 'OTHER' OR "reject_note" IS NOT NULL)
    )`);
    await q.query(
      `CREATE INDEX "IDX_11b02fddb68e29eccbd237cb5a" ON "payment_submissions" ("tenant_id")`,
    );
    await q.query(
      `CREATE INDEX "IDX_16dabcc46d880aafade5447478" ON "payment_submissions" ("tenant_id", "status", "source")`,
    );
    await q.query(
      `CREATE UNIQUE INDEX "IDX_ea8bb3c9e26448022f8a3b4e2f" ON "payment_submissions" ("tenant_id", "provider", "provider_trx_id") WHERE "provider_trx_id" IS NOT NULL`,
    );
    await q.query(
      `ALTER TABLE "payment_submissions" ADD CONSTRAINT "FK_11b02fddb68e29eccbd237cb5aa" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await q.query(
      `ALTER TABLE "payment_submissions" ADD CONSTRAINT "FK_1d82dca4ed028dfe56676a3908f" FOREIGN KEY ("submitted_by_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await q.query(
      `ALTER TABLE "payment_submissions" ADD CONSTRAINT "FK_966ccffbe90134bfd0e59906f58" FOREIGN KEY ("decided_by_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );

    await q.query(`CREATE TABLE "payment_submission_bills" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "tenant_id" uuid NOT NULL,
      "submission_id" uuid NOT NULL,
      "student_fee_id" uuid NOT NULL,
      "student_id" uuid NOT NULL,
      "amount_at_start" numeric(10,2) NOT NULL,
      "payment_id" uuid,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_4e551b3393b610c6e050c1d7968" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_payment_submission_bills_amount" CHECK ("amount_at_start" > 0 AND "amount_at_start" <= 99999999.99)
    )`);
    await q.query(
      `CREATE INDEX "IDX_65b985a9620ab91a0c6f8aa5d7" ON "payment_submission_bills" ("tenant_id")`,
    );
    await q.query(
      `CREATE INDEX "IDX_5a8b51f6e7b7162609969d9139" ON "payment_submission_bills" ("student_fee_id")`,
    );
    await q.query(
      `CREATE UNIQUE INDEX "IDX_48ac97688f41ff35daafd06568" ON "payment_submission_bills" ("submission_id", "student_fee_id")`,
    );
    await q.query(
      `ALTER TABLE "payment_submission_bills" ADD CONSTRAINT "FK_65b985a9620ab91a0c6f8aa5d74" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await q.query(
      `ALTER TABLE "payment_submission_bills" ADD CONSTRAINT "FK_64feb1a8e7440b827e1b4288bb7" FOREIGN KEY ("submission_id") REFERENCES "payment_submissions"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await q.query(
      `ALTER TABLE "payment_submission_bills" ADD CONSTRAINT "FK_5a8b51f6e7b7162609969d91391" FOREIGN KEY ("student_fee_id") REFERENCES "student_fees"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await q.query(
      `ALTER TABLE "payment_submission_bills" ADD CONSTRAINT "FK_450b419a9672c3fa61655ded65f" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await q.query(
      `ALTER TABLE "payment_submission_bills" ADD CONSTRAINT "FK_c9112dc2b1d49e83d99142ad01a" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    await q.query(`CREATE TABLE "payment_submission_files" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "tenant_id" uuid NOT NULL,
      "submission_id" uuid NOT NULL,
      "storage_key" character varying(255) NOT NULL,
      "content_type" character varying(100) NOT NULL,
      "size_bytes" integer NOT NULL,
      "original_name_hash" character varying(64) NOT NULL,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_85e3b26115a432d18f02429486f" PRIMARY KEY ("id")
    )`);
    await q.query(
      `CREATE INDEX "IDX_dcddcaa4f951b947ab0bf69c98" ON "payment_submission_files" ("tenant_id")`,
    );
    await q.query(
      `CREATE INDEX "IDX_fe845490607529cb057f1e5a2d" ON "payment_submission_files" ("submission_id")`,
    );
    await q.query(
      `ALTER TABLE "payment_submission_files" ADD CONSTRAINT "FK_dcddcaa4f951b947ab0bf69c98e" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await q.query(
      `ALTER TABLE "payment_submission_files" ADD CONSTRAINT "FK_fe845490607529cb057f1e5a2d1" FOREIGN KEY ("submission_id") REFERENCES "payment_submissions"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await q.query(`CREATE TABLE "payment_submission_events" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "tenant_id" uuid NOT NULL,
      "submission_id" uuid NOT NULL,
      "from_status" "public"."payment_submission_events_from_status_enum",
      "to_status" "public"."payment_submission_events_to_status_enum" NOT NULL,
      "actor_user_id" uuid,
      "reason_code" character varying(50),
      "note" text,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_cf398a1aff7bd412b831005ec01" PRIMARY KEY ("id")
    )`);
    await q.query(
      `CREATE INDEX "IDX_0531792c876981635e59a98463" ON "payment_submission_events" ("tenant_id")`,
    );
    await q.query(
      `CREATE INDEX "IDX_407b13d16f99baa1d2f44bc7bd" ON "payment_submission_events" ("submission_id")`,
    );
    await q.query(
      `ALTER TABLE "payment_submission_events" ADD CONSTRAINT "FK_0531792c876981635e59a98463b" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await q.query(
      `ALTER TABLE "payment_submission_events" ADD CONSTRAINT "FK_407b13d16f99baa1d2f44bc7bd2" FOREIGN KEY ("submission_id") REFERENCES "payment_submissions"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await q.query(
      `ALTER TABLE "payment_submission_events" ADD CONSTRAINT "FK_8954b33c965a2ce6ba33b8c95ca" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "payment_submission_events"`);
    await q.query(`DROP TABLE IF EXISTS "payment_submission_files"`);
    await q.query(`DROP TABLE IF EXISTS "payment_submission_bills"`);
    await q.query(`DROP TABLE IF EXISTS "payment_submissions"`);
    for (const t of TYPES) await q.query(`DROP TYPE IF EXISTS "public"."${t}"`);
  }
}

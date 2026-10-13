import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [75.34] Platform incident state (a Redis outage). No tenant, no soft delete: this is
 * platform-only, not school data. The partial unique index keeps two API instances from
 * opening two rows for the same kind.
 */
export class PlatformAlerts1791805000600 implements MigrationInterface {
  name = 'PlatformAlerts1791805000600';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "platform_alerts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "kind" character varying(32) NOT NULL,
        "opened_at" timestamptz NOT NULL DEFAULT now(),
        "cleared_at" timestamptz,
        "last_sms_at" timestamptz,
        "sms_count" integer NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_platform_alerts" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_platform_alerts_kind" CHECK ("kind" IN ('REDIS_DOWN'))
      )
    `);
    await q.query(
      `CREATE UNIQUE INDEX "UQ_platform_alerts_open_kind" ON "platform_alerts" ("kind") WHERE "cleared_at" IS NULL`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX "UQ_platform_alerts_open_kind"`);
    await q.query(`DROP TABLE "platform_alerts"`);
  }
}

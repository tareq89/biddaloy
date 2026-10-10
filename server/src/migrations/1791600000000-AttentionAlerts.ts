import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [67.1.02] Epic 67 attention engine: `alerts` + `alert_recipients`.
 * Enum-like columns are varchar + CHECK. Derived data: no soft delete; lifecycle
 * is `status`/`state` plus the 12-month prune (D31).
 */
export class AttentionAlerts1791600000000 implements MigrationInterface {
  name = 'AttentionAlerts1791600000000';

  private async fk(
    q: QueryRunner,
    table: string,
    col: string,
    ref: string,
    onDelete: 'CASCADE' | 'RESTRICT' | 'SET NULL' = 'RESTRICT',
  ) {
    const name = col === 'tenant_id' ? 'tenant' : col.replace(/_id$/, '');
    await q.query(
      `ALTER TABLE "${table}" ADD CONSTRAINT "FK_${table}_${name}" FOREIGN KEY ("${col}") REFERENCES "${ref}"("id") ON DELETE ${onDelete} ON UPDATE NO ACTION`,
    );
  }

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "alerts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "rule_key" character varying(64) NOT NULL,
        "source" character varying(10) NOT NULL,
        "severity" character varying(10) NOT NULL,
        "category" character varying(20) NOT NULL,
        "status" character varying(10) NOT NULL DEFAULT 'ACTIVE',
        "dedupe_key" character varying(200) NOT NULL,
        "subject_type" character varying(32),
        "subject_id" uuid,
        "params" jsonb NOT NULL DEFAULT '{}',
        "action_url" character varying(500),
        "escalation_level" smallint NOT NULL DEFAULT 0,
        "raised_at" timestamptz NOT NULL DEFAULT now(),
        "last_evaluated_at" timestamptz NOT NULL DEFAULT now(),
        "resolved_at" timestamptz,
        "resolved_by_user_id" uuid,
        "expires_at" timestamptz,
        "created_by_user_id" uuid,
        "manual_title" character varying(140),
        "manual_body" text,
        "manual_audience" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_alerts" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_alerts_tenant_id" UNIQUE ("tenant_id", "id"),
        CONSTRAINT "CHK_alerts_source" CHECK ("source" IN ('RULE','MANUAL')),
        CONSTRAINT "CHK_alerts_severity" CHECK ("severity" IN ('CRITICAL','WARNING','REMINDER')),
        CONSTRAINT "CHK_alerts_category" CHECK ("category" IN ('SETUP','SYSTEM','STRUCTURE','ATTENDANCE','PERIOD','HOMEWORK','CLASS','STUDY_PLAN','FEES','EXAMS','OFFICE','FAMILY','COMMON','PLATFORM','BILLING','MANUAL')),
        CONSTRAINT "CHK_alerts_status" CHECK ("status" IN ('ACTIVE','RESOLVED','EXPIRED','WITHDRAWN'))
      )
    `);
    await this.fk(q, 'alerts', 'tenant_id', 'schools', 'CASCADE');
    await this.fk(q, 'alerts', 'resolved_by_user_id', 'users', 'SET NULL');
    await this.fk(q, 'alerts', 'created_by_user_id', 'users', 'SET NULL');
    await q.query(
      `CREATE UNIQUE INDEX "UQ_alerts_active_dedupe" ON "alerts" ("tenant_id", "rule_key", "dedupe_key") WHERE "status" = 'ACTIVE'`,
    );
    await q.query(
      `CREATE INDEX "IDX_alerts_tenant_status_rule" ON "alerts" ("tenant_id", "status", "rule_key")`,
    );
    await q.query(
      `CREATE INDEX "IDX_alerts_tenant_subject_active" ON "alerts" ("tenant_id", "subject_type", "subject_id") WHERE "status" = 'ACTIVE'`,
    );
    await q.query(`CREATE INDEX "IDX_alerts_tenant_raised" ON "alerts" ("tenant_id", "raised_at")`);

    await q.query(`
      CREATE TABLE "alert_recipients" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "alert_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "role" character varying(20),
        "student_id" uuid,
        "state" character varying(10) NOT NULL DEFAULT 'OPEN',
        "seen_at" timestamptz,
        "hidden_at" timestamptz,
        "snoozed_until" timestamptz,
        "pushed_at" timestamptz,
        "sms_sent_at" timestamptz,
        "resolved_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_alert_recipients" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_alert_recipients_role" CHECK ("role" IS NULL OR "role" IN ('SUPER_ADMIN','ADMIN','ACCOUNTANT','TEACHER','PARENT','STUDENT','EXECUTIVE','OFFICE_STAFF','EXAM_CONTROLLER','COMMITTEE')),
        CONSTRAINT "CHK_alert_recipients_state" CHECK ("state" IN ('OPEN','HIDDEN','RESOLVED','EXPIRED'))
      )
    `);
    await this.fk(q, 'alert_recipients', 'tenant_id', 'schools', 'CASCADE');
    await this.fk(q, 'alert_recipients', 'user_id', 'users', 'CASCADE');
    await q.query(
      `ALTER TABLE "alert_recipients" ADD CONSTRAINT "FK_alert_recipients_alert" FOREIGN KEY ("tenant_id", "alert_id") REFERENCES "alerts"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await q.query(
      `CREATE UNIQUE INDEX "UQ_alert_recipients_alert_user_student" ON "alert_recipients" ("alert_id", "user_id", "student_id") NULLS NOT DISTINCT`,
    );
    await q.query(
      `CREATE INDEX "IDX_alert_recipients_tenant_user_state" ON "alert_recipients" ("tenant_id", "user_id", "state")`,
    );
    await q.query(
      `CREATE INDEX "IDX_alert_recipients_tenant_user_created" ON "alert_recipients" ("tenant_id", "user_id", "created_at")`,
    );
    // The FAST wakeSnoozed sweep: tenant's HIDDEN rows whose snooze has elapsed.
    await q.query(
      `CREATE INDEX "IDX_alert_recipients_tenant_snoozed" ON "alert_recipients" ("tenant_id", "snoozed_until") WHERE "state" = 'HIDDEN' AND "snoozed_until" IS NOT NULL`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "alert_recipients"`);
    await q.query(`DROP TABLE "alerts"`);
  }
}

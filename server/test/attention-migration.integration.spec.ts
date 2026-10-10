import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource, QueryRunner } from 'typeorm';
import { ALL_ENTITIES } from '@test/all-entities';
import { createTestModule } from '@test/helpers/module.helper';
import { SEED_TENANT_ID, SEED_ADMIN_USER_ID } from '@test/constants';
import { AttentionAlerts1791600000000 } from '../src/migrations/1791600000000-AttentionAlerts';

/**
 * [67.1.02] Runs the migration's `down` then `up` against the already-migrated
 * test database; the round trip always ends with the schema back in its "up"
 * state so later spec files on the same worker DB are unaffected.
 */
describe('AttentionAlerts1791600000000 (integration)', () => {
  let dataSource: DataSource;
  let queryRunner: QueryRunner;
  const migration = new AttentionAlerts1791600000000();
  let otherTenantId: string;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    dataSource = module.get(DataSource);
    queryRunner = dataSource.createQueryRunner();
    const [school] = await dataSource.query(
      `INSERT INTO schools (name, slug) VALUES ('Attention Other School', 'attention-other-' || substr(gen_random_uuid()::text, 1, 8)) RETURNING id`,
    );
    otherTenantId = school.id;
  }, 60000);

  afterAll(async () => {
    // Deleting the schools cascades to their alerts and recipients.
    await dataSource.query(`DELETE FROM alerts WHERE tenant_id IN ($1, $2)`, [
      SEED_TENANT_ID,
      otherTenantId,
    ]);
    await dataSource.query(`DELETE FROM schools WHERE id = $1`, [otherTenantId]);
    await queryRunner.release();
    await dataSource.destroy();
  });

  async function tableExists(name: string): Promise<boolean> {
    const rows = await dataSource.query(`SELECT to_regclass($1) AS t`, [`public.${name}`]);
    return rows[0].t !== null;
  }

  async function insertAlert(
    tenantId: string,
    opts: { dedupe?: string; status?: string; severity?: string } = {},
  ): Promise<string> {
    const [row] = await dataSource.query(
      `INSERT INTO alerts (tenant_id, rule_key, source, severity, category, status, dedupe_key)
       VALUES ($1, 'test.rule', 'RULE', $2, 'SETUP', $3, $4) RETURNING id`,
      [tenantId, opts.severity ?? 'WARNING', opts.status ?? 'ACTIVE', opts.dedupe ?? 'k1'],
    );
    return row.id;
  }

  function insertRecipient(
    tenantId: string,
    alertId: string,
    opts: { studentId?: string | null; role?: string | null } = {},
  ) {
    return dataSource.query(
      `INSERT INTO alert_recipients (tenant_id, alert_id, user_id, role, student_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [tenantId, alertId, SEED_ADMIN_USER_ID, opts.role ?? null, opts.studentId ?? null],
    );
  }

  const uuid = () => dataSource.query(`SELECT gen_random_uuid() AS id`).then((r) => r[0].id);

  it('down() removes both tables, up() restores them', async () => {
    try {
      await migration.down(queryRunner);
      expect(await tableExists('alerts')).toBe(false);
      expect(await tableExists('alert_recipients')).toBe(false);
      await migration.up(queryRunner);
      expect(await tableExists('alerts')).toBe(true);
      expect(await tableExists('alert_recipients')).toBe(true);
    } finally {
      // Never leave the shared worker DB half-migrated for later spec files.
      if (!(await tableExists('alerts')) || !(await tableExists('alert_recipients'))) {
        await queryRunner.query('DROP TABLE IF EXISTS "alert_recipients", "alerts"');
        await migration.up(queryRunner);
      }
    }
  });

  it('rejects two ACTIVE alerts with the same dedupe pair, accepts it once the first is RESOLVED', async () => {
    await insertAlert(SEED_TENANT_ID, { dedupe: 'dup-1' });
    await expect(insertAlert(SEED_TENANT_ID, { dedupe: 'dup-1' })).rejects.toThrow(
      /UQ_alerts_active_dedupe/,
    );
    await dataSource.query(
      `UPDATE alerts SET status = 'RESOLVED' WHERE tenant_id = $1 AND dedupe_key = 'dup-1'`,
      [SEED_TENANT_ID],
    );
    await expect(insertAlert(SEED_TENANT_ID, { dedupe: 'dup-1' })).resolves.toBeTruthy();
  });

  it('allows the same ACTIVE dedupe pair in two different tenants', async () => {
    await insertAlert(SEED_TENANT_ID, { dedupe: 'tenant-iso' });
    await expect(insertAlert(otherTenantId, { dedupe: 'tenant-iso' })).resolves.toBeTruthy();
  });

  it('treats NULL student_id as equal for the recipient unique (NULLS NOT DISTINCT)', async () => {
    const alertId = await insertAlert(SEED_TENANT_ID, { dedupe: 'rcpt-null' });
    await insertRecipient(SEED_TENANT_ID, alertId);
    await expect(insertRecipient(SEED_TENANT_ID, alertId)).rejects.toThrow(
      /UQ_alert_recipients_alert_user_student/,
    );
  });

  it('accepts the same user with two different student_ids', async () => {
    const alertId = await insertAlert(SEED_TENANT_ID, { dedupe: 'rcpt-students' });
    await insertRecipient(SEED_TENANT_ID, alertId, { studentId: await uuid() });
    await expect(
      insertRecipient(SEED_TENANT_ID, alertId, { studentId: await uuid() }),
    ).resolves.toBeTruthy();
  });

  it("rejects a recipient in tenant B pointing at tenant A's alert", async () => {
    const alertId = await insertAlert(SEED_TENANT_ID, { dedupe: 'cross-tenant' });
    await expect(insertRecipient(otherTenantId, alertId)).rejects.toThrow(
      /FK_alert_recipients_alert/,
    );
  });

  it('rejects an unknown severity and an unknown recipient role', async () => {
    await expect(
      insertAlert(SEED_TENANT_ID, { dedupe: 'bad-sev', severity: 'RED' }),
    ).rejects.toThrow(/CHK_alerts_severity/);
    const alertId = await insertAlert(SEED_TENANT_ID, { dedupe: 'bad-role' });
    await expect(insertRecipient(SEED_TENANT_ID, alertId, { role: 'NOPE' })).rejects.toThrow(
      /CHK_alert_recipients_role/,
    );
  });

  it('deleting an alert deletes its recipients', async () => {
    const alertId = await insertAlert(SEED_TENANT_ID, { dedupe: 'cascade' });
    await insertRecipient(SEED_TENANT_ID, alertId);
    await dataSource.query(`DELETE FROM alerts WHERE id = $1`, [alertId]);
    expect(
      await dataSource.query(`SELECT id FROM alert_recipients WHERE alert_id = $1`, [alertId]),
    ).toEqual([]);
  });
});

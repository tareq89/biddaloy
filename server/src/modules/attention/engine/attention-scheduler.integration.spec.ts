import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DataSource } from 'typeorm';
import Redis from 'ioredis';
import { AlertCadence } from '@biddaloy/shared';
import { ALL_ENTITIES } from '@test/all-entities';
import { createTestModule } from '@test/helpers/module.helper';
import { SEED_TENANT_ID } from '@test/constants';
import { TENANT_STATUS_REDIS } from '../../schools/tenant-status.service';
import { AlertWriterService } from './alert-writer.service';
import { AttentionScheduler } from './attention-scheduler';

const NOW = new Date('2026-10-10T05:00:00Z');
const monthsAgo = (m: number) => {
  const d = new Date(NOW);
  d.setMonth(d.getMonth() - m);
  return d;
};

describe('AttentionScheduler prune (integration)', () => {
  let ds: DataSource;
  let redis: Redis;
  let sched: AttentionScheduler;
  let tenantB: string;
  let userId: string;
  const localDate = '2026-10-10';

  beforeAll(async () => {
    redis = new Redis(process.env.REDIS_URL!);
    const module = await createTestModule(ALL_ENTITIES, [
      AlertWriterService,
      { provide: TENANT_STATUS_REDIS, useValue: redis },
    ]);
    ds = module.get(DataSource);
    const writer = module.get(AlertWriterService);
    // No rules: the DAILY sweep then only exercises the prune path.
    const registry = { forCadence: () => [] };
    const context = {
      build: async (tenantId: string, now: Date) => ({
        tenantId,
        now,
        tz: 'Asia/Dhaka',
        localDate,
        localTime: '11:00',
        isWorkingDay: true,
        settings: { dailyAt: '07:00', eveningAt: '17:00', rules: {} },
      }),
    };
    sched = new AttentionScheduler(
      {} as never,
      {} as never,
      registry as never,
      context as never,
      writer,
      redis,
      ds,
    );
    const [school] = await ds.query(
      `INSERT INTO schools (name, slug) VALUES ('Prune Other', 'prune-other-' || substr(gen_random_uuid()::text, 1, 8)) RETURNING id`,
    );
    tenantB = school.id;
    userId = (
      await ds.query(
        `INSERT INTO users (email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, 'x', 'Prune Test', 'ACTIVE', NOW(), NOW()) RETURNING id`,
        [`prune-${Date.now()}@example.com`],
      )
    )[0].id as string;
  }, 60000);

  afterAll(async () => {
    await ds.query(`DELETE FROM alerts WHERE tenant_id IN ($1, $2)`, [SEED_TENANT_ID, tenantB]);
    await ds.query(`DELETE FROM schools WHERE id = $1`, [tenantB]);
    await ds.query(`DELETE FROM users WHERE id = $1`, [userId]);
    redis.disconnect();
    await ds.destroy();
  });

  async function wipe() {
    await ds.query(`DELETE FROM alerts WHERE tenant_id IN ($1, $2)`, [SEED_TENANT_ID, tenantB]);
    const keys = await redis.keys('tenant:*:attention:daily:prune:*');
    if (keys.length) await redis.del(...keys);
  }
  beforeEach(wipe);

  async function alert(
    tenantId: string,
    status: string,
    raisedAt: Date,
    key: string,
    resolvedAt: Date | null = null,
  ) {
    const [a] = await ds.query(
      `INSERT INTO alerts (tenant_id, rule_key, source, severity, category, status, dedupe_key, raised_at, resolved_at)
       VALUES ($1, 'attendance.not_taken', 'RULE', 'WARNING', 'ATTENDANCE', $2, $3, $4, $5) RETURNING id`,
      [tenantId, status, key, raisedAt, resolvedAt],
    );
    await ds.query(
      `INSERT INTO alert_recipients (tenant_id, alert_id, user_id) VALUES ($1, $2, $3)`,
      [tenantId, a.id, userId],
    );
    return a.id as string;
  }
  const ids = async (tenantId: string) =>
    (await ds.query(`SELECT id FROM alerts WHERE tenant_id = $1`, [tenantId])).map(
      (r: { id: string }) => r.id,
    );

  it('prunes only old non-ACTIVE alerts of the swept tenant (recipients cascade)', async () => {
    const oldResolved = await alert(SEED_TENANT_ID, 'RESOLVED', monthsAgo(13), 'a');
    const oldActive = await alert(SEED_TENANT_ID, 'ACTIVE', monthsAgo(13), 'b');
    const recentResolved = await alert(SEED_TENANT_ID, 'RESOLVED', monthsAgo(11), 'c');
    const otherTenant = await alert(tenantB, 'RESOLVED', monthsAgo(13), 'd');

    await sched.sweepTenant(SEED_TENANT_ID, AlertCadence.DAILY, NOW);

    const remaining = await ids(SEED_TENANT_ID);
    expect(remaining).not.toContain(oldResolved);
    expect(remaining).toEqual(expect.arrayContaining([oldActive, recentResolved]));
    // Tenant isolation: tenant B's old row is untouched by A's sweep.
    expect(await ids(tenantB)).toEqual([otherTenant]);
    const rcp = await ds.query(`SELECT 1 FROM alert_recipients WHERE alert_id = $1`, [oldResolved]);
    expect(rcp).toHaveLength(0);
  });

  it('ages by close time: old alert resolved recently is kept', async () => {
    const keep = await alert(SEED_TENANT_ID, 'RESOLVED', monthsAgo(13), 'k', monthsAgo(0));
    const drop = await alert(SEED_TENANT_ID, 'RESOLVED', monthsAgo(14), 'x', monthsAgo(13));
    await sched.sweepTenant(SEED_TENANT_ID, AlertCadence.DAILY, NOW);
    const remaining = await ids(SEED_TENANT_ID);
    expect(remaining).toContain(keep);
    expect(remaining).not.toContain(drop);
  });

  it('a second DAILY tick on the same local day does not prune again', async () => {
    await sched.sweepTenant(SEED_TENANT_ID, AlertCadence.DAILY, NOW);
    const late = await alert(SEED_TENANT_ID, 'RESOLVED', monthsAgo(13), 'late');
    await sched.sweepTenant(SEED_TENANT_ID, AlertCadence.DAILY, new Date(NOW.getTime() + 900_000));
    expect(await ids(SEED_TENANT_ID)).toContain(late); // marker present, prune skipped
  });
});

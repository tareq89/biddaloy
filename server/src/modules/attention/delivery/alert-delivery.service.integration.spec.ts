import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { alertRuleMeta } from '@biddaloy/shared';
import { ALL_ENTITIES } from '@test/all-entities';
import { createTestModule } from '@test/helpers/module.helper';
import { SEED_TENANT_ID } from '@test/constants';
import { JOB_DELIVER_PUSH } from '../attention.constants';
import { AttentionQueryService } from '../api/attention-query.service';
import type { AttentionRule } from '../rules/rule.types';
import { AlertDeliveryService } from './alert-delivery.service';

const SMS_LOW = 'comms.sms_credit_low';
const mkRule = (key: string): AttentionRule => ({
  meta: alertRuleMeta(key as never),
  messages: {
    bn: { title: '{count} টি বার্তা', why: 'কারণ', steps: [] },
    en: { title: '{count} left', why: 'why', steps: [] },
  },
  evaluate: vi.fn(),
});
const rules = new Map(
  [SMS_LOW, 'system.backup_failed', 'homework.to_grade'].map((k) => [k, mkRule(k)]),
);

const DAY = '2026-10-09T04:00:00Z'; // 10:00 Dhaka, outside quiet hours
const NIGHT = '2026-10-09T16:00:00Z'; // 22:00 Dhaka, inside quiet hours

describe('AlertDeliveryService (integration)', () => {
  let ds: DataSource;
  let svc: AlertDeliveryService;
  let tenantB: string;
  let userId: string;
  let locale = 'en';
  const sendToUser = vi.fn();
  const queueAdd = vi.fn();

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get(DataSource);
    const query = new AttentionQueryService(
      ds,
      { get: (k: string) => rules.get(k) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const schools = {
      getResolvedSettings: async () => ({
        region: { timezone: 'Asia/Dhaka', locale },
        attention: { quietHours: { start: '21:00', end: '07:00' } },
      }),
    };
    svc = new AlertDeliveryService(
      ds,
      { add: queueAdd } as never,
      { sendToUser } as never,
      schools as never,
      query,
    );
    const [school] = await ds.query(
      `INSERT INTO schools (name, slug) VALUES ('Delivery Other', 'delivery-other-' || substr(gen_random_uuid()::text, 1, 8)) RETURNING id`,
    );
    tenantB = school.id;
    userId = (
      await ds.query(
        `INSERT INTO users (email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, 'x', 'Delivery User', 'ACTIVE', NOW(), NOW()) RETURNING id`,
        [`delivery-${Date.now()}@example.com`],
      )
    )[0].id;
  }, 60000);

  afterAll(async () => {
    await ds.query(`DELETE FROM alerts WHERE tenant_id IN ($1, $2)`, [SEED_TENANT_ID, tenantB]);
    await ds.query(`DELETE FROM schools WHERE id = $1`, [tenantB]);
    await ds.query(`DELETE FROM users WHERE id = $1`, [userId]);
    await ds.destroy();
  });

  beforeEach(async () => {
    locale = 'en';
    sendToUser.mockReset().mockResolvedValue({ accepted: 1, transient: 0, pruned: 0 });
    queueAdd.mockReset();
    await ds.query(`DELETE FROM alerts WHERE tenant_id IN ($1, $2)`, [SEED_TENANT_ID, tenantB]);
    await ds.query(`UPDATE users SET preferences = NULL WHERE id = $1`, [userId]);
  });

  async function add(
    o: {
      ruleKey?: string;
      severity?: string;
      category?: string;
      role?: string;
      actionUrl?: string | null;
      status?: string;
      tenantId?: string;
      params?: object;
    } = {},
  ): Promise<string> {
    const tenantId = o.tenantId ?? SEED_TENANT_ID;
    const [a] = await ds.query(
      `INSERT INTO alerts (tenant_id, rule_key, source, severity, category, status, dedupe_key, params, raised_at, action_url)
       VALUES ($1, $2, 'RULE', $3, $4, $5, gen_random_uuid()::text, $6, now(), $7) RETURNING id`,
      [
        tenantId,
        o.ruleKey ?? SMS_LOW,
        o.severity ?? 'WARNING',
        o.category ?? 'SYSTEM',
        o.status ?? 'ACTIVE',
        JSON.stringify(o.params ?? {}),
        o.actionUrl === undefined ? '/settings/sms' : o.actionUrl,
      ],
    );
    const [r] = await ds.query(
      `INSERT INTO alert_recipients (tenant_id, alert_id, user_id, role, state)
       VALUES ($1, $2, $3, $4, 'OPEN') RETURNING id`,
      [tenantId, a.id, userId, o.role ?? 'ADMIN'],
    );
    return r.id;
  }
  const pushedAt = async (id: string) =>
    (await ds.query(`SELECT pushed_at FROM alert_recipients WHERE id = $1`, [id]))[0].pushed_at;

  it('pushes once with the alert url and stamps pushed_at; a second deliver is a no-op', async () => {
    const id = await add();
    await svc.deliver(SEED_TENANT_ID, [id], new Date(DAY));
    expect(sendToUser).toHaveBeenCalledTimes(1);
    expect(sendToUser.mock.calls[0][2]).toMatchObject({
      type: `attention.${SMS_LOW}`,
      url: '/settings/sms',
    });
    expect(await pushedAt(id)).not.toBeNull();
    await svc.deliver(SEED_TENANT_ID, [id], new Date(DAY));
    expect(sendToUser).toHaveBeenCalledTimes(1);
  });

  it('two concurrent deliveries of one recipient push once (atomic claim)', async () => {
    const id = await add();
    await Promise.all([
      svc.deliver(SEED_TENANT_ID, [id], new Date(DAY)),
      svc.deliver(SEED_TENANT_ID, [id], new Date(DAY)),
    ]);
    expect(sendToUser).toHaveBeenCalledTimes(1);
  });

  it('skips non-pushable rules and leaves pushed_at NULL', async () => {
    const id = await add({
      ruleKey: 'homework.to_grade',
      severity: 'REMINDER',
      category: 'HOMEWORK',
    });
    await svc.deliver(SEED_TENANT_ID, [id], new Date(DAY));
    expect(sendToUser).not.toHaveBeenCalled();
    expect(await pushedAt(id)).toBeNull();
  });

  it('muted category blocks WARNING but never CRITICAL (D26)', async () => {
    await ds.query(`UPDATE users SET preferences = $2 WHERE id = $1`, [
      userId,
      JSON.stringify({ notifications: { mutedCategories: ['SYSTEM'] } }),
    ]);
    const warn = await add();
    const crit = await add({ ruleKey: 'system.backup_failed', severity: 'CRITICAL' });
    await svc.deliver(SEED_TENANT_ID, [warn, crit], new Date(DAY));
    expect(sendToUser).toHaveBeenCalledTimes(1);
    expect(sendToUser.mock.calls[0][2].type).toBe('attention.system.backup_failed');
    expect(await pushedAt(warn)).toBeNull();
  });

  it('defers to the end of quiet hours, and only pushes if still OPEN+ACTIVE when the job runs', async () => {
    const id = await add();
    await svc.deliver(SEED_TENANT_ID, [id], new Date(NIGHT));
    expect(sendToUser).not.toHaveBeenCalled();
    expect(queueAdd).toHaveBeenCalledWith(
      JOB_DELIVER_PUSH,
      { tenantId: SEED_TENANT_ID, recipientId: id },
      // removeOnFail: a failed job kept under the fixed jobId would swallow the next push
      expect.objectContaining({ jobId: `push-${id}`, delay: 9 * 3600 * 1000, removeOnFail: true }),
    );
    const job = { name: JOB_DELIVER_PUSH, data: { tenantId: SEED_TENANT_ID, recipientId: id } };

    // Resolved overnight: the job pushes nothing.
    await ds.query(`UPDATE alerts SET status = 'RESOLVED' WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    await svc.process(job as never);
    expect(sendToUser).not.toHaveBeenCalled();

    // Still active at 07:00 Dhaka: pushed.
    await ds.query(`UPDATE alerts SET status = 'ACTIVE' WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    await svc.deliver(SEED_TENANT_ID, [id], new Date('2026-10-10T01:00:00Z'));
    expect(sendToUser).toHaveBeenCalledTimes(1);
  });

  it('a deferred job pushes even if it wakes inside quiet hours (no same-jobId re-queue)', async () => {
    const id = await add();
    await svc.deliver(SEED_TENANT_ID, [id], new Date(NIGHT), true);
    // Re-adding `push-<id>` while that job is active would be dropped by BullMQ.
    expect(queueAdd).not.toHaveBeenCalled();
    expect(sendToUser).toHaveBeenCalledTimes(1);
  });

  it('ignores a recipient id from another tenant (tenant isolation)', async () => {
    const idB = await add({ tenantId: tenantB });
    await svc.deliver(SEED_TENANT_ID, [idB], new Date(DAY));
    expect(sendToUser).not.toHaveBeenCalled();
    expect(await pushedAt(idB)).toBeNull();
  });

  it('PARENT without action_url falls back to the portal inbox', async () => {
    const id = await add({ role: 'PARENT', actionUrl: null });
    await svc.deliver(SEED_TENANT_ID, [id], new Date(DAY));
    expect(sendToUser.mock.calls[0][2].url).toBe('/portal');
  });

  it('renders with the tenant locale (bn-BD -> Bangla digits)', async () => {
    locale = 'bn-BD';
    const id = await add({ params: { count: 5 } });
    await svc.deliver(SEED_TENANT_ID, [id], new Date(DAY));
    expect(sendToUser.mock.calls[0][2].title).toContain('৫');
  });
});

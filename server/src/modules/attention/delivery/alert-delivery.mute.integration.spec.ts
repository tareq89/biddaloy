import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { AlertCategory, alertRuleMeta } from '@biddaloy/shared';
import { ALL_ENTITIES } from '@test/all-entities';
import { createTestModule } from '@test/helpers/module.helper';
import { SEED_TENANT_ID } from '@test/constants';
import { School } from '../../schools/entities/school.entity';
import { User } from '../../users/entities/user.entity';
import { UserTenant } from '../../auth/entities/user-tenant.entity';
import { UserService } from '../../users/users.service';
import { AttentionQueryService } from '../api/attention-query.service';
import type { AttentionRule } from '../rules/rule.types';
import { AlertDeliveryService } from './alert-delivery.service';

// [67.5.10] The push mute end to end: the user saves it through the real
// preferences service, the real delivery service reads it back from the DB.
const mkRule = (key: string): AttentionRule => ({
  meta: alertRuleMeta(key as never),
  messages: {
    bn: { title: 'শিরোনাম', why: 'কারণ', steps: [] },
    en: { title: 'Title', why: 'why', steps: [] },
  },
  evaluate: vi.fn(),
});
const rules = new Map(
  ['homework.not_submitted', 'attendance.not_taken', 'routine.uncovered_periods'].map((k) => [
    k,
    mkRule(k),
  ]),
);
const DAY = '2026-10-09T04:00:00Z'; // 10:00 Dhaka, outside quiet hours

describe('push mute (integration)', () => {
  let ds: DataSource;
  let svc: AlertDeliveryService;
  let users: UserService;
  let userId: string;
  const sendToUser = vi.fn();

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
        region: { timezone: 'Asia/Dhaka', locale: 'en' },
        attention: { quietHours: { start: '21:00', end: '07:00' } },
      }),
    };
    svc = new AlertDeliveryService(
      ds,
      { add: vi.fn() } as never,
      { sendToUser } as never,
      schools as never,
      query,
    );
    users = new UserService(
      ds.getRepository(User),
      ds.getRepository(UserTenant),
      ds.getRepository(School),
      {} as never,
      {} as never,
    );
    [{ id: userId }] = await ds.query(
      `INSERT INTO users (email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, 'x', 'Mute Teacher', 'ACTIVE', NOW(), NOW()) RETURNING id`,
      [`mute-${Date.now()}@example.com`],
    );
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role) VALUES ($1, $2, 'TEACHER')`,
      [userId, SEED_TENANT_ID],
    );
  }, 60000);

  afterAll(async () => {
    await ds.query(`DELETE FROM alerts WHERE tenant_id = $1 AND dedupe_key LIKE 'mute-%'`, [
      SEED_TENANT_ID,
    ]);
    await ds.query(`DELETE FROM user_tenants WHERE user_id = $1`, [userId]);
    await ds.query(`DELETE FROM users WHERE id = $1`, [userId]);
    await ds.destroy();
  });

  beforeEach(() => {
    sendToUser.mockReset().mockResolvedValue({ accepted: 1, transient: 0, pruned: 0 });
  });

  async function recipient(ruleKey: string, severity: string, category: string): Promise<string> {
    const [a] = await ds.query(
      `INSERT INTO alerts (tenant_id, rule_key, source, severity, category, status, dedupe_key, params, raised_at)
       VALUES ($1, $2, 'RULE', $3, $4, 'ACTIVE', 'mute-' || gen_random_uuid()::text, '{}', now()) RETURNING id`,
      [SEED_TENANT_ID, ruleKey, severity, category],
    );
    const [r] = await ds.query(
      `INSERT INTO alert_recipients (tenant_id, alert_id, user_id, role, state)
       VALUES ($1, $2, $3, 'TEACHER', 'OPEN') RETURNING id`,
      [SEED_TENANT_ID, a.id, userId],
    );
    return r.id;
  }

  it('a muted HOMEWORK warning sends no push; CRITICAL attendance and a PERIOD warning still do', async () => {
    // Same service call the PATCH /users/me/preferences/notifications route makes.
    const saved = await users.updateNotificationPrefs(userId, SEED_TENANT_ID, {
      mutedCategories: [AlertCategory.HOMEWORK],
    });
    expect(saved.mutedCategories).toEqual([AlertCategory.HOMEWORK]);

    const homework = await recipient('homework.not_submitted', 'WARNING', 'HOMEWORK');
    const critical = await recipient('attendance.not_taken', 'CRITICAL', 'ATTENDANCE');
    const period = await recipient('routine.uncovered_periods', 'WARNING', 'PERIOD');
    await svc.deliver(SEED_TENANT_ID, [homework, critical, period], new Date(DAY));

    const types = sendToUser.mock.calls.map((c) => c[2].type).sort();
    expect(types).toEqual([
      'attention.attendance.not_taken',
      'attention.routine.uncovered_periods',
    ]);
    const [{ pushed_at }] = await ds.query(`SELECT pushed_at FROM alert_recipients WHERE id = $1`, [
      homework,
    ]);
    expect(pushed_at).toBeNull();
  });
});

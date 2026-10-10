import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { DataSource } from 'typeorm';
import Redis from 'ioredis';
import { AlertSeverity, UserRole, alertRuleMeta } from '@biddaloy/shared';
import { ALL_ENTITIES } from '@test/all-entities';
import { createTestModule } from '@test/helpers/module.helper';
import { SEED_TENANT_ID } from '@test/constants';
import { TENANT_STATUS_REDIS } from '../../schools/tenant-status.service';
import {
  ATTENTION_RECIPIENTS_OPENED,
  AttentionRecipientsOpenedPayload,
  attentionEvents,
  attentionKeys,
} from '../attention.constants';
import { endOfLocalDay } from '../rules/rule-context.service';
import type { AttentionRule, RuleContext, RuleFinding } from '../rules/rule.types';
import { AlertWriterService, lockRule } from './alert-writer.service';

const RULE_KEY = 'attendance.not_taken';
const msg = { title: 't', why: 'w', steps: [] };
const rule: AttentionRule = {
  meta: alertRuleMeta(RULE_KEY),
  messages: { bn: msg, en: msg },
  evaluate: vi.fn(),
};

describe('AlertWriterService (integration)', () => {
  let ds: DataSource;
  let redis: Redis;
  let writer: AlertWriterService;
  let tenantB: string;
  let u1: string;
  let u2: string;
  let u3: string;
  let events: AttentionRecipientsOpenedPayload[];
  const onOpened = (p: AttentionRecipientsOpenedPayload) => events.push(p);

  beforeAll(async () => {
    redis = new Redis(process.env.REDIS_URL!);
    const module = await createTestModule(ALL_ENTITIES, [
      AlertWriterService,
      { provide: TENANT_STATUS_REDIS, useValue: redis },
    ]);
    ds = module.get(DataSource);
    writer = module.get(AlertWriterService);
    const [school] = await ds.query(
      `INSERT INTO schools (name, slug) VALUES ('Writer Other', 'writer-other-' || substr(gen_random_uuid()::text, 1, 8)) RETURNING id`,
    );
    tenantB = school.id;
    const mkUser = async (n: string) =>
      (
        await ds.query(
          `INSERT INTO users (email, password_hash, full_name, status, created_at, updated_at)
           VALUES ($1, 'x', 'Writer Test', 'ACTIVE', NOW(), NOW()) RETURNING id`,
          [`writer-${n}-${Date.now()}@example.com`],
        )
      )[0].id as string;
    [u1, u2, u3] = [await mkUser('1'), await mkUser('2'), await mkUser('3')];
  }, 60000);

  afterAll(async () => {
    await ds.query(`DELETE FROM alerts WHERE tenant_id IN ($1, $2)`, [SEED_TENANT_ID, tenantB]);
    await ds.query(`DELETE FROM schools WHERE id = $1`, [tenantB]);
    await ds.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[u1, u2, u3]]);
    redis.disconnect();
    await ds.destroy();
  });

  beforeEach(async () => {
    events = [];
    attentionEvents.on(ATTENTION_RECIPIENTS_OPENED, onOpened);
    await ds.query(`DELETE FROM alerts WHERE tenant_id IN ($1, $2)`, [SEED_TENANT_ID, tenantB]);
  });
  afterEach(() => {
    attentionEvents.off(ATTENTION_RECIPIENTS_OPENED, onOpened);
  });

  const ctx = (
    now: string,
    extra: Partial<RuleContext> = {},
    tenantId = SEED_TENANT_ID,
  ): RuleContext => ({
    tenantId,
    now: new Date(now),
    tz: 'Asia/Dhaka',
    localDate: '2026-10-01',
    localTime: '06:00',
    isWorkingDay: true,
    settings: {} as RuleContext['settings'],
    ...extra,
  });
  const finding = (extra: Partial<RuleFinding> = {}): RuleFinding => ({
    dedupeKey: 'k1',
    params: { count: 3 },
    recipients: [
      { userId: u1, role: UserRole.TEACHER },
      { userId: u2, role: UserRole.ADMIN },
    ],
    ...extra,
  });
  const NOW = '2026-10-01T00:00:00Z';
  const alerts = (tenantId = SEED_TENANT_ID) =>
    ds.query(`SELECT * FROM alerts WHERE tenant_id = $1 ORDER BY created_at`, [tenantId]);
  const recipients = (tenantId = SEED_TENANT_ID) =>
    ds.query(`SELECT * FROM alert_recipients WHERE tenant_id = $1 ORDER BY created_at`, [tenantId]);

  it('first apply inserts an ACTIVE alert with meta severity, OPEN recipients and one OPENED event', async () => {
    const res = await writer.apply(ctx(NOW), rule, [finding()]);
    const [a] = await alerts();
    const rs = await recipients();
    expect(res).toMatchObject({ created: 1, updated: 0, resolved: 0 });
    expect(a.status).toBe('ACTIVE');
    expect(a.severity).toBe(rule.meta.severity);
    expect(rs.map((r: any) => r.state)).toEqual(['OPEN', 'OPEN']);
    expect(events).toHaveLength(1);
    expect(events[0].tenantId).toBe(SEED_TENANT_ID);
    expect([...events[0].recipientIds].sort()).toEqual(rs.map((r: any) => r.id).sort());
  });

  it('a finding with no recipients still persists the alert, without an event', async () => {
    await writer.apply(ctx(NOW), rule, [finding({ recipients: [] })]);
    expect(await alerts()).toHaveLength(1);
    expect(await recipients()).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it('an identical second run writes nothing', async () => {
    await writer.apply(ctx(NOW), rule, [finding()]);
    const before = await alerts();
    events = [];
    const res = await writer.apply(ctx('2026-10-01T00:05:00Z'), rule, [finding()]);
    const after = await alerts();
    expect(res).toMatchObject({ created: 0, updated: 0, resolved: 0, openedRecipientIds: [] });
    expect(after).toHaveLength(1);
    expect(after[0].updated_at).toEqual(before[0].updated_at); // D7: write only on change
    expect(await recipients()).toHaveLength(2);
    expect(events).toHaveLength(0);
  });

  it('a params change updates params and leaves recipients alone', async () => {
    await writer.apply(ctx(NOW), rule, [finding()]);
    const rsBefore = await recipients();
    events = [];
    const res = await writer.apply(ctx(NOW), rule, [finding({ params: { count: 4 } })]);
    expect(res.updated).toBe(1);
    expect((await alerts())[0].params).toEqual({ count: 4 });
    expect(await recipients()).toEqual(rsBefore);
    expect(events).toHaveLength(0);
  });

  it('resolves a vanished finding with the actor, or NULL without one', async () => {
    await writer.apply(ctx(NOW), rule, [finding()]);
    const res = await writer.apply(ctx(NOW, { actorUserId: u1 }), rule, []);
    expect(res.resolved).toBe(1);
    const [a] = await alerts();
    expect(a.status).toBe('RESOLVED');
    expect(a.resolved_by_user_id).toBe(u1);
    expect((await recipients()).map((r: any) => r.state)).toEqual(['RESOLVED', 'RESOLVED']);

    await writer.apply(ctx(NOW), rule, [finding({ dedupeKey: 'k2' })]);
    await writer.apply(ctx(NOW), rule, []);
    const k2 = (await alerts()).find((x: any) => x.dedupe_key === 'k2');
    expect(k2.status).toBe('RESOLVED');
    expect(k2.resolved_by_user_id).toBeNull();
  });

  it('a returning condition makes a NEW active row and keeps the resolved history', async () => {
    await writer.apply(ctx(NOW), rule, [finding()]);
    await writer.apply(ctx(NOW), rule, []);
    await writer.apply(ctx(NOW), rule, [finding()]);
    const rows = await alerts();
    expect(rows.map((r: any) => r.status).sort()).toEqual(['ACTIVE', 'RESOLVED']);
  });

  it('escalation raises severity, re-opens hidden recipients, re-arms push and adds recipients', async () => {
    await writer.apply(ctx(NOW), rule, [finding({ severity: AlertSeverity.REMINDER })]);
    await ds.query(
      `UPDATE alert_recipients SET state = 'HIDDEN', hidden_at = now(), pushed_at = now() WHERE tenant_id = $1 AND user_id = $2`,
      [SEED_TENANT_ID, u1],
    );
    await ds.query(
      `UPDATE alert_recipients SET pushed_at = now() WHERE tenant_id = $1 AND user_id = $2`,
      [SEED_TENANT_ID, u2],
    );
    events = [];
    await writer.apply(ctx(NOW), rule, [
      finding({
        severity: AlertSeverity.CRITICAL,
        escalationLevel: 2,
        recipients: [
          { userId: u1, role: UserRole.TEACHER },
          { userId: u2, role: UserRole.ADMIN },
          { userId: u3, role: UserRole.EXECUTIVE },
        ],
      }),
    ]);
    const [a] = await alerts();
    const rs = await recipients();
    expect(a.severity).toBe('CRITICAL');
    expect(a.escalation_level).toBe(2);
    expect(rs).toHaveLength(3);
    expect(rs.every((r: any) => r.state === 'OPEN' && r.pushed_at === null)).toBe(true);
    expect(events).toHaveLength(1);
    expect([...events[0].recipientIds].sort()).toEqual(rs.map((r: any) => r.id).sort());
  });

  it('resolves only the recipient the finding dropped', async () => {
    await writer.apply(ctx(NOW), rule, [finding()]);
    await writer.apply(ctx(NOW), rule, [
      finding({ recipients: [{ userId: u1, role: UserRole.TEACHER }] }),
    ]);
    const byUser = Object.fromEntries((await recipients()).map((r: any) => [r.user_id, r.state]));
    expect(byUser).toEqual({ [u1]: 'OPEN', [u2]: 'RESOLVED' });
  });

  it('a recipient dropped and then re-added is OPEN again and announced', async () => {
    const both = finding();
    const onlyU1 = finding({ recipients: [{ userId: u1, role: UserRole.TEACHER }] });
    await writer.apply(ctx(NOW), rule, [both]);
    await writer.apply(ctx(NOW), rule, [onlyU1]);
    events = [];
    const res = await writer.apply(ctx(NOW), rule, [both]);
    const u2Row = (await recipients()).find((r: any) => r.user_id === u2);
    expect(u2Row.state).toBe('OPEN');
    expect(u2Row.resolved_at).toBeNull();
    expect(res.openedRecipientIds).toEqual([u2Row.id]);
    expect(await recipients()).toHaveLength(2); // revived, not duplicated
  });

  it('concurrent applies for one tenant+rule never leave OPEN recipients on a closed alert', async () => {
    await Promise.all([
      writer.apply(ctx(NOW), rule, [
        finding({
          recipients: [
            { userId: u1, role: null },
            { userId: u3, role: null },
          ],
        }),
      ]),
      writer.apply(ctx(NOW), rule, []),
    ]);
    const bad = await ds.query(
      `SELECT 1 FROM alert_recipients r JOIN alerts a ON a.id = r.alert_id
        WHERE r.tenant_id = $1 AND r.state = 'OPEN' AND a.status <> 'ACTIVE'`,
      [SEED_TENANT_ID],
    );
    expect(bad).toHaveLength(0);
  });

  it('expireDue and withdrawRule wait for an in-flight apply of the same rule (shared rule lock)', async () => {
    await writer.apply(ctx(NOW), rule, [finding({ expiresAt: new Date('2026-10-02T00:00:00Z') })]);
    const closers = [
      () => writer.expireDue(SEED_TENANT_ID, new Date('2026-10-03T00:00:00Z')),
      () => writer.withdrawRule(SEED_TENANT_ID, RULE_KEY),
    ];
    for (const close of closers) {
      // Stands in for an apply that holds the rule lock mid-transaction.
      const qr = ds.createQueryRunner();
      await qr.connect();
      await qr.startTransaction();
      try {
        await lockRule(qr.manager, SEED_TENANT_ID, RULE_KEY);
        let done = false;
        const closing = close().then(() => (done = true));
        await new Promise((r) => setTimeout(r, 300));
        // Without the lock the close would already have rewritten the rows under apply.
        expect(done).toBe(false);
        await qr.commitTransaction();
        await closing;
      } finally {
        await qr.release();
      }
    }
    expect((await alerts())[0].status).toBe('EXPIRED');
  });

  // Smoke test only: Promise.all rarely hits apply's read/write window. The deterministic
  // guard for the rule lock is the 'wait for an in-flight apply' test above; keep that one.
  it('apply racing expireDue and withdrawRule never leaves OPEN recipients on a closed alert', async () => {
    await writer.apply(ctx('2026-09-30T00:00:00Z'), rule, [
      finding({ expiresAt: new Date('2026-10-01T00:00:00Z') }),
    ]);
    await Promise.all([
      writer.apply(ctx(NOW), rule, [
        finding({
          recipients: [
            { userId: u1, role: null },
            { userId: u3, role: null },
          ],
        }),
      ]),
      writer.expireDue(SEED_TENANT_ID, new Date(NOW)),
      writer.withdrawRule(SEED_TENANT_ID, RULE_KEY),
    ]);
    const bad = await ds.query(
      `SELECT 1 FROM alert_recipients r JOIN alerts a ON a.id = r.alert_id
        WHERE r.tenant_id = $1 AND r.state IN ('OPEN','HIDDEN') AND a.status <> 'ACTIVE'`,
      [SEED_TENANT_ID],
    );
    expect(bad).toHaveLength(0);
  });

  it('an already-expired finding is treated as gone: no raise, and a live alert resolves', async () => {
    await writer.apply(ctx(NOW), rule, [finding()]);
    // else: FAST sweep expires it, next run re-raises and re-pushes, every cycle
    const res = await writer.apply(ctx(NOW), rule, [finding({ expiresAt: new Date(NOW) })]);
    expect(res).toMatchObject({ created: 0, resolved: 1 });
    expect((await alerts()).map((a: any) => a.status)).toEqual(['RESOLVED']);
  });

  it('expires at the Asia/Dhaka midnight boundary to the second', async () => {
    const expiresAt = endOfLocalDay('2026-10-09', 'Asia/Dhaka');
    expect(expiresAt.toISOString()).toBe('2026-10-09T18:00:00.000Z');
    await writer.apply(ctx(NOW), rule, [finding({ expiresAt })]);
    await writer.expireDue(SEED_TENANT_ID, new Date('2026-10-09T17:59:59Z'));
    expect((await alerts())[0].status).toBe('ACTIVE');
    await writer.expireDue(SEED_TENANT_ID, new Date('2026-10-09T18:00:00Z'));
    expect((await alerts())[0].status).toBe('EXPIRED');
    expect((await recipients()).map((r: any) => r.state)).toEqual(['EXPIRED', 'EXPIRED']);
  });

  it('default TTL: 7 days, bumped when under a day away, otherwise left alone', async () => {
    await writer.apply(ctx('2026-10-01T00:00:00Z'), rule, [finding()]);
    expect((await alerts())[0].expires_at.toISOString()).toBe('2026-10-08T00:00:00.000Z');
    await writer.apply(ctx('2026-10-07T12:00:00Z'), rule, [finding()]);
    expect((await alerts())[0].expires_at.toISOString()).toBe('2026-10-14T12:00:00.000Z');
    // not bumped: still > 1 day away
    await ds.query(`UPDATE alerts SET expires_at = '2026-10-08T00:00:00Z' WHERE tenant_id = $1`, [
      SEED_TENANT_ID,
    ]);
    await writer.apply(ctx('2026-10-03T00:00:00Z'), rule, [finding()]);
    expect((await alerts())[0].expires_at.toISOString()).toBe('2026-10-08T00:00:00.000Z');
  });

  it('wakeSnoozed opens elapsed snoozes only, never closed-without-snooze, and emits no event', async () => {
    await writer.apply(ctx(NOW), rule, [finding()]);
    await ds.query(
      `UPDATE alert_recipients SET state = 'HIDDEN', hidden_at = now(), snoozed_until = '2026-10-10T01:00:00Z'
        WHERE tenant_id = $1 AND user_id = $2`,
      [SEED_TENANT_ID, u1],
    );
    await ds.query(
      `UPDATE alert_recipients SET state = 'HIDDEN', hidden_at = now() WHERE tenant_id = $1 AND user_id = $2`,
      [SEED_TENANT_ID, u2],
    );
    events = [];
    const stateOf = async (u: string) =>
      (await recipients()).find((r: any) => r.user_id === u).state;
    await writer.wakeSnoozed(SEED_TENANT_ID, new Date('2026-10-10T00:59:59Z'));
    expect(await stateOf(u1)).toBe('HIDDEN');
    await writer.wakeSnoozed(SEED_TENANT_ID, new Date('2026-10-10T01:00:00Z'));
    expect(await stateOf(u1)).toBe('OPEN');
    expect(await stateOf(u2)).toBe('HIDDEN');
    expect(events).toHaveLength(0);
  });

  it('wakeSnoozed skips a recipient row another writer holds instead of waiting on it (no deadlock)', async () => {
    await writer.apply(ctx(NOW), rule, [finding()]);
    await ds.query(
      `UPDATE alert_recipients SET state = 'HIDDEN', hidden_at = now(), snoozed_until = '2026-10-01T00:00:00Z'
        WHERE tenant_id = $1`,
      [SEED_TENANT_ID],
    );
    // Stands in for apply/closeAlerts holding u1's row mid-transaction.
    const qr = ds.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      await qr.query(
        `SELECT 1 FROM alert_recipients WHERE tenant_id = $1 AND user_id = $2 FOR UPDATE`,
        [SEED_TENANT_ID, u1],
      );
      // Returns without blocking: only u2 is woken, u1 waits for the next tick.
      expect(await writer.wakeSnoozed(SEED_TENANT_ID, new Date(NOW))).toBe(1);
      await qr.commitTransaction();
    } finally {
      await qr.release();
    }
    expect(await writer.wakeSnoozed(SEED_TENANT_ID, new Date(NOW))).toBe(1);
    expect((await recipients()).map((r: any) => r.state)).toEqual(['OPEN', 'OPEN']);
  });

  it('withdrawRule marks the alert WITHDRAWN and expires its recipients', async () => {
    await writer.apply(ctx(NOW), rule, [finding()]);
    expect(await writer.withdrawRule(SEED_TENANT_ID, RULE_KEY)).toBe(1);
    const [a] = await alerts();
    expect(a.status).toBe('WITHDRAWN');
    expect(a.resolved_at).not.toBeNull(); // close time: prune ages by it
    expect((await recipients()).map((r: any) => r.state)).toEqual(['EXPIRED', 'EXPIRED']);
    expect(await writer.withdrawRule(SEED_TENANT_ID, RULE_KEY)).toBe(0);
  });

  it('is tenant-isolated: applying for A never touches B (apply, expire, withdraw, wake)', async () => {
    await writer.apply(ctx(NOW), rule, [finding()]);
    await writer.apply(ctx(NOW, {}, tenantB), rule, [finding()]);
    await ds.query(
      `UPDATE alert_recipients SET state = 'HIDDEN', snoozed_until = '2026-10-01T00:00:00Z' WHERE tenant_id = $1`,
      [tenantB],
    );
    const bBefore = await recipients(tenantB);

    await writer.apply(ctx(NOW), rule, []); // A resolves
    await writer.expireDue(SEED_TENANT_ID, new Date('2030-01-01T00:00:00Z'));
    await writer.withdrawRule(SEED_TENANT_ID, RULE_KEY);
    await writer.wakeSnoozed(SEED_TENANT_ID, new Date('2030-01-01T00:00:00Z'));

    expect((await alerts())[0].status).toBe('RESOLVED');
    const [b] = await alerts(tenantB);
    expect(b.status).toBe('ACTIVE');
    expect(await recipients(tenantB)).toEqual(bBefore);
  });

  it('never touches MANUAL alerts', async () => {
    const [m] = await ds.query(
      `INSERT INTO alerts (tenant_id, rule_key, source, severity, category, dedupe_key)
       VALUES ($1, $2, 'MANUAL', 'WARNING', 'MANUAL', 'm1') RETURNING id, updated_at`,
      [SEED_TENANT_ID, RULE_KEY], // same rule_key as the rule under test: only source='RULE' protects it
    );
    await writer.apply(ctx(NOW), rule, [finding({ dedupeKey: 'other' })]);
    await writer.apply(ctx(NOW), rule, []);
    const [row] = await ds.query(`SELECT * FROM alerts WHERE id = $1`, [m.id]);
    expect(row.status).toBe('ACTIVE');
    expect(row.updated_at).toEqual(m.updated_at);
  });

  it('clears the touched users summary cache for this tenant only', async () => {
    const keyA = attentionKeys.summary(SEED_TENANT_ID, u1, 'TEACHER');
    const keyB = attentionKeys.summary(tenantB, u1, 'TEACHER');
    await redis.set(keyA, '1');
    await redis.set(keyB, '1');
    await writer.apply(ctx(NOW), rule, [finding()]);
    expect(await redis.get(keyA)).toBeNull();
    expect(await redis.get(keyB)).toBe('1');
    await redis.del(keyB);
  });
});

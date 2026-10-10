import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { DataSource } from 'typeorm';
import Redis from 'ioredis';
import { AlertSeverity, UserRole, alertRuleMeta } from '@biddaloy/shared';
import { ALL_ENTITIES } from '@test/all-entities';
import { createTestModule } from '@test/helpers/module.helper';
import { SEED_TENANT_ID } from '@test/constants';
import { TENANT_STATUS_REDIS } from '../../schools/tenant-status.service';
import { localDate } from '../../attendance/attendance-policy.util';
import { attentionKeys } from '../attention.constants';
import { AlertWriterService } from '../engine/alert-writer.service';
import { localTimeHHmm } from '../rules/rule-context.service';
import type { AttentionRule } from '../rules/rule.types';
import { AttentionQueryService } from './attention-query.service';

const RULE_KEY = 'attendance.not_taken';
const FAKE_RULE: AttentionRule = {
  meta: alertRuleMeta(RULE_KEY),
  messages: {
    bn: { title: '{count} জন অনুপস্থিত', why: 'কারণ', steps: ['ধাপ {count}'], action: 'দেখুন' },
    en: { title: '{count} absent', why: 'why', steps: ['step {count}'], action: 'Open' },
  },
  evaluate: vi.fn(),
};

describe('AttentionQueryService (integration)', () => {
  let ds: DataSource;
  let redis: Redis;
  let writer: AlertWriterService;
  let svc: AttentionQueryService;
  let tenantB: string;
  let me: string;
  let other: string;

  beforeAll(async () => {
    redis = new Redis(process.env.REDIS_URL!);
    const module = await createTestModule(ALL_ENTITIES, [
      AlertWriterService,
      { provide: TENANT_STATUS_REDIS, useValue: redis },
    ]);
    ds = module.get(DataSource);
    writer = module.get(AlertWriterService);
    const registry = { get: (k: string) => (k === RULE_KEY ? FAKE_RULE : undefined) };
    const context = {
      build: async (tenantId: string, now: Date) => ({
        tenantId,
        now,
        tz: 'Asia/Dhaka',
        localDate: localDate(now, 'Asia/Dhaka'),
        localTime: localTimeHHmm(now, 'Asia/Dhaka'),
        settings: { dailyAt: '07:00' },
      }),
    };
    // Tenant default weekly off day is Friday.
    const calendar = {
      isNonWorkingDay: async ({ date }: { date: string }) =>
        new Date(`${date}T00:00:00Z`).getUTCDay() === 5,
    };
    const schools = { getResolvedSettings: async () => ({ region: { locale: 'en' } }) };
    svc = new AttentionQueryService(
      ds,
      registry as never,
      context as never,
      writer,
      calendar as never,
      {} as never,
      schools as never,
      redis,
    );
    const [school] = await ds.query(
      `INSERT INTO schools (name, slug) VALUES ('Query Other', 'query-other-' || substr(gen_random_uuid()::text, 1, 8)) RETURNING id`,
    );
    tenantB = school.id;
    const mkUser = async (n: string, name: string) =>
      (
        await ds.query(
          `INSERT INTO users (email, password_hash, full_name, status, created_at, updated_at)
           VALUES ($1, 'x', $2, 'ACTIVE', NOW(), NOW()) RETURNING id`,
          [`query-${n}-${Date.now()}@example.com`, name],
        )
      )[0].id as string;
    me = await mkUser('me', 'Query Me');
    other = await mkUser('other', 'Query Other');
  }, 60000);

  afterAll(async () => {
    await ds.query(`DELETE FROM alerts WHERE tenant_id IN ($1, $2)`, [SEED_TENANT_ID, tenantB]);
    await ds.query(`DELETE FROM schools WHERE id = $1`, [tenantB]);
    await ds.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[me, other]]);
    redis.disconnect();
    await ds.destroy();
  });

  beforeEach(async () => {
    await ds.query(`DELETE FROM alerts WHERE tenant_id IN ($1, $2)`, [SEED_TENANT_ID, tenantB]);
    await redis.del(
      ...Object.values(UserRole).map((r) => attentionKeys.summary(SEED_TENANT_ID, me, r)),
      attentionKeys.heartbeat('FAST'),
    );
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Inserts one alert + one recipient (for `userId`) and returns the recipient id. */
  async function add(
    o: {
      severity?: string;
      category?: string;
      status?: string;
      ruleKey?: string;
      source?: string;
      params?: object;
      raisedAt?: string;
      manualTitle?: string;
      subjectStudent?: string;
      resolvedBy?: string;
      userId?: string;
      role?: string | null;
      state?: string;
      studentId?: string;
      resolvedAt?: string;
      tenantId?: string;
    } = {},
  ): Promise<{ recipientId: string; alertId: string }> {
    const [a] = await ds.query(
      `INSERT INTO alerts (tenant_id, rule_key, source, severity, category, status, dedupe_key, params,
                           raised_at, manual_title, subject_type, subject_id, resolved_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, gen_random_uuid()::text, $7, $8, $9, $10, $11, $12) RETURNING id`,
      [
        o.tenantId ?? SEED_TENANT_ID,
        o.ruleKey ?? 'x.unknown',
        o.source ?? 'RULE',
        o.severity ?? 'WARNING',
        o.category ?? 'ATTENDANCE',
        o.status ?? 'ACTIVE',
        JSON.stringify(o.params ?? {}),
        o.raisedAt ?? '2026-10-08T00:00:00Z',
        o.manualTitle ?? null,
        o.subjectStudent ? 'student' : null,
        o.subjectStudent ?? null,
        o.resolvedBy ?? null,
      ],
    );
    const [r] = await ds.query(
      `INSERT INTO alert_recipients (tenant_id, alert_id, user_id, role, state, student_id, resolved_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        o.tenantId ?? SEED_TENANT_ID,
        a.id,
        o.userId ?? me,
        o.role === undefined ? 'TEACHER' : o.role,
        o.state ?? 'OPEN',
        o.studentId ?? null,
        o.resolvedAt ?? null,
      ],
    );
    return { recipientId: r.id, alertId: a.id };
  }
  const summary = (role = 'TEACHER') => svc.summary(SEED_TENANT_ID, me, role, {});
  const items = (q: object = {}, role = 'TEACHER') =>
    svc.items(SEED_TENANT_ID, me, role, { tab: 'active', page: 1, pageSize: 20, ...q });

  describe('summary', () => {
    it('counts OPEN per severity, tops with the CRITICAL one, and activeTotal also counts HIDDEN', async () => {
      await add({ severity: 'CRITICAL', params: { studentName: 'Rahim' } });
      await add({ severity: 'WARNING' });
      await add({ severity: 'REMINDER' });
      await add({ severity: 'WARNING', state: 'HIDDEN' });
      const s = await summary();
      expect([s.critical, s.warning, s.reminder]).toEqual([1, 1, 1]);
      expect(s.activeTotal).toBe(4); // HIDDEN raises the badge but not the bar
      expect(s.top?.severity).toBe('CRITICAL');
      expect(s.top?.studentName).toBe('Rahim');
      expect(s.top?.closable).toBe(false);
    });

    it('shows a personal (role NULL) item in every role of the same user', async () => {
      await add({ role: null, severity: 'WARNING' });
      expect((await summary('TEACHER')).warning).toBe(1);
      expect((await summary('ADMIN')).warning).toBe(1);
    });

    it('refuses another role than the active one', async () => {
      await expect(
        svc.summary(SEED_TENANT_ID, me, 'TEACHER', { role: UserRole.ADMIN }),
      ).rejects.toThrow(/active role/);
    });

    it('never counts another tenant or another user', async () => {
      await add({ userId: other });
      await add({ tenantId: tenantB });
      expect((await summary()).activeTotal).toBe(0);
    });

    it('caches for 60 s until invalidateSummary', async () => {
      await add();
      expect((await summary()).warning).toBe(1);
      await ds.query(`DELETE FROM alerts WHERE tenant_id = $1`, [SEED_TENANT_ID]);
      expect((await summary()).warning).toBe(1); // stale on purpose
      await writer.invalidateSummary(SEED_TENANT_ID, [me]);
      expect((await summary()).warning).toBe(0);
    });

    it('staleMinutes from the FAST heartbeat; 0 and null when there is none', async () => {
      expect(await summary()).toMatchObject({ updatedAt: null, staleMinutes: 0 });
      await redis.set(
        attentionKeys.heartbeat('FAST'),
        JSON.stringify({ at: '2026-10-09T04:00:00.000Z' }),
      );
      vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-09T04:20:00Z') });
      expect(await summary()).toMatchObject({
        updatedAt: '2026-10-09T04:00:00.000Z',
        staleMinutes: 20,
      });
    });
  });

  describe('items', () => {
    it('active tab: CRITICAL, WARNING, REMINDER, then oldest first; includes HIDDEN', async () => {
      await add({ severity: 'REMINDER', raisedAt: '2026-10-01T00:00:00Z' });
      await add({ severity: 'WARNING', raisedAt: '2026-10-05T00:00:00Z' });
      await add({ severity: 'WARNING', raisedAt: '2026-10-02T00:00:00Z', state: 'HIDDEN' });
      await add({ severity: 'CRITICAL', raisedAt: '2026-10-07T00:00:00Z' });
      await add({ severity: 'WARNING', state: 'RESOLVED', status: 'RESOLVED' });
      const { items: list, total } = await items();
      expect(total).toBe(4);
      expect(list.map((i) => [i.severity, i.raisedAt.slice(0, 10)])).toEqual([
        ['CRITICAL', '2026-10-07'],
        ['WARNING', '2026-10-02'],
        ['WARNING', '2026-10-05'],
        ['REMINDER', '2026-10-01'],
      ]);
    });

    it('history tab: RESOLVED/EXPIRED only, newest first, with resolvedByName', async () => {
      await add({
        state: 'RESOLVED',
        status: 'RESOLVED',
        resolvedAt: '2026-10-05T00:00:00Z',
        resolvedBy: other,
      });
      await add({ state: 'EXPIRED', status: 'EXPIRED', resolvedAt: '2026-10-07T00:00:00Z' });
      await add({ state: 'OPEN' });
      const { items: list } = await items({ tab: 'history' });
      expect(list.map((i) => i.state)).toEqual(['EXPIRED', 'RESOLVED']);
      expect(list[1].resolvedByName).toBe('Query Other');
    });

    it('filters by category, sectionId (params) and studentId (recipient.student_id)', async () => {
      const section = '11111111-1111-4111-8111-111111111111';
      const student = '22222222-2222-4222-8222-222222222222';
      await add({ category: 'FEES' });
      await add({ params: { sectionId: section } });
      await add({ studentId: student });
      expect((await items({ category: 'FEES' })).total).toBe(1);
      expect((await items({ sectionId: section })).total).toBe(1);
      expect((await items({ studentId: student })).total).toBe(1);
    });

    it('renders per locale: rule-less falls back to rule_key, MANUAL to manual_title, bn digits', async () => {
      await add({ ruleKey: 'gone.rule', severity: 'REMINDER' });
      await add({
        source: 'MANUAL',
        ruleKey: 'manual',
        manualTitle: 'Bring forms',
        severity: 'REMINDER',
      });
      await add({ ruleKey: RULE_KEY, params: { count: 4 }, severity: 'CRITICAL' });
      const titles = (await items({ locale: 'en' })).items.map((i) => i.title);
      expect(titles).toContain('4 absent');
      expect(titles).toContain('gone.rule');
      expect(titles).toContain('Bring forms');
      const bn = (await items({ locale: 'bn' })).items[0];
      expect(bn.title).toBe('৪ জন অনুপস্থিত');
      expect(bn.steps).toEqual(['ধাপ ৪']);
      expect(bn.actionLabel).toBe('দেখুন');
      expect((await items({ locale: 'en' })).items[0].title).toBe('4 absent');
    });
  });

  describe('hide / snooze / seen', () => {
    it('hide a CRITICAL -> 400; hide twice is idempotent; hide a RESOLVED -> 409', async () => {
      const crit = await add({ severity: 'CRITICAL' });
      await expect(svc.hide(SEED_TENANT_ID, me, crit.recipientId)).rejects.toThrow('not closable');
      const w = await add({ severity: 'WARNING' });
      const first = await svc.hide(SEED_TENANT_ID, me, w.recipientId);
      expect(first.state).toBe('HIDDEN');
      const second = await svc.hide(SEED_TENANT_ID, me, w.recipientId);
      expect(second).toEqual(first);
      const done = await add({ state: 'RESOLVED', status: 'RESOLVED' });
      await expect(svc.hide(SEED_TENANT_ID, me, done.recipientId)).rejects.toMatchObject({
        status: 409,
      });
    });

    it('hide/snooze on a non-ACTIVE alert is 409 (recipient still OPEN)', async () => {
      const { recipientId } = await add({ status: 'WITHDRAWN' });
      await expect(svc.hide(SEED_TENANT_ID, me, recipientId)).rejects.toMatchObject({
        status: 409,
      });
      await expect(
        svc.snooze(SEED_TENANT_ID, me, recipientId, { choice: 'TWO_HOURS' }),
      ).rejects.toMatchObject({ status: 409 });
    });

    it('hide loses the race to a resolver: UPDATE re-guards state and throws 409', async () => {
      const { recipientId } = await add();
      const realQuery = ds.query.bind(ds);
      let raced = false;
      // Resolver flips the row right after hide's SELECT and before its UPDATE.
      const spy = vi.spyOn(ds, 'query').mockImplementation(async (sql: string, p?: unknown[]) => {
        const out = await realQuery(sql, p);
        if (!raced && sql.includes('SELECT') && sql.includes('r.id = $1')) {
          raced = true;
          await realQuery(`UPDATE alert_recipients SET state = 'RESOLVED' WHERE id = $1`, [
            recipientId,
          ]);
        }
        return out;
      });
      try {
        await expect(svc.hide(SEED_TENANT_ID, me, recipientId)).rejects.toMatchObject({
          status: 409,
        });
      } finally {
        spy.mockRestore();
      }
      const [row] = await ds.query(`SELECT state FROM alert_recipients WHERE id = $1`, [
        recipientId,
      ]);
      expect(row.state).toBe('RESOLVED');
    });

    it("another user's recipient is 404, not 403", async () => {
      const theirs = await add({ userId: other });
      await expect(svc.hide(SEED_TENANT_ID, me, theirs.recipientId)).rejects.toMatchObject({
        status: 404,
      });
    });

    it('snooze choices (Thursday 23:30 Dhaka, Friday is off)', async () => {
      const now = new Date('2026-10-08T17:30:00Z');
      const { recipientId } = await add();
      const at = async (choice: 'TWO_HOURS' | 'TOMORROW_MORNING' | 'NEXT_SCHOOL_DAY') =>
        (await svc.snooze(SEED_TENANT_ID, me, recipientId, { choice }, now)).snoozedUntil;
      expect(await at('TOMORROW_MORNING')).toBe('2026-10-09T01:00:00.000Z');
      expect(await at('NEXT_SCHOOL_DAY')).toBe('2026-10-10T01:00:00.000Z');
      expect(await at('TWO_HOURS')).toBe('2026-10-08T19:30:00.000Z');
      // 02:00 Friday Dhaka, before dailyAt: "tomorrow morning" is this coming 07:00, not Saturday's
      const early = await svc.snooze(
        SEED_TENANT_ID,
        me,
        recipientId,
        { choice: 'TOMORROW_MORNING' },
        new Date('2026-10-08T20:00:00Z'),
      );
      expect(early.snoozedUntil).toBe('2026-10-09T01:00:00.000Z');
      const [row] = await ds.query(`SELECT state FROM alert_recipients WHERE id = $1`, [
        recipientId,
      ]);
      expect(row.state).toBe('HIDDEN');
    });

    it('snooze DATE must be after the tenant-local today and within 30 days', async () => {
      const { recipientId } = await add();
      const now = new Date('2026-10-08T18:30:00Z'); // 00:30 Friday Dhaka: local today is 2026-10-09
      const run = (date: string) =>
        svc.snooze(SEED_TENANT_ID, me, recipientId, { choice: 'DATE', date }, now);
      await expect(run('2026-10-09')).rejects.toMatchObject({ status: 400 });
      await expect(run('2026-11-09')).rejects.toMatchObject({ status: 400 });
      expect((await run('2026-10-12')).snoozedUntil).toBe('2026-10-12T01:00:00.000Z');
    });

    it('markSeen touches only the caller own unseen rows', async () => {
      const mine = await add();
      const theirs = await add({ userId: other });
      expect(
        await svc.markSeen(SEED_TENANT_ID, me, [mine.recipientId, theirs.recipientId]),
      ).toEqual({ updated: 1 });
      expect(await svc.markSeen(SEED_TENANT_ID, me, [mine.recipientId])).toEqual({ updated: 0 });
    });
  });

  describe('studentAlerts', () => {
    it('groups per alert with seenCount and recipientCount', async () => {
      const [section] = await ds.query(
        `SELECT id FROM class_sections WHERE tenant_id = $1 LIMIT 1`,
        [SEED_TENANT_ID],
      );
      const [stu] = await ds.query(
        `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id)
         VALUES ('Alert Student', $1, 9991, $2, $3) RETURNING id`,
        [`ALERT-${Date.now()}`, section.id, SEED_TENANT_ID],
      );
      try {
        const { alertId, recipientId } = await add({ subjectStudent: stu.id, studentId: stu.id });
        for (const [role, sid] of [
          ['ADMIN', stu.id],
          ['EXECUTIVE', null],
        ]) {
          await ds.query(
            `INSERT INTO alert_recipients (tenant_id, alert_id, user_id, role, student_id)
             VALUES ($1, $2, $3, $4, $5)`,
            [SEED_TENANT_ID, alertId, other, role, sid],
          );
        }
        // A recipient the rule dropped (RESOLVED, even if seen) is not "one of Y" any more.
        await ds.query(
          `INSERT INTO alert_recipients (tenant_id, alert_id, user_id, role, student_id, state, seen_at)
           VALUES ($1, $2, $3, 'TEACHER', NULL, 'RESOLVED', now())`,
          [SEED_TENANT_ID, alertId, me],
        );
        await svc.markSeen(SEED_TENANT_ID, me, [recipientId]);
        const res = await svc.studentAlerts(
          SEED_TENANT_ID,
          { userId: me, role: UserRole.ADMIN },
          stu.id,
          'en',
        );
        expect(res).toHaveLength(1);
        expect(res[0]).toMatchObject({ seenCount: 1, recipientCount: 3 });
        await expect(
          svc.studentAlerts(SEED_TENANT_ID, { userId: me, role: UserRole.PARENT }, stu.id),
        ).rejects.toMatchObject({ status: 403 });
      } finally {
        await ds.query(`DELETE FROM alerts WHERE tenant_id = $1`, [SEED_TENANT_ID]);
        await ds.query(`DELETE FROM students WHERE id = $1`, [stu.id]);
      }
    });
  });
});

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { DataSource } from 'typeorm';
import Redis from 'ioredis';
import { AlertSeverity, UserRole } from '@biddaloy/shared';
import { ALL_ENTITIES } from '@test/all-entities';
import { createTestModule } from '@test/helpers/module.helper';
import { SEED_TENANT_ID } from '@test/constants';
import { TENANT_STATUS_REDIS } from '../../schools/tenant-status.service';
import { AuditService } from '../../audit/audit.service';
import {
  ATTENTION_RECIPIENTS_OPENED,
  AttentionRecipientsOpenedPayload,
  attentionEvents,
  attentionKeys,
} from '../attention.constants';
import { AlertWriterService } from '../engine/alert-writer.service';
import { RuleContextService, addDaysIso } from '../rules/rule-context.service';
import { ManualAlertsService } from './manual-alerts.service';
import { CreateManualAlertDto } from './dto/manual-alert.dto';

const TZ = 'Asia/Dhaka';
const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());

describe('ManualAlertsService (integration)', () => {
  let ds: DataSource;
  let redis: Redis;
  let service: ManualAlertsService;
  let tenantB: string;
  let sectionId: string;
  let classId: string;
  let teacher: string;
  let teacher2: string;
  let inactive: string;
  let removed: string;
  let studentUser: string;
  let guardianUser: string;
  const audit = { record: vi.fn() };
  let events: AttentionRecipientsOpenedPayload[];
  const onOpened = (p: AttentionRecipientsOpenedPayload) => events.push(p);
  const stamp = Date.now();

  const mkUser = async (n: string, status = 'ACTIVE') =>
    (
      await ds.query(
        `INSERT INTO users (email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, 'x', $2, $3, NOW(), NOW()) RETURNING id`,
        [`manual-${n}-${stamp}@example.com`, `Manual ${n}`, status],
      )
    )[0].id as string;
  const member = (userId: string, role: UserRole, deleted = false, tenant = SEED_TENANT_ID) =>
    ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, deleted_at, created_at, updated_at)
       VALUES ($1, $2, $3, ${deleted ? 'NOW()' : 'NULL'}, NOW(), NOW())`,
      [userId, tenant, role],
    );
  const student = async (userId: string | null, status: string, roll: number) =>
    (
      await ds.query(
        `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id, user_id, enrollment_status)
         VALUES ('Manual Student', $1, $2, $3, $4, $5, $6) RETURNING id`,
        [`MAN-${stamp}-${roll}`, roll, sectionId, SEED_TENANT_ID, userId, status],
      )
    )[0].id as string;
  const guardian = async (studentId: string, userId: string | null) => {
    const [g] = await ds.query(
      `INSERT INTO guardians (full_name, relationship, user_id, tenant_id) VALUES ('Parent', 'Father', $1, $2) RETURNING id`,
      [userId, SEED_TENANT_ID],
    );
    await ds.query(`INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)`, [
      studentId,
      g.id,
    ]);
  };
  const dto = (over: Partial<CreateManualAlertDto> = {}): CreateManualAlertDto =>
    ({
      severity: AlertSeverity.WARNING,
      title: 'Classes start at 9:00',
      body: 'Rain delay.',
      audience: { roles: [UserRole.TEACHER] },
      expiresOn: today,
      ...over,
    }) as CreateManualAlertDto;
  const recipients = async (alertId: string) =>
    ds.query(`SELECT user_id, role, state, student_id FROM alert_recipients WHERE alert_id = $1`, [
      alertId,
    ]);

  beforeAll(async () => {
    redis = new Redis(process.env.REDIS_URL!);
    const module = await createTestModule(ALL_ENTITIES, [
      ManualAlertsService,
      AlertWriterService,
      { provide: TENANT_STATUS_REDIS, useValue: redis },
      { provide: AuditService, useValue: audit },
      {
        provide: RuleContextService,
        useValue: { build: async () => ({ tz: TZ, localDate: today }) },
      },
    ]);
    ds = module.get(DataSource);
    service = module.get(ManualAlertsService);
    [{ id: tenantB }] = await ds.query(
      `INSERT INTO schools (name, slug) VALUES ('Manual Other', 'manual-other-' || substr(gen_random_uuid()::text, 1, 8)) RETURNING id`,
    );
    const [year] = await ds.query(`SELECT id FROM academic_years WHERE tenant_id = $1 LIMIT 1`, [
      SEED_TENANT_ID,
    ]);
    [{ id: classId }] = await ds.query(
      `INSERT INTO classes (tenant_id, name, academic_year_id) VALUES ($1, 'Manual Class', $2) RETURNING id`,
      [SEED_TENANT_ID, year.id],
    );
    [{ id: sectionId }] = await ds.query(
      `INSERT INTO class_sections (tenant_id, class_id, section_name) VALUES ($1, $2, 'M') RETURNING id`,
      [SEED_TENANT_ID, classId],
    );
    [teacher, teacher2, inactive, removed, studentUser, guardianUser] = [
      await mkUser('t1'),
      await mkUser('t2'),
      await mkUser('inactive', 'INACTIVE'),
      await mkUser('removed'),
      await mkUser('student'),
      await mkUser('guardian'),
    ];
    await member(teacher, UserRole.TEACHER);
    await member(teacher2, UserRole.TEACHER);
    await member(inactive, UserRole.TEACHER);
    await member(removed, UserRole.TEACHER, true);
  }, 60000);

  afterAll(async () => {
    await ds.query(`DELETE FROM alerts WHERE tenant_id IN ($1, $2)`, [SEED_TENANT_ID, tenantB]);
    await ds.query(`DELETE FROM class_sections WHERE id = $1`, [sectionId]);
    await ds.query(`DELETE FROM classes WHERE id = $1`, [classId]);
    await ds.query(`DELETE FROM schools WHERE id = $1`, [tenantB]);
    await ds.query(`DELETE FROM users WHERE email LIKE $1`, [`manual-%-${stamp}@example.com`]);
    redis.disconnect();
    await ds.destroy();
  });

  beforeEach(async () => {
    events = [];
    audit.record.mockClear();
    attentionEvents.on(ATTENTION_RECIPIENTS_OPENED, onOpened);
    await ds.query(`DELETE FROM alerts WHERE tenant_id IN ($1, $2)`, [SEED_TENANT_ID, tenantB]);
    // students are truncated between tests
    await ds.query(`DELETE FROM students WHERE tenant_id = $1 AND full_name = 'Manual Student'`, [
      SEED_TENANT_ID,
    ]);
  });
  afterEach(() => attentionEvents.off(ATTENTION_RECIPIENTS_OPENED, onOpened));

  describe('audience resolution', () => {
    it('roles -> only ACTIVE users with a live membership of this school', async () => {
      const r = await service.preview(SEED_TENANT_ID, { roles: [UserRole.TEACHER] });
      // seed teachers may exist too: assert ours are in, the inactive / removed are out
      const sent = await service.send(SEED_TENANT_ID, teacher, dto());
      const ids = (await recipients(sent.id)).map((x) => x.user_id);
      expect(ids).toEqual(expect.arrayContaining([teacher, teacher2]));
      expect(ids).not.toContain(inactive);
      expect(ids).not.toContain(removed);
      expect(r.recipientCount).toBe(ids.length);
    });

    it('sectionIds -> active students with a login; a TRANSFERRED one is out', async () => {
      await student(studentUser, 'ACTIVE', 1);
      const gone = await mkUser('transferred');
      await member(gone, UserRole.STUDENT);
      await member(studentUser, UserRole.STUDENT);
      await student(gone, 'TRANSFERRED', 2);
      await student(null, 'ACTIVE', 3); // no login
      const ids = await userIds({ sectionIds: [sectionId] });
      expect(ids).toEqual([studentUser]);
      await ds.query(`DELETE FROM user_tenants WHERE user_id = ANY($1::uuid[])`, [
        [gone, studentUser],
      ]);
    });

    it('guardiansOfSectionIds -> guardians with a login only', async () => {
      const s1 = await student(null, 'ACTIVE', 4);
      const s2 = await student(null, 'ACTIVE', 5);
      await member(guardianUser, UserRole.PARENT);
      await guardian(s1, guardianUser);
      await guardian(s2, null); // no login
      expect(await userIds({ guardiansOfSectionIds: [sectionId] })).toEqual([guardianUser]);
      await ds.query(`DELETE FROM user_tenants WHERE user_id = $1`, [guardianUser]);
    });

    it('a user in roles AND userIds is one recipient', async () => {
      const ids = await userIds({ roles: [UserRole.TEACHER], userIds: [teacher] });
      expect(ids.filter((i) => i === teacher)).toHaveLength(1);
    });

    it('tenant isolation: another school sees nobody from this school', async () => {
      await student(studentUser, 'ACTIVE', 6);
      const r = await service.preview(tenantB, {
        roles: [UserRole.TEACHER],
        sectionIds: [sectionId],
        guardiansOfSectionIds: [sectionId],
        userIds: [teacher],
      });
      expect(r.recipientCount).toBe(0);
    });

    it('rejects an empty audience and SUPER_ADMIN', async () => {
      await expect(service.preview(SEED_TENANT_ID, {})).rejects.toThrow('Pick at least one group');
      await expect(
        service.preview(SEED_TENANT_ID, { roles: [UserRole.SUPER_ADMIN] }),
      ).rejects.toThrow('SUPER_ADMIN');
    });

    async function userIds(audience: CreateManualAlertDto['audience']) {
      const sent = await service.send(SEED_TENANT_ID, teacher, dto({ audience }));
      return (await recipients(sent.id)).map((x) => x.user_id as string);
    }
  });

  describe('send', () => {
    it('writes one MANUAL alert, personal recipients, an event, a cache purge and an audit row', async () => {
      const key = attentionKeys.summary(SEED_TENANT_ID, teacher, UserRole.TEACHER);
      await redis.set(key, 'stale');
      const sent = await service.send(SEED_TENANT_ID, teacher2, dto({ actionUrl: '/routines/my' }));

      const [row] = await ds.query(`SELECT * FROM alerts WHERE id = $1`, [sent.id]);
      expect(row).toMatchObject({
        source: 'MANUAL',
        rule_key: 'manual.alert',
        category: 'MANUAL',
        manual_title: 'Classes start at 9:00',
        manual_body: 'Rain delay.',
        action_url: '/routines/my',
        created_by_user_id: teacher2,
      });
      expect(row.dedupe_key).toMatch(/^manual:/);
      expect(row.manual_audience).toEqual({ roles: ['TEACHER'] });
      const rcp = await recipients(sent.id);
      expect(rcp.length).toBeGreaterThanOrEqual(2);
      // role null = personal, shows in every role and shell
      expect(rcp.every((r) => r.role === null && r.student_id === null)).toBe(true);

      expect(events).toHaveLength(1);
      expect(events[0].recipientIds).toHaveLength(rcp.length);
      expect(await redis.get(key)).toBeNull();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entity_type: 'Alert',
          entity_id: sent.id,
          tenant_id: SEED_TENANT_ID,
          new_values: expect.not.objectContaining({ body: expect.anything() }),
        }),
      );
      expect(sent.recipientCount).toBe(rcp.length);
    });

    it('expiresAt is the end of the school-local day', async () => {
      const sent = await service.send(SEED_TENANT_ID, teacher, dto());
      // Dhaka is UTC+6, no DST: local midnight of tomorrow
      expect(sent.expiresAt).toBe(new Date(`${addDaysIso(today, 1)}T00:00:00+06:00`).toISOString());
    });

    it('400 for a past date, 400 beyond 30 days, 400 for no recipients', async () => {
      await expect(
        service.send(SEED_TENANT_ID, teacher, dto({ expiresOn: addDaysIso(today, -1) })),
      ).rejects.toThrow('between today');
      await expect(
        service.send(SEED_TENANT_ID, teacher, dto({ expiresOn: addDaysIso(today, 31) })),
      ).rejects.toThrow('between today');
      await expect(
        service.send(SEED_TENANT_ID, teacher, dto({ audience: { userIds: [inactive] } })),
      ).rejects.toThrow('No one matches');
      expect(await ds.query(`SELECT 1 FROM alerts WHERE tenant_id = $1`, [SEED_TENANT_ID])).toEqual(
        [],
      );
    });

    it('21st send in 24 h -> 429, and a failed send writes nothing', async () => {
      for (let i = 0; i < 20; i++) await service.send(SEED_TENANT_ID, teacher, dto());
      await expect(service.send(SEED_TENANT_ID, teacher, dto())).rejects.toMatchObject({
        status: 429,
      });
      const [{ n }] = await ds.query(`SELECT count(*)::int n FROM alerts WHERE tenant_id = $1`, [
        SEED_TENANT_ID,
      ]);
      expect(n).toBe(20);
      // the cap is per school
      await expect(
        service.send(tenantB, teacher, dto({ audience: { userIds: [teacher] } })),
      ).rejects.toThrow('No one matches'); // not 429
    }, 60000);

    it('parallel sends at the cap cannot both pass it', async () => {
      for (let i = 0; i < 19; i++) await service.send(SEED_TENANT_ID, teacher, dto());
      const results = await Promise.allSettled([
        service.send(SEED_TENANT_ID, teacher, dto()),
        service.send(SEED_TENANT_ID, teacher, dto()),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    }, 60000);
  });

  describe('list and withdraw', () => {
    it('list returns seenCount and recipientCount, tenant-scoped, newest first', async () => {
      const a = await service.send(SEED_TENANT_ID, teacher, dto());
      const b = await service.send(SEED_TENANT_ID, teacher, dto({ title: 'Second' }));
      await ds.query(
        `UPDATE alert_recipients SET seen_at = now()
          WHERE id IN (SELECT id FROM alert_recipients WHERE alert_id = $1 LIMIT 2)`,
        [a.id],
      );
      const list = await service.list(SEED_TENANT_ID, 1, 25);
      expect(list.total).toBe(2);
      expect(list.items.map((i) => i.id)).toEqual([b.id, a.id]);
      expect(list.items[1]).toMatchObject({ seenCount: 2, createdByName: 'Manual t1' });
      expect((await service.list(tenantB)).items).toEqual([]);
    });

    it('withdraw expires OPEN/HIDDEN rows, leaves RESOLVED, purges caches, then 404s', async () => {
      const sent = await service.send(SEED_TENANT_ID, teacher, dto());
      await ds.query(
        `UPDATE alert_recipients SET state = 'HIDDEN' WHERE alert_id = $1 AND user_id = $2`,
        [sent.id, teacher2],
      );
      await ds.query(
        `UPDATE alert_recipients SET state = 'RESOLVED' WHERE alert_id = $1 AND user_id = $2`,
        [sent.id, teacher],
      );
      const key = attentionKeys.summary(SEED_TENANT_ID, teacher2, UserRole.TEACHER);
      await redis.set(key, 'stale');

      await service.withdraw(SEED_TENANT_ID, teacher, sent.id);

      const [alert] = await ds.query(`SELECT status FROM alerts WHERE id = $1`, [sent.id]);
      expect(alert.status).toBe('WITHDRAWN');
      const states = Object.fromEntries(
        (await recipients(sent.id)).map((r) => [r.user_id, r.state]),
      );
      expect(states[teacher]).toBe('RESOLVED');
      expect(states[teacher2]).toBe('EXPIRED');
      expect(await redis.get(key)).toBeNull();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DELETE', entity_type: 'Alert', entity_id: sent.id }),
      );
      await expect(service.withdraw(SEED_TENANT_ID, teacher, sent.id)).rejects.toThrow('not found');
    });

    it("another school's id is a 404", async () => {
      const sent = await service.send(SEED_TENANT_ID, teacher, dto());
      await expect(service.withdraw(tenantB, teacher, sent.id)).rejects.toThrow('not found');
      const [alert] = await ds.query(`SELECT status FROM alerts WHERE id = $1`, [sent.id]);
      expect(alert.status).toBe('ACTIVE');
    });
  });
});

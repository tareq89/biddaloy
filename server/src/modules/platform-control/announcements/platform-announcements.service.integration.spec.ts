import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { DataSource } from 'typeorm';
import Redis from 'ioredis';
import { AlertSeverity, SchoolStatus, UserRole } from '@biddaloy/shared';
import { ALL_ENTITIES } from '@test/all-entities';
import { createTestModule } from '@test/helpers/module.helper';
import { SEED_TENANT_ID } from '@test/constants';
import { TENANT_STATUS_REDIS, TenantStatusService } from '../../schools/tenant-status.service';
import { AuditService } from '../../audit/audit.service';
import { AccountAccessDeliveryService } from '../../account-access/account-access-delivery.service';
import { AlertWriterService } from '../../attention/engine/alert-writer.service';
import { RuleContextService } from '../../attention/rules/rule-context.service';
import { ManualAlertsService } from '../../attention/manual/manual-alerts.service';
import { PlatformAnnouncementsService } from './platform-announcements.service';

const TZ = 'Asia/Dhaka';
const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());

describe('PlatformAnnouncementsService (integration)', () => {
  let ds: DataSource;
  let redis: Redis;
  let svc: PlatformAnnouncementsService;
  let manual: ManualAlertsService;
  let schoolA: string;
  let schoolB: string;
  let suspended: string;
  let home: string;
  let owner: string;
  let adminA1: string;
  let adminA2: string;
  let adminB: string;
  let adminSuspended: string;
  let adminHome: string;
  let teacherA: string;
  const stamp = Date.now();
  const audit = { record: vi.fn(), recordApproved: vi.fn() };
  const delivery = { deliver: vi.fn() };
  const tenantStatus = { platformSchoolIds: vi.fn() };
  let n = 0;

  const mkUser = async (label: string) =>
    (
      await ds.query(
        `INSERT INTO users (email, password_hash, full_name, status, phone, created_at, updated_at)
         VALUES ($1, 'x', $2, 'ACTIVE', $3, NOW(), NOW()) RETURNING id`,
        [`pa-${label}-${stamp}@example.com`, `PA ${label}`, `0170${stamp % 1000000}${n++}`],
      )
    )[0].id as string;
  const mkSchool = async (label: string, status: string) =>
    (
      await ds.query(`INSERT INTO schools (name, slug, status) VALUES ($1, $2, $3) RETURNING id`, [
        `PA ${label}`,
        `pa-${label}-${stamp}`,
        status,
      ])
    )[0].id as string;
  const member = (userId: string, tenant: string, role: UserRole) =>
    ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [userId, tenant, role],
    );
  const dto = (over = {}) => ({
    title: 'Maintenance',
    body: 'Tonight at 10',
    severity: AlertSeverity.WARNING,
    statusFilter: [SchoolStatus.ACTIVE],
    sms: true,
    email: true,
    ...over,
  });
  const recipientsOf = async (tenant: string) =>
    (
      await ds.query(
        `SELECT DISTINCT r.user_id FROM alert_recipients r JOIN alerts a ON a.id = r.alert_id
          WHERE a.tenant_id = $1 AND a.created_by_user_id = $2`,
        [tenant, owner],
      )
    )
      .map((r: { user_id: string }) => r.user_id)
      .sort();
  const alertCount = async (tenant: string) =>
    (
      await ds.query(
        `SELECT count(*)::int n FROM alerts WHERE tenant_id = $1 AND created_by_user_id = $2`,
        [tenant, owner],
      )
    )[0].n as number;

  beforeAll(async () => {
    redis = new Redis(process.env.REDIS_URL!);
    const module = await createTestModule(ALL_ENTITIES, [
      PlatformAnnouncementsService,
      ManualAlertsService,
      AlertWriterService,
      { provide: TENANT_STATUS_REDIS, useValue: redis },
      { provide: AuditService, useValue: audit },
      { provide: AccountAccessDeliveryService, useValue: delivery },
      { provide: TenantStatusService, useValue: tenantStatus },
      {
        provide: RuleContextService,
        useValue: { build: async () => ({ tz: TZ, localDate: today }) },
      },
    ]);
    ds = module.get(DataSource);
    svc = module.get(PlatformAnnouncementsService);
    manual = module.get(ManualAlertsService);
    [schoolA, schoolB, suspended, home] = [
      await mkSchool('a', 'ACTIVE'),
      await mkSchool('b', 'ACTIVE'),
      await mkSchool('s', 'SUSPENDED'),
      await mkSchool('home', 'ACTIVE'),
    ];
    [owner, adminA1, adminA2, adminB, adminSuspended, adminHome, teacherA] = [
      await mkUser('owner'),
      await mkUser('a1'),
      await mkUser('a2'),
      await mkUser('b'),
      await mkUser('s'),
      await mkUser('home'),
      await mkUser('ta'),
    ];
    await ds.query(`INSERT INTO platform_admins (user_id) VALUES ($1)`, [owner]);
    await member(adminA1, schoolA, UserRole.ADMIN);
    await member(adminA2, schoolA, UserRole.ADMIN);
    await member(teacherA, schoolA, UserRole.TEACHER); // not an admin: must not be reached
    await member(adminB, schoolB, UserRole.ADMIN);
    await member(adminSuspended, suspended, UserRole.ADMIN);
    await member(adminHome, home, UserRole.ADMIN);
  }, 60000);

  beforeEach(async () => {
    vi.clearAllMocks();
    delivery.deliver.mockResolvedValue({});
    tenantStatus.platformSchoolIds.mockResolvedValue([home, SEED_TENANT_ID]); // seed school excluded too, keeps counts ours
    await ds.query(`DELETE FROM alerts WHERE tenant_id = ANY($1)`, [
      [schoolA, schoolB, suspended, home],
    ]);
    await ds.query(`DELETE FROM platform_announcements WHERE created_by = $1`, [owner]);
  });

  afterAll(async () => {
    const schools = [schoolA, schoolB, suspended, home];
    await ds.query(`DELETE FROM alerts WHERE tenant_id = ANY($1)`, [schools]);
    await ds.query(`DELETE FROM platform_announcements WHERE created_by = $1`, [owner]);
    await ds.query(`DELETE FROM user_tenants WHERE tenant_id = ANY($1)`, [schools]);
    await ds.query(`DELETE FROM platform_admins WHERE user_id = $1`, [owner]);
    await ds.query(`DELETE FROM schools WHERE id = ANY($1)`, [schools]);
    await ds.query(`DELETE FROM users WHERE email LIKE $1`, [`pa-%-${stamp}@example.com`]);
    await redis.quit();
    await ds.destroy();
  });

  it('one alert per school with only that school admins; platform home school skipped', async () => {
    const out = await svc.send(owner, dto(), 'it-key-1');
    expect(await recipientsOf(schoolA)).toEqual([adminA1, adminA2].sort());
    expect(await recipientsOf(schoolB)).toEqual([adminB]);
    expect(await alertCount(schoolA)).toBe(1);
    expect(await alertCount(home)).toBe(0); // the platform school is never messaged
    expect(await alertCount(suspended)).toBe(0); // filter is ACTIVE only
    expect(out).toMatchObject({ schoolsTargeted: 2, schoolsSucceeded: 2, recipientCount: 3 });
    // 3 admins x (SMS + email); nobody else (teacher, home admin) got one
    expect(delivery.deliver).toHaveBeenCalledTimes(6);
    expect(delivery.deliver.mock.calls.every((c) => c[0].tenantId === null)).toBe(true);
    expect(audit.recordApproved).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(audit.recordApproved.mock.calls[0][0])).not.toContain('Tonight at 10');
  });

  it('the status filter selects the right schools', async () => {
    await svc.send(owner, dto({ statusFilter: [SchoolStatus.SUSPENDED] }), 'it-key-2');
    expect(await alertCount(suspended)).toBe(1);
    expect(await alertCount(schoolA)).toBe(0);
    await svc.send(
      owner,
      dto({ statusFilter: [SchoolStatus.ACTIVE, SchoolStatus.SUSPENDED] }),
      'it-key-3',
    );
    expect(await alertCount(suspended)).toBe(2);
    expect(await alertCount(schoolB)).toBe(1);
    await expect(svc.preview([SchoolStatus.SUSPENDED])).resolves.toEqual({ schools: 1, people: 1 });
  });

  it('a school at its 20 manual alerts is not blocked, and the announcement does not use its cap', async () => {
    const own = (title: string) =>
      manual.send(schoolA, adminA1, {
        severity: AlertSeverity.WARNING,
        title,
        body: 'b',
        audience: { userIds: [adminA1] },
        expiresOn: today,
      });
    for (let i = 0; i < 19; i++) await own('own');
    await svc.send(owner, dto(), 'it-key-4');
    expect(await alertCount(schoolA)).toBe(1); // announcement delivered
    await own('twentieth'); // 19 own + announcement = 20 rows, but the 20th own send still passes
    await expect(own('21st')).rejects.toMatchObject({ status: 429 });
    // and with the school already full, the announcement still lands
    await svc.send(owner, dto(), 'it-key-5');
    expect(await alertCount(schoolA)).toBe(2);
  }, 60000);

  it('a repeat with the same key sends nothing new', async () => {
    const first = await svc.send(owner, dto(), 'it-key-6');
    delivery.deliver.mockClear();
    const again = await svc.send(owner, dto(), 'it-key-6');
    expect(again.id).toBe(first.id);
    expect(await alertCount(schoolA)).toBe(1);
    expect(delivery.deliver).not.toHaveBeenCalled();
    const [{ c }] = await ds.query(
      `SELECT count(*)::int c FROM platform_announcements WHERE created_by = $1`,
      [owner],
    );
    expect(c).toBe(1);
  });

  it('list shows what was sent without the body', async () => {
    await svc.send(owner, dto(), 'it-key-7');
    const list = await svc.list(25, 0);
    expect(list.items[0]).toMatchObject({ title: 'Maintenance', schoolsSucceeded: 2 });
    expect(JSON.stringify(list)).not.toContain('Tonight at 10');
  });
});

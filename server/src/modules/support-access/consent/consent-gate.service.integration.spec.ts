import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import Redis from 'ioredis';
import { AuditAction, SupportAccessMode, UserRole, UserStatus } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { AuditService } from '../../audit/audit.service';
import { AccountAccessDeliveryService } from '../../account-access/account-access-delivery.service';
import { SchoolSettingsReader } from '../../schools/settings/school-settings-reader.service';
import { School } from '../../schools/entities/school.entity';
import { User } from '../../users/entities/user.entity';
import { UserTenant } from '../../auth/entities/user-tenant.entity';
import { PlatformAdmin } from '../../platform-identity/entities/platform-admin.entity';
import { PlatformAdminService } from '../../platform-identity/platform-admin.service';
import { PlatformApprovalsService } from '../../platform-identity/approvals/platform-approvals.service';
import { PlatformSettingsService } from '../../platform-identity/approvals/platform-settings.service';
import { TwoPersonGuard } from '../../platform-identity/approvals/two-person.guard';
import { SupportAccessNoticeService } from '../notices/support-access-notice.service';
import { SupportRequestsService } from '../requests/support-requests.service';
import { IMPERSONATION_REDIS } from '../sessions/impersonation-redis';
import { ImpersonationSessionService } from '../sessions/impersonation-session.service';
import { ConsentGateService, type GateRequest } from './consent-gate.service';

const URL = '/platform/impersonation';

describe('ConsentGateService (integration)', () => {
  let module: TestingModule;
  let ds: DataSource;
  let redis: Redis;
  let gate: ConsentGateService;
  let requests: SupportRequestsService;
  let approvals: PlatformApprovalsService;
  // Mode per school id, so a test can make school A blocked and school B allowed.
  const modes = new Map<string, SupportAccessMode>();
  const notices = {
    sessionStarted: vi.fn().mockResolvedValue(undefined),
    emergency: vi.fn().mockResolvedValue(undefined),
    requestToAdmins: vi.fn().mockResolvedValue(undefined),
    ownersSessionStarted: vi.fn().mockResolvedValue(undefined),
    ticketReady: vi.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    redis = new Redis(process.env.REDIS_URL!);
    module = await createTestModule(ALL_ENTITIES, [
      ConsentGateService,
      SupportRequestsService,
      ImpersonationSessionService,
      AuditService,
      PlatformAdminService,
      PlatformApprovalsService,
      TwoPersonGuard,
      Reflector,
      { provide: IMPERSONATION_REDIS, useValue: redis },
      { provide: PlatformSettingsService, useValue: { get: async () => true } },
      {
        provide: AccountAccessDeliveryService,
        useValue: { deliver: vi.fn().mockResolvedValue({}) },
      },
      {
        provide: SchoolSettingsReader,
        useValue: {
          supportAccessFresh: async (id: string) => ({
            mode: modes.get(id) ?? SupportAccessMode.ALLOWED,
          }),
        },
      },
      { provide: SupportAccessNoticeService, useValue: notices },
    ]);
    ds = module.get(DataSource);
    gate = module.get(ConsentGateService);
    requests = module.get(SupportRequestsService);
    approvals = module.get(PlatformApprovalsService);
  }, 60000);

  // Owners are a global table: start each test with none.
  beforeEach(async () => {
    vi.clearAllMocks();
    await ds.query('DELETE FROM impersonation_sessions');
    await ds.query('DELETE FROM platform_approvals');
    await ds.query('DELETE FROM platform_admins');
  });
  afterAll(async () => {
    await ds.query('DELETE FROM impersonation_sessions');
    await ds.query('DELETE FROM platform_approvals');
    await ds.query('DELETE FROM platform_admins');
    redis?.disconnect();
    await module?.close();
  });

  const mkUser = (n: string) =>
    ds.getRepository(User).save(
      ds.getRepository(User).create({
        full_name: `${n} ${randomUUID().slice(0, 6)}`,
        email: `${randomUUID().slice(0, 8)}@gate.test`,
        status: UserStatus.ACTIVE,
      }),
    );

  async function world(mode: SupportAccessMode, owners = 2) {
    const sfx = randomUUID().slice(0, 8);
    const school = await ds
      .getRepository(School)
      .save(ds.getRepository(School).create({ name: `S ${sfx}`, slug: `s-${sfx}` }));
    modes.set(school.id, mode);
    const ownerIds: string[] = [];
    for (let i = 0; i < owners; i++) {
      const o = await mkUser(`Owner${i}`);
      await ds.getRepository(PlatformAdmin).save({ user_id: o.id });
      ownerIds.push(o.id);
    }
    const person = await mkUser('Teacher');
    await ds
      .getRepository(UserTenant)
      .save({ user_id: person.id, tenant_id: school.id, role: UserRole.TEACHER } as never);
    const admin = await mkUser('Admin');
    const body = (over: object = {}) => ({
      schoolId: school.id,
      targetUserId: person.id,
      role: UserRole.TEACHER,
      reason: 'Parent reported a marks problem',
      viewOnly: false,
      ...over,
    });
    const req = (owner: string, b: object, approval?: string): GateRequest => ({
      user: { sub: owner },
      method: 'POST',
      originalUrl: URL,
      headers: approval ? { 'x-platform-approval': approval } : {},
      body: b,
    });
    return { school, ownerIds, person, admin, body, req };
  }

  const row = async (id: string) =>
    (await ds.query('SELECT * FROM impersonation_sessions WHERE id = $1', [id]))[0];

  it('ask then approve (#3799) then redeem gives an ACTIVE row once; a second redeem is TICKET_NOT_USABLE', async () => {
    const w = await world(SupportAccessMode.ASK, 1);
    const b = w.body();
    const asked = await gate.start(w.req(w.ownerIds[0], b), b);
    expect(asked.status).toBe('REQUESTED');
    expect(notices.requestToAdmins).toHaveBeenCalledWith(w.school.id, asked.id, expect.anything());

    // Redeem before approval: not usable.
    const early = { ...b, ticketId: asked.id };
    await expect(gate.start(w.req(w.ownerIds[0], early), early)).rejects.toMatchObject({
      status: 409,
    });

    await requests.approve(w.school.id, w.admin.id, asked.id);
    const live = await gate.start(w.req(w.ownerIds[0], early), early);
    expect(live.status).toBe('ACTIVE');
    expect((await row(asked.id)).status).toBe('ACTIVE');
    expect(await redis.exists(`imp:${asked.id}`)).toBe(1);

    const again = await gate.start(w.req(w.ownerIds[0], early), early).catch((e) => e);
    expect(again.getResponse().details.code).toBe('TICKET_NOT_USABLE');
  });

  it("another owner's ticket is TICKET_NOT_USABLE and stays APPROVED", async () => {
    const w = await world(SupportAccessMode.ASK, 2);
    const b = w.body();
    const asked = await gate.start(w.req(w.ownerIds[0], b), b);
    await requests.approve(w.school.id, w.admin.id, asked.id);
    const stolen = { ...b, ticketId: asked.id };
    const err = await gate.start(w.req(w.ownerIds[1], stolen), stolen).catch((e) => e);
    expect(err.getResponse().details.code).toBe('TICKET_NOT_USABLE');
    expect((await row(asked.id)).status).toBe('APPROVED');
  });

  it('an expired ticket is TICKET_NOT_USABLE', async () => {
    const w = await world(SupportAccessMode.ASK, 1);
    const b = w.body();
    const asked = await gate.start(w.req(w.ownerIds[0], b), b);
    await requests.approve(w.school.id, w.admin.id, asked.id);
    await ds.query(
      "UPDATE impersonation_sessions SET ticket_expires_at = now() - interval '1 minute' WHERE id = $1",
      [asked.id],
    );
    const t = { ...b, ticketId: asked.id };
    await expect(gate.start(w.req(w.ownerIds[0], t), t)).rejects.toMatchObject({ status: 409 });
  });

  it('emergency with two owners: APPROVAL_REQUESTED, passes after the other approves, a changed payload fails', async () => {
    const w = await world(SupportAccessMode.BLOCKED, 2);
    const [a, other] = w.ownerIds;
    const b = w.body();

    const first = await gate.start(w.req(a, b), b).catch((e) => e);
    expect(first.getStatus()).toBe(403);
    const { code, requestId } = first.getResponse().details;
    expect(code).toBe('APPROVAL_REQUESTED');
    // Nothing was created while waiting.
    expect(
      await ds.query('SELECT 1 FROM impersonation_sessions WHERE tenant_id = $1', [w.school.id]),
    ).toHaveLength(0);

    await approvals.decide(requestId, other, 'approve');

    // Same grant, different body: the payload hash no longer matches.
    const changed = w.body({ reason: 'A completely different reason' });
    const bad = await gate.start(w.req(a, changed, requestId), changed).catch((e) => e);
    expect(bad.getResponse().details.code).toBe('APPROVAL_INVALID');

    const ok = await gate.start(w.req(a, b, requestId), b);
    const r = await row(ok.id);
    expect(r).toMatchObject({
      status: 'ACTIVE',
      entry_kind: 'EMERGENCY',
      view_only: true,
      write_locked: true,
    });
    expect(notices.emergency).toHaveBeenCalled();

    // The grant is single use.
    const replay = await gate.start(w.req(a, b, requestId), b).catch((e) => e);
    expect(replay.getResponse().details.code).toBe('APPROVAL_INVALID');
  });

  it('emergency with a single active owner skips the two-person gate', async () => {
    const w = await world(SupportAccessMode.BLOCKED, 1);
    const b = w.body();
    const row1 = await gate.start(w.req(w.ownerIds[0], b), b);
    expect(row1.entry_kind).toBe('EMERGENCY');
  });

  it('request-write: owner only, one open request, admin approval unlocks write', async () => {
    const w = await world(SupportAccessMode.BLOCKED, 1);
    const b = w.body();
    const s = await gate.start(w.req(w.ownerIds[0], b), b);

    await expect(gate.requestWrite(randomUUID(), s.id, 'Need to fix it')).rejects.toMatchObject({
      status: 404,
    });
    await gate.requestWrite(w.ownerIds[0], s.id, 'Need to fix the marks');
    expect((await row(s.id)).write_requested_at).not.toBeNull();
    await expect(
      gate.requestWrite(w.ownerIds[0], s.id, 'Need to fix the marks'),
    ).rejects.toMatchObject({ status: 409 });
    const audit = await ds.query(
      'SELECT new_values FROM audit_logs WHERE entity_id = $1 AND action = $2',
      [s.id, AuditAction.SUPPORT_ACCESS_REQUESTED],
    );
    expect(audit).toHaveLength(1);
    expect(audit[0].new_values).toEqual({
      sessionId: s.id,
      kind: 'WRITE',
      reason: 'Need to fix the marks',
    });
    expect(notices.requestToAdmins).toHaveBeenCalledWith(w.school.id, s.id, expect.anything());

    // Still read-only until an admin decides.
    expect((await row(s.id)).write_locked).toBe(true);
    await requests.approve(w.school.id, w.admin.id, s.id);
    expect((await row(s.id)).write_locked).toBe(false);
  });

  it('request-write on a NORMAL session is a 409', async () => {
    const w = await world(SupportAccessMode.ALLOWED, 1);
    const b = w.body();
    const s = await gate.start(w.req(w.ownerIds[0], b), b);
    await expect(gate.requestWrite(w.ownerIds[0], s.id, 'Need to fix it')).rejects.toMatchObject({
      status: 409,
    });
  });

  it("cross-tenant: school A's mode never decides school B's start", async () => {
    const a = await world(SupportAccessMode.BLOCKED, 1);
    const b = await world(SupportAccessMode.ALLOWED, 1);
    const body = b.body();
    const s = await gate.start(b.req(b.ownerIds[0], body), body);
    expect(await row(s.id)).toMatchObject({
      tenant_id: b.school.id,
      entry_kind: 'NORMAL',
      status: 'ACTIVE',
    });
    expect(a.school.id).not.toBe(b.school.id);
  });
});

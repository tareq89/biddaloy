import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { IncidentsService, incidentEvents, INCIDENT_CREATED } from './incidents.service';
import { IncidentNotifyListener, INCIDENT_NOTIFICATION_TEXT } from './incident-notify.listener';

const TENANT = 'tenant-1';
const ADMIN = 'admin-1';
const STAFF = 'staff-1';
const SECRET = 'SECRET-INCIDENT-TEXT';
// The listener never reads the subject/reporter as recipients; these ids belong to neither holder below.
const EVENT = {
  incidentId: 'inc-1',
  tenantId: TENANT,
  staffUserId: STAFF,
  reportedBy: 'reporter-x',
};

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'inc-1',
    tenant_id: TENANT,
    staff_user_id: STAFF,
    type: 'BEHAVIOUR',
    severity: 'LOW',
    body: SECRET,
    occurred_on: '2026-09-30',
    reported_by: ADMIN,
    created_at: new Date('2026-09-30T00:00:00Z'),
    ...over,
  };
}

describe('IncidentsService', () => {
  let repo: { save: any; create: any; find: any; findOne: any };
  let memberships: { findOne: any };
  let service: IncidentsService;

  beforeEach(() => {
    repo = {
      create: vi.fn((x) => x),
      save: vi.fn(async (x) => row(x)),
      find: vi.fn(async () => []),
      findOne: vi.fn(),
    };
    memberships = { findOne: vi.fn(async () => ({ id: 'm' })) };
    service = new IncidentsService(repo as any, memberships as any);
  });

  afterEach(() => incidentEvents.removeAllListeners());

  const dto = {
    staffId: STAFF,
    type: 'BEHAVIOUR',
    severity: 'LOW',
    occurredOn: '2026-09-30',
    description: SECRET,
  } as any;

  it('maps shared names to entity columns, scopes by tenant, and emits ids only', async () => {
    const seen: unknown[] = [];
    incidentEvents.on(INCIDENT_CREATED, (e) => seen.push(e));

    const res = await service.create(dto, TENANT, ADMIN);

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: TENANT,
        staff_user_id: STAFF,
        body: SECRET,
        reported_by: ADMIN,
      }),
    );
    expect(res.staffId).toBe(STAFF);
    expect(res.description).toBe(SECRET);
    expect(seen).toEqual([{ ...EVENT, staffUserId: STAFF, reportedBy: ADMIN }]);
    expect(JSON.stringify(seen)).not.toContain(SECRET);
  });

  it('404s when the subject is not a member of the tenant', async () => {
    memberships.findOne.mockResolvedValue(null);
    await expect(service.create(dto, TENANT, ADMIN)).rejects.toBeInstanceOf(NotFoundException);
    // Only staff-role memberships qualify (a PARENT/STUDENT subject is a 404).
    const where = memberships.findOne.mock.calls[0][0].where;
    expect(where.user_id).toBe(STAFF);
    expect(where.tenant_id).toBe(TENANT);
    expect(where.role).toBeDefined();
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('findOne filters tenant_id and 404s on the caller’s own incident', async () => {
    repo.findOne.mockResolvedValue(row({ staff_user_id: ADMIN }));
    await expect(service.findOne('inc-1', TENANT, ADMIN)).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 'inc-1', tenant_id: TENANT } });
  });

  it('findOne 404s when not found in this tenant', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(service.findOne('inc-1', TENANT, ADMIN)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('list filters tenant_id and omits the caller’s own incidents even if filtered for', async () => {
    repo.find.mockResolvedValue([row({ staff_user_id: ADMIN }), row({ id: 'inc-2' })]);
    const res = await service.list({ staffUserId: ADMIN }, TENANT, ADMIN);
    expect(repo.find.mock.calls[0][0].where.tenant_id).toBe(TENANT);
    expect(res.map((r) => r.id)).toEqual(['inc-2']);
  });
});

describe('IncidentNotifyListener', () => {
  const holders = [
    {
      user_id: ADMIN,
      user: { id: ADMIN, status: 'ACTIVE', full_name: 'Ad Min', phone: '+8801700000001' },
    },
  ];
  let push: { sendToUser: any };
  let communications: { enqueue: any };
  let schools: { findOne: any };
  let memberships: { find: any };
  let smsCredit: { isMetered: any; reserve: any };

  function build(
    settings: Record<string, any> | null,
    credit: { metered?: boolean; reserveOk?: boolean } = {},
  ) {
    smsCredit = {
      isMetered: vi.fn(async () => credit.metered ?? false),
      reserve: vi.fn(async () =>
        credit.reserveOk === false ? { ok: false, available: 0 } : { ok: true },
      ),
    };
    push = { sendToUser: vi.fn(async () => ({})) };
    communications = { enqueue: vi.fn(async () => ({})) };
    schools = { findOne: vi.fn(async () => ({ id: TENANT, settings })) };
    memberships = { find: vi.fn(async () => holders) };
    return new IncidentNotifyListener(
      memberships as any,
      schools as any,
      push as any,
      communications as any,
      smsCredit as any,
    );
  }

  it('pushes only the fixed string, never incident text, and no SMS by default', async () => {
    const listener = build(null);
    await listener.handleIncidentCreated(EVENT);

    expect(memberships.find.mock.calls[0][0].where.tenant_id).toBe(TENANT);
    expect(push.sendToUser).toHaveBeenCalledTimes(1);
    const [userId, tenantId, payload] = push.sendToUser.mock.calls[0];
    expect([userId, tenantId]).toEqual([ADMIN, TENANT]);
    expect(payload.title).toBe(INCIDENT_NOTIFICATION_TEXT);
    expect(payload.body).toBe('New incident report');
    expect(JSON.stringify(payload)).not.toContain(SECRET);
    expect(communications.enqueue).not.toHaveBeenCalled();
  });

  it('stays SMS-off when incidentSmsEnabled is false or a non-true value', async () => {
    for (const v of [false, 'true', 1]) {
      const listener = build({ evaluations: { incidentSmsEnabled: v } });
      await listener.handleIncidentCreated(EVENT);
      expect(communications.enqueue).not.toHaveBeenCalled();
    }
  });

  it('sends the fixed-text SMS only when incidentSmsEnabled === true', async () => {
    const listener = build({
      evaluations: { incidentSmsEnabled: true },
      communications: { sms: { provider: 'greenweb' } },
    });
    await listener.handleIncidentCreated(EVENT);

    expect(communications.enqueue).toHaveBeenCalledTimes(1);
    const [sms, tenantId] = communications.enqueue.mock.calls[0];
    expect(sms.message_body).toBe('New incident report');
    expect(sms.recipient_address).toBe('+8801700000001');
    expect(tenantId).toBe(TENANT);
    // Attributed to the reporter, not the recipient.
    expect(communications.enqueue.mock.calls[0][2]).toBe('reporter-x');
  });

  const SMS_ON = {
    evaluations: { incidentSmsEnabled: true },
    communications: { sms: { provider: 'greenweb' } },
  };

  it('does not reserve credit for an unmetered tenant', async () => {
    await build(SMS_ON).handleIncidentCreated(EVENT);
    expect(smsCredit.reserve).not.toHaveBeenCalled();
    expect(communications.enqueue.mock.calls[0][3]).toBeUndefined();
  });

  it('reserves once per incident for a metered tenant and hands the reservation to enqueue', async () => {
    await build(SMS_ON, { metered: true }).handleIncidentCreated(EVENT);
    expect(smsCredit.reserve).toHaveBeenCalledTimes(1);
    const [tenantId, units, key, ref] = smsCredit.reserve.mock.calls[0];
    expect([tenantId, key, ref]).toEqual([
      TENANT,
      'batch:incident:inc-1',
      { type: 'batch', id: 'inc-1' },
    ]);
    expect(units).toBeGreaterThan(0);
    expect(communications.enqueue.mock.calls[0][3]).toEqual({
      batchId: 'incident:inc-1',
      segments: units,
    });
  });

  it('skips SMS on insufficient credit but still pushes', async () => {
    await build(SMS_ON, { metered: true, reserveOk: false }).handleIncidentCreated(EVENT);
    expect(push.sendToUser).toHaveBeenCalledTimes(1);
    expect(communications.enqueue).not.toHaveBeenCalled();
  });

  it('skips SMS (push still goes) when credit reservation throws', async () => {
    const listener = build(SMS_ON, { metered: true });
    smsCredit.reserve.mockRejectedValue(new Error('db down'));
    await listener.handleIncidentCreated(EVENT);
    expect(push.sendToUser).toHaveBeenCalledTimes(1);
    expect(communications.enqueue).not.toHaveBeenCalled();
  });

  it('no SMS when enabled but no SMS provider is configured', async () => {
    const listener = build({ evaluations: { incidentSmsEnabled: true } });
    await listener.handleIncidentCreated(EVENT);
    expect(communications.enqueue).not.toHaveBeenCalled();
  });

  it('skips null and inactive users, and one failing recipient does not stop the rest', async () => {
    const listener = build(null);
    memberships.find.mockResolvedValue([
      { user_id: 'u-null', user: null },
      { user_id: 'u-off', user: { id: 'u-off', status: 'INACTIVE' } },
      { user_id: 'u-bad', user: { id: 'u-bad', status: 'ACTIVE' } },
      holders[0],
    ]);
    push.sendToUser.mockImplementation(async (id: string) => {
      if (id === 'u-bad') throw new Error('boom');
      return {};
    });
    await listener.handleIncidentCreated(EVENT);
    expect(push.sendToUser.mock.calls.map((c: unknown[]) => c[0])).toEqual(['u-bad', ADMIN]);
  });

  it('never notifies the subject or the reporter', async () => {
    const listener = build(null);
    await listener.handleIncidentCreated({ ...EVENT, staffUserId: ADMIN });
    expect(push.sendToUser).not.toHaveBeenCalled();
    await listener.handleIncidentCreated({ ...EVENT, reportedBy: ADMIN });
    expect(push.sendToUser).not.toHaveBeenCalled();
  });
});

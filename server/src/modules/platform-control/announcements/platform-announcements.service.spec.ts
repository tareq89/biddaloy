import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { AlertSeverity, ApprovalScope, AuditAction, SchoolStatus } from '@biddaloy/shared';
import { PlatformAnnouncementsService } from './platform-announcements.service';

const OWNER = '11111111-1111-4111-8111-111111111111';
const dto = {
  title: 'Maintenance tonight',
  body: 'SECRET-BODY text',
  severity: AlertSeverity.WARNING,
  statusFilter: [SchoolStatus.ACTIVE],
  sms: true,
  email: true,
};
const admin = (id: string, school: string) => ({
  tenant_id: school,
  id,
  name: `N${id}`,
  email: `${id}@x.test`,
  phone: `01${id}`,
});

describe('PlatformAnnouncementsService', () => {
  let svc: PlatformAnnouncementsService;
  let query: ReturnType<typeof vi.fn>;
  const manual = { sendPlatform: vi.fn() };
  const delivery = { deliver: vi.fn() };
  const audit = { recordApproved: vi.fn() };
  const tenantStatus = { platformSchoolIds: vi.fn() };
  const em = { query: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    tenantStatus.platformSchoolIds.mockResolvedValue(['home']);
    manual.sendPlatform.mockResolvedValue({});
    delivery.deliver.mockResolvedValue({});
    query = vi.fn();
    const ds = { query, transaction: async (fn: (m: unknown) => unknown) => fn(em) };
    svc = new PlatformAnnouncementsService(
      ds as never,
      manual as never,
      delivery as never,
      tenantStatus as never,
      audit as never,
    );
  });

  const row = (over = {}) => ({
    id: 'a1',
    title: dto.title,
    status_filter: { statuses: ['ACTIVE'] },
    channels: {
      sms: true,
      email: true,
      severity: 'WARNING',
      schoolsTargeted: 2,
      schoolsSucceeded: 1,
    },
    recipient_count: 1,
    created_by: OWNER,
    created_at: new Date(),
    created_by_name: 'Owner',
    ...over,
  });

  it('preview counts schools and people, skipping the platform school, and writes nothing', async () => {
    query.mockResolvedValueOnce([admin('u1', 's1'), admin('u2', 's1'), admin('u3', 's2')]);
    await expect(svc.preview([SchoolStatus.ACTIVE])).resolves.toEqual({ schools: 2, people: 3 });
    expect(query.mock.calls[0][1][1]).toEqual(['home']); // excluded ids passed to the query
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('send: one alert per school with only its admins, SMS+email each, audit has no body', async () => {
    query
      .mockResolvedValueOnce([admin('u1', 's1'), admin('u2', 's2')]) // audience
      .mockResolvedValueOnce([{ id: 'a1' }]) // claim
      .mockResolvedValueOnce([row()]); // final fetch
    await svc.send(OWNER, dto, 'key-1');
    expect(manual.sendPlatform).toHaveBeenCalledTimes(2);
    expect(manual.sendPlatform.mock.calls[0][0]).toBe('s1');
    expect(manual.sendPlatform.mock.calls[0][2].audience).toEqual({ userIds: ['u1'] });
    expect(delivery.deliver).toHaveBeenCalledTimes(4);
    expect(delivery.deliver.mock.calls[0][0]).toMatchObject({
      tenantId: null,
      kind: 'PLATFORM_ANNOUNCEMENT',
    });
    const entry = audit.recordApproved.mock.calls[0][0];
    expect(entry).toMatchObject({
      action: AuditAction.PLATFORM_ANNOUNCEMENT_SENT,
      tenant_id: null,
      approval_scope: ApprovalScope.PLATFORM_ANNOUNCE_ALL,
    });
    expect(entry.new_values).toMatchObject({ schoolsTargeted: 2, schoolsSucceeded: 2 });
    expect(JSON.stringify(entry)).not.toContain('SECRET-BODY');
  });

  it('an admin of two schools gets one SMS and one email but a banner per school', async () => {
    query
      .mockResolvedValueOnce([admin('u1', 's1'), admin('u1', 's2')])
      .mockResolvedValueOnce([{ id: 'a1' }])
      .mockResolvedValueOnce([row()]);
    await svc.send(OWNER, dto, 'key-2');
    expect(manual.sendPlatform).toHaveBeenCalledTimes(2);
    expect(delivery.deliver).toHaveBeenCalledTimes(2);
  });

  it('a failing school is logged and skipped; the loop goes on; counts reflect it', async () => {
    query
      .mockResolvedValueOnce([admin('u1', 's1'), admin('u2', 's2')])
      .mockResolvedValueOnce([{ id: 'a1' }])
      .mockResolvedValueOnce([row()]);
    manual.sendPlatform.mockRejectedValueOnce(new Error('SECRET-BODY leaked in error'));
    await svc.send(OWNER, dto, 'key-1');
    expect(manual.sendPlatform).toHaveBeenCalledTimes(2);
    expect(delivery.deliver).toHaveBeenCalledTimes(2); // only the second school delivered
    expect(audit.recordApproved.mock.calls[0][0].new_values).toMatchObject({
      schoolsSucceeded: 1,
      recipientCount: 1,
    });
  });

  it('sms off / email off: only the chosen channel is used', async () => {
    query
      .mockResolvedValueOnce([admin('u1', 's1')])
      .mockResolvedValueOnce([{ id: 'a1' }])
      .mockResolvedValueOnce([row()]);
    await svc.send(OWNER, { ...dto, sms: false }, 'key-1');
    expect(delivery.deliver).toHaveBeenCalledTimes(1);
    expect(delivery.deliver.mock.calls[0][0].medium).toBe('EMAIL');
  });

  it('a repeated key sends nothing and returns the first answer', async () => {
    query
      .mockResolvedValueOnce([admin('u1', 's1')])
      .mockResolvedValueOnce([]) // claim conflict
      .mockResolvedValueOnce([row()]);
    const out = await svc.send(OWNER, dto, 'key-1');
    expect(out.id).toBe('a1');
    expect(manual.sendPlatform).not.toHaveBeenCalled();
    expect(delivery.deliver).not.toHaveBeenCalled();
    expect(audit.recordApproved).not.toHaveBeenCalled();
  });

  it("another owner's key is a 409 with a fixed sentence", async () => {
    query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([row({ created_by: 'other' })]);
    const err = await svc.send(OWNER, dto, 'key-1').catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(JSON.stringify(err.getResponse())).not.toContain('key-1');
  });

  it('list caps the page at 100', async () => {
    query.mockResolvedValueOnce([{ total: 0 }]).mockResolvedValueOnce([]);
    await svc.list(5000, 0);
    expect(query.mock.calls[1][1][2]).toBe(100);
  });
});

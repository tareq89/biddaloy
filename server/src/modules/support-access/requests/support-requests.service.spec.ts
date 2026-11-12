import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';
import { AuditAction } from '@biddaloy/shared';
import { SupportRequestsService } from './support-requests.service';

const SCHOOL = '11111111-1111-4111-8111-111111111111';
const ADMIN = '22222222-2222-4222-8222-222222222222';
const SID = '33333333-3333-4333-8333-333333333333';

describe('SupportRequestsService', () => {
  const query = vi.fn();
  const record = vi.fn();
  const grantWrite = vi.fn();
  const ticketReady = vi.fn();
  let svc: SupportRequestsService;

  beforeEach(() => {
    vi.clearAllMocks();
    const manager = { query };
    const repo = { query, manager: { transaction: (fn: (m: unknown) => unknown) => fn(manager) } };
    svc = new SupportRequestsService(
      repo as never,
      { record } as never,
      { grantWrite } as never,
      { ticketReady } as never,
    );
  });

  it('approve of an ASK: one UPDATE, audit without reason text, owner told', async () => {
    query
      .mockResolvedValueOnce([{ platform_admin_id: 'o1' }])
      .mockResolvedValueOnce([{ name: 'Owner', email: 'o@x.test', phone: null, school: 'S' }]);
    await svc.approve(SCHOOL, ADMIN, SID);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.SUPPORT_ACCESS_APPROVED,
        tenant_id: SCHOOL,
        performed_by_user_id: ADMIN,
        new_values: { sessionId: SID, kind: 'ASK' },
      }),
      expect.anything(),
    );
    expect(ticketReady).toHaveBeenCalledWith(
      { name: 'Owner', email: 'o@x.test', phone: null },
      SCHOOL,
      'S',
    );
  });

  it('deny of an ASK does not tell the owner', async () => {
    query.mockResolvedValueOnce([{ platform_admin_id: 'o1' }]);
    await svc.deny(SCHOOL, ADMIN, SID);
    expect(ticketReady).not.toHaveBeenCalled();
  });

  it('no row anywhere is 404; a row of this school that lost the race is 409 without names', async () => {
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await expect(svc.approve(SCHOOL, ADMIN, SID)).rejects.toMatchObject({ status: 404 });
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{}]);
    const err = await svc.approve(SCHOOL, ADMIN, SID).catch((e) => e);
    expect(err.getStatus()).toBe(409);
    expect(err.getResponse().details.code).toBe('ALREADY_DECIDED');
  });

  it('approve of a WRITE calls grantWrite; a not-live session becomes ALREADY_DECIDED', async () => {
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: SID }]);
    await svc.approve(SCHOOL, ADMIN, SID);
    expect(grantWrite).toHaveBeenCalledWith(SID);
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: SID }]);
    grantWrite.mockRejectedValueOnce(new HttpException({ code: 'X' }, HttpStatus.CONFLICT));
    await expect(svc.approve(SCHOOL, ADMIN, SID)).rejects.toMatchObject({ status: 409 });
  });

  it('a grantWrite failure (Redis down) re-opens the WRITE request and rethrows', async () => {
    query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: SID }])
      .mockResolvedValueOnce([]);
    grantWrite.mockRejectedValueOnce(new Error('redis down'));
    await expect(svc.approve(SCHOOL, ADMIN, SID)).rejects.toThrow('redis down');
    // third query is the compensation putting write_requested_at back
    expect(query.mock.calls[2][0]).toContain('write_requested_at = now()');
  });

  it('deny of a WRITE never calls grantWrite', async () => {
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: SID }]);
    await svc.deny(SCHOOL, ADMIN, SID);
    expect(grantWrite).not.toHaveBeenCalled();
  });
});

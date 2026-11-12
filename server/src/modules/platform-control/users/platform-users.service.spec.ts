import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AuditAction } from '@biddaloy/shared';
import { PlatformUsersService } from './platform-users.service';

describe('PlatformUsersService', () => {
  const ds = { query: vi.fn() };
  const cutoff = { cutOff: vi.fn() };
  const refresh = { revokeAllForUser: vi.fn() };
  const audit = { record: vi.fn() };
  let svc: PlatformUsersService;

  beforeEach(() => {
    vi.resetAllMocks();
    svc = new PlatformUsersService(ds as never, cutoff as never, refresh as never, audit as never);
  });

  it.each(['+8801712345321', '8801712345321', '01712345321'])(
    'phone %s searches the same national suffix',
    async (q) => {
      ds.query.mockResolvedValueOnce([]);
      await svc.search(q);
      expect(ds.query.mock.calls[0][1][0]).toBe('%1712345321');
    },
  );

  it('escapes LIKE metacharacters and never interpolates input', async () => {
    await expect(svc.search('%_%')).rejects.toBeInstanceOf(BadRequestException);
    ds.query.mockResolvedValueOnce([]);
    await svc.search('a%b@x.com');
    expect(ds.query.mock.calls[0][0]).not.toContain('a%b');
  });

  it('email matches exactly, lowercased', async () => {
    ds.query.mockResolvedValueOnce([]);
    await svc.search(' Foo@X.com ');
    expect(ds.query.mock.calls[0][0]).toContain('u.email = $2');
    expect(ds.query.mock.calls[0][1][0]).toBeNull();
    expect(ds.query.mock.calls[0][1][1]).toBe('foo@x.com');
  });

  it('too-short phone is 400 and the message does not echo the input', async () => {
    const err = await svc.search('+8801').catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(JSON.stringify(err.getResponse())).not.toContain('8801');
  });

  it('masks contacts and lists memberships with memberId', async () => {
    ds.query
      .mockResolvedValueOnce([
        {
          id: 'u1',
          full_name: 'A',
          email: 'a@x.com',
          phone: '+8801712345321',
          status: 'SUSPENDED',
          last_login_at: null,
        },
      ])
      .mockResolvedValueOnce([
        { userId: 'u1', memberId: 'm1', schoolId: 's1', schoolName: 'S1', role: 'TEACHER' },
        { userId: 'u1', memberId: 'm2', schoolId: 's2', schoolName: 'S2', role: 'GUARDIAN' },
      ]);
    const [item] = await svc.search('01712345321');
    expect(item).toMatchObject({
      emailMasked: 'a•••@x.com',
      phoneMasked: '+88017••••321',
      locked: true,
      lastLoginAt: null,
    });
    expect(item.memberships).toHaveLength(2);
    expect(item.memberships[0]).toEqual({
      memberId: 'm1',
      schoolId: 's1',
      schoolName: 'S1',
      role: 'TEACHER',
    });
  });

  it('logout of an unknown or owner id is 404 and touches nothing', async () => {
    ds.query.mockResolvedValueOnce([]);
    await expect(svc.logout('u1', 'o1')).rejects.toBeInstanceOf(NotFoundException);
    expect(cutoff.cutOff).not.toHaveBeenCalled();
    expect(refresh.revokeAllForUser).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('logout cuts off, revokes refresh and audits with tenant_id null', async () => {
    ds.query.mockResolvedValueOnce([{ id: 'u1' }]);
    await svc.logout('u1', 'o1');
    expect(cutoff.cutOff).toHaveBeenCalledWith('u1');
    expect(refresh.revokeAllForUser).toHaveBeenCalledWith('u1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.PLATFORM_USER_LOGOUT,
        tenant_id: null,
        entity_id: 'u1',
        performed_by_user_id: 'o1',
      }),
    );
  });
});

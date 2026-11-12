import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PlatformSchoolDeleteService } from './platform-school-delete.service';

const ctx = { ip: null, userAgent: null };

function build(school: Record<string, unknown> | undefined, members: string[] = []) {
  const m = {
    query: vi.fn(async (sql: string, params: unknown[]) => {
      if (sql.includes('FOR NO KEY UPDATE')) return school ? [school] : [];
      if (sql.includes('DISTINCT')) {
        // First page returns every member; the next page (after the last id) is empty.
        return params[1] === members[members.length - 1]
          ? []
          : members.map((user_id) => ({ user_id }));
      }
      return [];
    }),
  };
  const db = {
    query: vi.fn(async () => (school ? [school] : [])),
    transaction: async (fn: (x: unknown) => unknown) => fn(m),
  };
  const cutoff = { cutOff: vi.fn() };
  const refresh = { revokeAllForUser: vi.fn() };
  const sessions = { revokeAllForSchool: vi.fn() };
  const status = { invalidate: vi.fn(), configuredPlatformTenantId: vi.fn() };
  const audit = { recordApproved: vi.fn() };
  const svc = new PlatformSchoolDeleteService(
    db as never,
    cutoff as never,
    refresh as never,
    sessions as never,
    status as never,
    audit as never,
  );
  return { svc, m, cutoff, refresh, sessions, status, audit };
}

describe('PlatformSchoolDeleteService', () => {
  it('soft-deletes, cuts members off, ends Login as sessions, audits DELETE on the school tenant', async () => {
    const { svc, m, cutoff, refresh, sessions, status, audit } = build(
      { id: 's', status: 'ACTIVE', status_reason: null, is_platform: false },
      ['u1', 'u2'],
    );
    await svc.delete('s', 'Closed for good', 'owner', ctx);
    expect(m.query.mock.calls.some(([sql]) => String(sql).includes('SET deleted_at'))).toBe(true);
    expect(cutoff.cutOff).toHaveBeenCalledTimes(2);
    expect(refresh.revokeAllForUser).toHaveBeenCalledTimes(2);
    expect(audit.recordApproved).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DELETE', entity_type: 'School', tenant_id: 's' }),
      m,
    );
    expect(sessions.revokeAllForSchool).toHaveBeenCalledWith('s', 'OWNER');
    expect(status.invalidate).toHaveBeenCalledWith('s');
  });

  it('the platform home school is 409 and nothing changes', async () => {
    const { svc, m, audit, cutoff } = build({ id: 's', is_platform: true });
    await expect(svc.delete('s', 'Closed for good', 'o', ctx)).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(svc.assertDeletable('s')).rejects.toBeInstanceOf(ConflictException);
    expect(m.query).toHaveBeenCalledTimes(1); // only the lock read
    expect(audit.recordApproved).not.toHaveBeenCalled();
    expect(cutoff.cutOff).not.toHaveBeenCalled();
  });

  it('an unknown or already deleted school is 404 with a fixed text', async () => {
    const { svc } = build(undefined);
    await expect(svc.delete('s', 'Closed for good', 'o', ctx)).rejects.toThrow('School not found');
    await expect(svc.assertDeletable('s')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a reserved billing code is refused as the reason', async () => {
    const { svc, m } = build({ id: 's', is_platform: false });
    await expect(svc.delete('s', 'trial_expired', 'o', ctx)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(m.query).not.toHaveBeenCalled();
  });
});

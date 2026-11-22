import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { UserRole } from '@biddaloy/shared';
import {
  StaffAudienceService,
  STAFF_AUDIENCE_MAX,
  STAFF_AUDIENCE_TOO_MANY,
  STAFF_AUDIENCE_EMPTY_PICK,
  STAFF_AUDIENCE_BAD_ROLE,
} from './staff-audience.service';

const TENANT = '11111111-1111-4111-8111-111111111111';
const CALLER = '22222222-2222-4222-8222-222222222222';

/** `query` answers the audience SQL; `manager.query` answers the coordinated-class lookup. */
function make(rows: unknown[], coordinatedClassIds: string[] = []) {
  const query = vi.fn().mockResolvedValue(rows);
  const manager = {
    query: vi.fn().mockResolvedValue(coordinatedClassIds.map((c) => ({ class_id: c }))),
  };
  const service = new StaffAudienceService({ query, manager } as any);
  return { service, query, manager };
}

describe('StaffAudienceService', () => {
  let rows: { user_id: string; name: string; phone: string | null }[];
  beforeEach(() => {
    rows = [
      { user_id: 'u1', name: 'Anis', phone: '01711111111' },
      { user_id: 'u2', name: 'Bela', phone: null },
      { user_id: 'u3', name: 'Chand', phone: '01733333333' },
    ];
  });

  it('splits people with a phone from people without one', async () => {
    const { service } = make(rows);
    const res = await service.resolve(TENANT, { roles: [UserRole.TEACHER] });
    expect(res.recipients.map((r) => r.user_id)).toEqual(['u1', 'u3']);
    // No phone: skipped with a reason, not silently dropped (D5).
    expect(res.skipped).toEqual([{ user_id: 'u2', name: 'Bela', reason: 'no_phone' }]);
  });

  it('passes the tenant id first and every audience part as a bound parameter', async () => {
    const { service, query } = make(rows);
    await service.resolve(TENANT, {
      roles: [UserRole.TEACHER],
      designationIds: ['33333333-3333-4333-8333-333333333333'],
      teaching: false,
      userIds: ['44444444-4444-4444-8444-444444444444'],
    });
    const [sql, params] = query.mock.calls[0];
    expect(params[0]).toBe(TENANT);
    expect(params[3]).toBe(false); // teaching=false is a real filter, not "unset"
    expect(params[5]).toBeNull(); // not coordinator mode
    // Tenant isolation: every branch of the union is tenant-bound; no value is spliced in.
    expect(sql).not.toContain('${');
    expect(sql).toContain('x.user_id');
    expect(sql.match(/tenant_id = \$1/g)!.length).toBeGreaterThanOrEqual(5);
  });

  it('refuses an empty audience, and non-staff roles', async () => {
    const { service } = make(rows);
    await expect(service.resolve(TENANT, {})).rejects.toThrow(STAFF_AUDIENCE_EMPTY_PICK);
    await expect(service.resolve(TENANT, { roles: [UserRole.PARENT] })).rejects.toThrow(
      STAFF_AUDIENCE_BAD_ROLE,
    );
    await expect(service.resolve(TENANT, { roles: [UserRole.SUPER_ADMIN] })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('refuses more than 500 people with one fixed sentence and no phone in it', async () => {
    const many = Array.from({ length: STAFF_AUDIENCE_MAX + 1 }, (_, i) => ({
      user_id: `u${i}`,
      name: `N${i}`,
      phone: '01799999999',
    }));
    const { service } = make(many);
    const err = await service.resolve(TENANT, { roles: [UserRole.TEACHER] }).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toBe(STAFF_AUDIENCE_TOO_MANY);
    expect(JSON.stringify(err.getResponse())).not.toContain('0179');
  });

  it('allows exactly 500', async () => {
    const many = Array.from({ length: STAFF_AUDIENCE_MAX }, (_, i) => ({
      user_id: `u${i}`,
      name: `N${i}`,
      phone: '01799999999',
    }));
    const { service } = make(many);
    const res = await service.resolve(TENANT, { roles: [UserRole.TEACHER] });
    expect(res.recipients).toHaveLength(STAFF_AUDIENCE_MAX);
  });

  it('coordinatedOnly passes the coordinated class ids into the query', async () => {
    const { service, query } = make(rows, ['c1']);
    await service.resolve(
      TENANT,
      { teaching: true },
      { coordinatedOnly: true, callerUserId: CALLER },
    );
    expect(query.mock.calls[0][1][5]).toEqual(['c1']);
  });

  it('coordinatedOnly with no coordinated class returns an empty list without querying', async () => {
    const { service, query } = make(rows, []);
    const res = await service.resolve(
      TENANT,
      { teaching: true },
      { coordinatedOnly: true, callerUserId: CALLER },
    );
    expect(res).toEqual({ recipients: [], skipped: [] });
    expect(query).not.toHaveBeenCalled();
  });

  it('coordinatedOnly without a caller is refused', async () => {
    const { service } = make(rows, ['c1']);
    await expect(
      service.resolve(TENANT, { teaching: true }, { coordinatedOnly: true }),
    ).rejects.toThrow(BadRequestException);
  });
});

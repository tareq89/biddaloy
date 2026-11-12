import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { SupportAccessMode, UserRole } from '@biddaloy/shared';
import { LoginAsCandidatesService } from './login-as-candidates.service';

/** Chainable query-builder stub: every call returns itself, getRawMany returns `result`. */
function qb(result: unknown[]) {
  const q: any = new Proxy(
    {},
    { get: (_t, k) => (k === 'getRawMany' ? async () => result : () => q) },
  );
  return q;
}

function make(school: unknown, rows: unknown[], admins: unknown[]) {
  const builders = [qb(rows), qb(admins)];
  const ds: any = {
    getRepository: () => ({ findOne: async () => school }),
    createQueryBuilder: () => builders.shift(),
  };
  const settings: any = { supportAccessFresh: async () => ({ mode: SupportAccessMode.ASK }) };
  return new LoginAsCandidatesService(ds, settings);
}

describe('LoginAsCandidatesService reason mapping', () => {
  it('maps no user to NO_LOGIN_ACCOUNT, non-active to INACTIVE, active to null', async () => {
    const svc = make(
      { id: 's', status: 'SUSPENDED' },
      [
        { user_id: null, name: 'A', email: null, phone: null, status: null },
        { user_id: 'u2', name: 'B', email: 'b@x', phone: null, status: 'SUSPENDED' },
        { user_id: 'u3', name: 'C', email: null, phone: '01', status: 'ACTIVE' },
      ],
      [],
    );
    const res = await svc.list('s', UserRole.STUDENT, undefined, 50);
    expect(res.candidates.map((c) => c.unavailableReason)).toEqual([
      'NO_LOGIN_ACCOUNT',
      'INACTIVE',
      null,
    ]);
    expect(res.noActiveAdmin).toBe(true);
    expect(res.schoolStatus).toBe('SUSPENDED');
    expect(res.supportAccessMode).toBe(SupportAccessMode.ASK);
  });

  it('unknown school is a fixed 404', async () => {
    await expect(make(null, [], []).list('s', UserRole.ADMIN, undefined, 5)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

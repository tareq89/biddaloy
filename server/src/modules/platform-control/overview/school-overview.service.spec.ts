import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { SchoolOverviewService } from './school-overview.service';

function build(opts: { found?: boolean; homeId?: string; smsFails?: boolean } = {}) {
  const ds = {
    query: vi.fn(async (sql: string) => {
      if (sql.includes('FROM schools')) return opts.found === false ? [] : [{ id: 's' }];
      if (sql.includes('SUM(size_bytes)')) return [{ total: '42' }];
      if (sql.includes('platform_school_notes')) return [{ n: 3 }];
      return [];
    }),
  };
  const schools = { getStats: vi.fn(async () => ({ last_activity_at: new Date(0) })) };
  const admins = {
    list: vi.fn(async () => [
      {
        user_id: 'u',
        name: 'A',
        email: 'jane@x.com',
        phone: '+8801712345321',
        membership_status: 'ACTIVE',
      },
    ]),
  };
  const sms = {
    getBalance: vi.fn(async () => {
      if (opts.smsFails) throw new Error('boom');
      return { available: 5, reserved: 1 };
    }),
  };
  const home = { id: async () => opts.homeId };
  const svc = new SchoolOverviewService(
    ds as never,
    schools as never,
    admins as never,
    sms as never,
    home as never,
  );
  return { svc, ds };
}

describe('SchoolOverviewService', () => {
  it('unknown school and platform-home are both 404 with the same text', async () => {
    const a = await build({ found: false })
      .svc.get('s')
      .catch((e) => e);
    const b = await build({ homeId: 's' })
      .svc.get('s')
      .catch((e) => e);
    expect(a).toBeInstanceOf(NotFoundException);
    expect(b).toBeInstanceOf(NotFoundException);
    expect(a.message).toBe(b.message);
  });

  it('masks admin email and phone', async () => {
    const out = await build().svc.get('s');
    expect(out.admins).toEqual([
      {
        userId: 'u',
        name: 'A',
        email: 'j•••@x.com',
        phone: '+88017••••321',
        membershipStatus: 'ACTIVE',
      },
    ]);
    expect(JSON.stringify(out)).not.toContain('jane@x.com');
    expect(out.filesBytes).toBe(42);
    expect(out.notesCount).toBe(3);
    expect(out.lastActivityAt).toBe('1970-01-01T00:00:00.000Z');
  });

  it('a failed part is null and the rest still answer', async () => {
    const out = await build({ smsFails: true }).svc.get('s');
    expect(out.smsBalance).toBeNull();
    expect(out.notesCount).toBe(3);
  });

  it('every query is filtered by this school', async () => {
    const { svc, ds } = build();
    await svc.get('s');
    for (const [sql] of ds.query.mock.calls) expect(sql).toMatch(/tenant_id|id = \$1/);
  });
});

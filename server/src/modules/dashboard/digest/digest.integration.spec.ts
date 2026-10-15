import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { School } from '../../schools/entities/school.entity';
import { User } from '../../users/entities/user.entity';
import { UserTenant } from '../../auth/entities/user-tenant.entity';
import { DigestScheduleService } from './digest-schedule.service';
import { digestSentKey } from './digest.constants';

const A = '00000000-0000-4000-8000-000001911010';
const B = '00000000-0000-4000-8000-000001911020';
const id = (n: number) => `00000000-0000-4000-8000-0000019110${n}`;
// 07:30 Dhaka on a Thursday, outside quiet hours.
const NOW = new Date('2026-10-08T01:30:00Z');

describe('DigestScheduleService recipients (integration, real DB + Redis)', () => {
  let ds: DataSource;
  let redis: Redis;
  let service: DigestScheduleService;
  let push: { sendToUser: ReturnType<typeof vi.fn> };

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get(DataSource);
    redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');

    const schools = ds.getRepository(School);
    for (const [sid, tag] of [
      [A, 'a'],
      [B, 'b'],
    ] as const) {
      await schools.save(
        schools.create({
          id: sid,
          name: `Digest ${tag}`,
          slug: `digest-1911-${tag}`,
          status: 'ACTIVE',
        } as any),
      );
    }
    const users = ds.getRepository(User);
    const members = ds.getRepository(UserTenant);
    const mk = async (
      n: number,
      tenant: string,
      role: string,
      extra: Partial<User> = {},
      deleted = false,
    ) => {
      await users.save(
        users.create({
          id: id(n),
          full_name: `U${n}`,
          email: `d1911-${n}@t.test`,
          ...extra,
        } as any),
      );
      const m = (await members.save(
        members.create({ user_id: id(n), tenant_id: tenant, role } as any),
      )) as unknown as UserTenant;
      if (deleted) await members.softDelete(m.id);
    };
    await mk(30, A, 'ADMIN');
    await mk(31, A, 'TEACHER', { preferences: { digest: { enabled: false } } });
    await mk(32, A, 'ACCOUNTANT');
    await mk(33, A, 'EXECUTIVE', { status: 'SUSPENDED' as any });
    await mk(34, A, 'TEACHER', {}, true); // removed member
    await mk(35, B, 'ADMIN'); // other school
  });

  afterAll(async () => {
    await ds.query(`DELETE FROM user_tenants WHERE tenant_id = ANY($1::uuid[])`, [[A, B]]);
    await ds.query(`DELETE FROM users WHERE email LIKE 'd1911-%@t.test'`);
    await ds.query(`DELETE FROM schools WHERE id = ANY($1::uuid[])`, [[A, B]]);
    await redis.del(digestSentKey(A, '2026-10-08'), digestSentKey(B, '2026-10-08'));
    await redis.quit();
  });

  beforeEach(async () => {
    await redis.del(digestSentKey(A, '2026-10-08'), digestSentKey(B, '2026-10-08'));
    push = { sendToUser: vi.fn().mockResolvedValue({ accepted: 1, transient: 0, pruned: 0 }) };
    const schools = {
      findById: (sid: string) => ds.getRepository(School).findOneOrFail({ where: { id: sid } }),
      getResolvedSettings: async () => ({
        dashboard: { digestTime: '07:30' },
        region: { timezone: 'Asia/Dhaka', locale: 'en' },
        attention: { quietHours: { start: '21:00', end: '07:00' } },
      }),
    };
    const attention = {
      summary: vi.fn(async () => ({ critical: 1, warning: 0, reminder: 0, top: { title: 'T' } })),
    };
    service = new DigestScheduleService(
      { add: vi.fn(), removeJobScheduler: vi.fn() } as any,
      ds,
      redis,
      schools as any,
      { isNonWorkingDay: async () => false } as any,
      push as any,
      attention as any,
    );
  });

  it('pushes only to active, opted-in ADMIN/EXECUTIVE/TEACHER members of that school', async () => {
    await service.runNow(A, false, NOW);
    // 30 = ADMIN. 31 opted out, 32 wrong role, 33 suspended user, 34 removed member, 35 other school.
    expect(push.sendToUser.mock.calls.map((c) => c[0])).toEqual([id(30)]);
    expect(push.sendToUser.mock.calls[0][1]).toBe(A);
  });

  it("tenant B's run never reaches tenant A's members", async () => {
    await service.runNow(B, false, NOW);
    expect(push.sendToUser.mock.calls.map((c) => [c[0], c[1]])).toEqual([[id(35), B]]);
  });

  it('a re-run the same day sends nothing more (real Redis claim)', async () => {
    await service.runNow(A, false, NOW);
    await service.runNow(A, false, NOW);
    expect(push.sendToUser).toHaveBeenCalledTimes(1);
  });
});

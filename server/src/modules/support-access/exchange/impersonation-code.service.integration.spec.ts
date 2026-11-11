import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { createHash } from 'crypto';
import Redis from 'ioredis';
import {
  ImpersonationEndedBy,
  ImpersonationEntryKind,
  SupportAccessMode,
  UserRole,
  UserStatus,
} from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { AuditService } from '../../audit/audit.service';
import { SchoolSettingsReader } from '../../schools/settings/school-settings-reader.service';
import { School } from '../../schools/entities/school.entity';
import { User } from '../../users/entities/user.entity';
import { UserTenant } from '../../auth/entities/user-tenant.entity';
import { PlatformAdmin } from '../../platform-identity/entities/platform-admin.entity';
import { IMPERSONATION_REDIS, codeKey } from '../sessions/impersonation-redis';
import { ImpersonationSessionService } from '../sessions/impersonation-session.service';
import { ImpersonationCodeService } from './impersonation-code.service';

describe('ImpersonationCodeService (integration)', () => {
  let module: TestingModule;
  let ds: DataSource;
  let sessions: ImpersonationSessionService;
  let codes: ImpersonationCodeService;
  let redis: Redis;

  beforeAll(async () => {
    redis = new Redis(process.env.REDIS_URL!);
    module = await createTestModule(ALL_ENTITIES, [
      ImpersonationSessionService,
      ImpersonationCodeService,
      AuditService,
      { provide: IMPERSONATION_REDIS, useValue: redis },
      {
        provide: SchoolSettingsReader,
        useValue: { supportAccessFresh: async () => ({ mode: SupportAccessMode.ALLOWED }) },
      },
    ]);
    ds = module.get(DataSource);
    sessions = module.get(ImpersonationSessionService);
    codes = module.get(ImpersonationCodeService);
  });

  afterAll(async () => {
    redis.disconnect();
    await module?.close();
  });

  // One school, one platform admin, one teacher, one live session.
  async function liveSession() {
    const sfx = randomUUID().slice(0, 8);
    const school = await ds
      .getRepository(School)
      .save(ds.getRepository(School).create({ name: `S ${sfx}`, slug: `s-${sfx}` }));
    const mkUser = (n: string) =>
      ds
        .getRepository(User)
        .save(
          ds.getRepository(User).create({ full_name: `${n} ${sfx}`, status: UserStatus.ACTIVE }),
        );
    const owner = await mkUser('Owner');
    await ds.getRepository(PlatformAdmin).save({ user_id: owner.id });
    const teacher = await mkUser('Teacher');
    await ds
      .getRepository(UserTenant)
      .save({ user_id: teacher.id, tenant_id: school.id, role: UserRole.TEACHER });
    const row = await sessions.create({
      platformAdminId: owner.id,
      schoolId: school.id,
      targetUserId: teacher.id,
      role: UserRole.TEACHER,
      reason: 'Helping with a marks import',
      viewOnly: true,
      entryKind: ImpersonationEntryKind.NORMAL,
    });
    return { school, owner, teacher, row };
  }

  const refused = { status: 401, message: 'Invalid or expired code' };

  it('issue then redeem returns the session and its school; the second redeem is 401', async () => {
    const a = await liveSession();
    const code = await codes.issue(a.row.id);
    const got = await codes.redeem(code);
    expect(got).toMatchObject({
      sid: a.row.id,
      userId: a.teacher.id,
      adminId: a.owner.id,
      schoolId: a.school.id,
    });
    expect(got.remainingSeconds).toBeGreaterThan(0);
    expect(got.remainingSeconds).toBeLessThanOrEqual(3600);
    await expect(codes.redeem(code)).rejects.toMatchObject(refused);
  });

  it('a code for school A never yields school B', async () => {
    const a = await liveSession();
    const b = await liveSession();
    const codeA = await codes.issue(a.row.id);
    const gotA = await codes.redeem(codeA);
    expect(gotA.schoolId).toBe(a.school.id);
    expect(gotA.schoolId).not.toBe(b.school.id);
    expect(gotA.sid).not.toBe(b.row.id);
  });

  it('redeem after the session is ended is 401', async () => {
    const a = await liveSession();
    const code = await codes.issue(a.row.id);
    await sessions.end(a.row.id, ImpersonationEndedBy.OWNER);
    await expect(codes.redeem(code)).rejects.toMatchObject(refused);
  });

  it('redeem after the person is suspended is 401', async () => {
    const a = await liveSession();
    const code = await codes.issue(a.row.id);
    await ds.query(`UPDATE users SET status = 'SUSPENDED' WHERE id = $1`, [a.teacher.id]);
    await expect(codes.redeem(code)).rejects.toMatchObject(refused);
  });

  it('a code whose key has expired is 401', async () => {
    const a = await liveSession();
    const code = await codes.issue(a.row.id);
    const key = codeKey(createHash('sha256').update(code).digest('hex'));
    expect(await redis.ttl(key)).toBeGreaterThan(0);
    expect(await redis.ttl(key)).toBeLessThanOrEqual(60);
    await redis.pexpire(key, 1);
    // Poll for the condition (the key is gone), never a fixed sleep.
    await expect.poll(() => redis.exists(key), { timeout: 5000 }).toBe(0);
    await expect(codes.redeem(code)).rejects.toMatchObject(refused);
  });

  it('an unknown code is the same 401', async () => {
    await expect(codes.redeem('Z'.repeat(43))).rejects.toMatchObject(refused);
  });
});

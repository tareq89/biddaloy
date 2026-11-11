import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import {
  AuditAction,
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
import { ImpersonationSession } from '../entities/impersonation-session.entity';
import { IMPERSONATION_REDIS, impKey } from './impersonation-redis';
import { ImpersonationSessionService } from './impersonation-session.service';

describe('ImpersonationSessionService (integration)', () => {
  let module: TestingModule;
  let ds: DataSource;
  let service: ImpersonationSessionService;
  let redis: Redis;

  beforeAll(async () => {
    redis = new Redis(process.env.REDIS_URL!);
    module = await createTestModule(ALL_ENTITIES, [
      ImpersonationSessionService,
      AuditService,
      { provide: IMPERSONATION_REDIS, useValue: redis },
      {
        provide: SchoolSettingsReader,
        useValue: { supportAccessFresh: async () => ({ mode: SupportAccessMode.ALLOWED }) },
      },
    ]);
    ds = module.get(DataSource);
    service = module.get(ImpersonationSessionService);
  });

  afterAll(async () => {
    redis.disconnect();
    await module?.close();
  });

  // Each test builds its own school, owner and teachers with unique names.
  async function world(teachers = 1) {
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
    const people: User[] = [];
    for (let i = 0; i < teachers; i++) {
      const u = await mkUser(`Teacher${i}`);
      await ds.getRepository(UserTenant).save({
        user_id: u.id,
        tenant_id: school.id,
        role: UserRole.TEACHER,
      });
      people.push(u);
    }
    const start = (p: User) =>
      service.create({
        platformAdminId: owner.id,
        schoolId: school.id,
        targetUserId: p.id,
        role: UserRole.TEACHER,
        reason: 'Helping with a marks import',
        viewOnly: true,
        entryKind: ImpersonationEntryKind.NORMAL,
      });
    return { school, owner, people, start };
  }

  const auditRows = (sid: string, action: AuditAction) =>
    ds.query('SELECT tenant_id FROM audit_logs WHERE entity_id = $1 AND action = $2', [
      sid,
      action,
    ]);

  it('create writes the live key with a TTL of at most 3600; end deletes it and writes one ENDED row stamped with the school', async () => {
    const w = await world();
    const s = await w.start(w.people[0]);
    const ttl = await redis.ttl(impKey(s.id));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(3600);
    expect(await auditRows(s.id, AuditAction.IMPERSONATION_STARTED)).toHaveLength(1);

    expect(await service.end(s.id, ImpersonationEndedBy.OWNER)).toBe(true);
    expect(await service.end(s.id, ImpersonationEndedBy.OWNER)).toBe(false);
    expect(await redis.exists(impKey(s.id))).toBe(0);
    const ended = await auditRows(s.id, AuditAction.IMPERSONATION_ENDED);
    expect(ended).toHaveLength(1);
    // The school is the tenant of the row, so the school's own audit view sees it.
    expect(ended[0].tenant_id).toBe(w.school.id);
  });

  it('a same-person restart replaces the older row and removes its key', async () => {
    const w = await world();
    const first = await w.start(w.people[0]);
    const second = await w.start(w.people[0]);
    expect(await redis.exists(impKey(first.id))).toBe(0);
    expect(await redis.exists(impKey(second.id))).toBe(1);
    const [row] = await ds.query(
      'SELECT status, ended_by FROM impersonation_sessions WHERE id = $1',
      [first.id],
    );
    expect(row).toEqual({ status: 'ENDED', ended_by: 'REPLACED' });
  });

  it('the 4th distinct live session is refused with 409', async () => {
    const w = await world(4);
    for (const p of w.people.slice(0, 3)) await w.start(p);
    await expect(w.start(w.people[3])).rejects.toMatchObject({ status: 409 });
  });

  it('revokeAllForSchool ends every live session of the school and writes one ENDED row each', async () => {
    const w = await world(2);
    const a = await w.start(w.people[0]);
    const b = await w.start(w.people[1]);
    expect(await service.revokeAllForSchool(w.school.id, ImpersonationEndedBy.MODE_BLOCKED)).toBe(
      2,
    );
    for (const s of [a, b]) {
      expect(await redis.exists(impKey(s.id))).toBe(0);
      expect(await auditRows(s.id, AuditAction.IMPERSONATION_ENDED)).toHaveLength(1);
    }
  });

  it('lazy expiry flips the row and writes ENDED exactly once under two parallel reads', async () => {
    const w = await world();
    const s = await w.start(w.people[0]);
    await ds.query(
      `UPDATE impersonation_sessions SET expires_at = now() - interval '1 minute' WHERE id = $1`,
      [s.id],
    );
    await Promise.all([service.listLive(w.owner.id), service.listLive(w.owner.id)]);
    const [row] = await ds.query(
      'SELECT status, ended_by FROM impersonation_sessions WHERE id = $1',
      [s.id],
    );
    expect(row).toEqual({ status: 'EXPIRED', ended_by: 'EXPIRED' });
    expect(await auditRows(s.id, AuditAction.IMPERSONATION_ENDED)).toHaveLength(1);
    expect(await service.listLive(w.owner.id)).toEqual([]);
  });

  it('a session of school A is never listed under school B', async () => {
    const a = await world();
    const b = await world();
    const s = await a.start(a.people[0]);
    const inA = await service.listRecent({ schoolId: a.school.id, limit: 10 });
    const inB = await service.listRecent({ schoolId: b.school.id, limit: 10 });
    expect(inA.map((r) => r.id)).toEqual([s.id]);
    expect(inA[0]).toMatchObject({ schoolName: a.school.name, role: UserRole.TEACHER });
    expect(inB).toEqual([]);
  });

  it('history still lists names after the school and the person are soft-deleted', async () => {
    const w = await world();
    const s = await w.start(w.people[0]);
    await service.end(s.id, ImpersonationEndedBy.OWNER);
    await ds.query('UPDATE users SET deleted_at = now() WHERE id = $1', [w.people[0].id]);
    await ds.query('UPDATE schools SET deleted_at = now() WHERE id = $1', [w.school.id]);
    const rows = await service.listRecent({ schoolId: w.school.id, limit: 10 });
    expect(rows).toHaveLength(1);
    expect(rows[0].schoolName).toBe(w.school.name);
    expect(rows[0].userName).toBe(w.people[0].full_name);
  });

  it('grantWrite flips write_locked and rewrites the key keeping its TTL; a dead session answers 409', async () => {
    const w = await world();
    const s = await w.start(w.people[0]);
    await ds.query('UPDATE impersonation_sessions SET write_locked = true WHERE id = $1', [s.id]);
    await service.grantWrite(s.id);
    expect(JSON.parse((await redis.get(impKey(s.id)))!).writeLocked).toBe(false);
    expect(await redis.ttl(impKey(s.id))).toBeGreaterThan(0);
    await service.end(s.id, ImpersonationEndedBy.OWNER);
    await expect(service.grantWrite(s.id)).rejects.toMatchObject({ status: 409 });
    expect(await redis.exists(impKey(s.id))).toBe(0);
  });

  it('an approved ask ticket goes live through activate and replaces the older live row', async () => {
    const w = await world();
    const older = await w.start(w.people[0]);
    const ticket = await ds.getRepository(ImpersonationSession).save(
      ds.getRepository(ImpersonationSession).create({
        platform_admin_id: w.owner.id,
        tenant_id: w.school.id,
        target_user_id: w.people[0].id,
        role: UserRole.TEACHER,
        status: 'APPROVED',
        entry_kind: 'NORMAL',
        reason: 'Helping with a marks import',
      }),
    );
    await service.activate(ticket.id);
    expect(await redis.exists(impKey(ticket.id))).toBe(1);
    expect(await redis.exists(impKey(older.id))).toBe(0);
    expect(await auditRows(ticket.id, AuditAction.IMPERSONATION_STARTED)).toHaveLength(1);
  });
});

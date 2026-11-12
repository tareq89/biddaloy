import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { AuditAction, ImpersonationStatus } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { PlatformAuditService } from './platform-audit.service';

describe('PlatformAuditService (integration)', () => {
  let module: TestingModule;
  let ds: DataSource;
  let svc: PlatformAuditService;
  const base = `pau${process.pid}`;
  let tag = base;
  let run = 0;
  let s1: string;
  let s2: string;
  let owner: string;
  let person: string;
  let sess: string;
  const userIds: string[] = [];
  const schoolIds: string[] = [];
  const auditIds: string[] = [];

  const mkUser = async (name: string) => {
    const [r] = await ds.query(
      `INSERT INTO users (full_name, email, status) VALUES ($1, $2, 'ACTIVE') RETURNING id`,
      [`${tag} ${name}`, `${tag}-${name}@x.test`],
    );
    userIds.push(r.id);
    return r.id as string;
  };
  const mkSchool = async (n: string) => {
    const [r] = await ds.query(`INSERT INTO schools (name, slug) VALUES ($1, $2) RETURNING id`, [
      `${tag} ${n}`,
      `${tag}-${n}`,
    ]);
    schoolIds.push(r.id);
    return r.id as string;
  };
  const mkAudit = async (
    tenant: string | null,
    action: string,
    secs: number,
    actor: string | null,
    sessionId: string | null = null,
    byAdmin: string | null = null,
  ) => {
    const [r] = await ds.query(
      `INSERT INTO audit_logs (tenant_id, action, entity_type, entity_id, performed_by_user_id,
         impersonated_by_platform_admin_id, impersonation_session_id, created_at, old_values, new_values)
       VALUES ($1, $2, 'T', COALESCE($3::uuid, gen_random_uuid()), $4, $5, $6, now() - make_interval(secs => $7::int),
         '{"secret":"old"}', '{"secret":"new"}')
       RETURNING id`,
      [tenant, action, null, actor, byAdmin, sessionId, secs],
    );
    auditIds.push(r.id);
    return r.id as string;
  };

  beforeAll(async () => {
    module = await createTestModule(ALL_ENTITIES, [PlatformAuditService]);
    ds = module.get(DataSource);
    svc = module.get(PlatformAuditService);
  });

  // The per-test reset wipes these tables, so every test seeds its own rows.
  beforeEach(async () => {
    tag = `${base}r${++run}`;
    s1 = await mkSchool('a');
    s2 = await mkSchool('b');
    owner = await mkUser('owner');
    person = await mkUser('person');
    await ds.query(`INSERT INTO platform_admins (user_id) VALUES ($1)`, [owner]);
    const [s] = await ds.query(
      `INSERT INTO impersonation_sessions (platform_admin_id, tenant_id, target_user_id, role, status,
         entry_kind, reason, requested_at, started_at, expires_at)
       VALUES ($1, $2, $3, 'TEACHER', 'ACTIVE', 'NORMAL', 'why', now() - interval '2 hours',
         now() - interval '2 hours', now() - interval '1 hour') RETURNING id`,
      [owner, s1, person],
    );
    sess = s.id;
    await mkAudit(s1, 'IMPERSONATION_STARTED', 50, owner, sess, owner);
    await mkAudit(s1, 'UPDATE', 40, person, sess, owner);
    await mkAudit(s1, 'UPDATE', 30, person, sess, owner);
    await mkAudit(s2, 'UPDATE', 20, person);
    await mkAudit(null, 'PLATFORM_USER_LOGOUT', 10, owner);
  });

  afterAll(async () => {
    // audit_logs is append-only in migrated DBs; leftovers are harmless.
    await ds
      .query(`DELETE FROM audit_logs WHERE id = ANY($1::uuid[])`, [auditIds])
      .catch(() => undefined);
    await ds.query(`DELETE FROM impersonation_sessions WHERE id = $1`, [sess]).catch(() => undefined);
    await ds.query(`DELETE FROM platform_admins WHERE user_id = $1`, [owner]).catch(() => undefined);
    await ds.query(`DELETE FROM users WHERE id = ANY($1)`, [userIds]).catch(() => undefined);
    await ds.query(`DELETE FROM schools WHERE id = ANY($1)`, [schoolIds]).catch(() => undefined);
    await module.close();
  });

  it('filters combine and show owner + session; no value columns leak', async () => {
    const { items } = await svc.search({
      tenantId: s1,
      action: 'UPDATE' as AuditAction,
      sessionId: sess,
    });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      schoolName: `${tag} a`,
      impersonatedByName: `${tag} owner`,
      sessionId: sess,
    });
    expect(JSON.stringify(items)).not.toMatch(/secret|old_values|new_values/);
    const byActor = await svc.search({ actorId: owner, tenantId: s1 });
    expect(byActor.items.map((i) => i.action)).toEqual(['IMPERSONATION_STARTED']);
  });

  it('tenant-less rows are Platform', async () => {
    const { items } = await svc.search({
      action: 'PLATFORM_USER_LOGOUT' as AuditAction,
      actorId: owner,
    });
    expect(items[0].schoolName).toBe('Platform');
    expect(items[0].tenantId).toBeNull();
  });

  it('the cursor returns each row exactly once across pages', async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    const from = new Date(Date.now() - 3600_000).toISOString();
    for (let i = 0; i < 200; i++) {
      const p = await svc.search({ limit: 2, cursor, from });
      seen.push(...p.items.map((x) => x.id));
      if (!p.nextCursor) break;
      cursor = p.nextCursor;
    }
    expect(auditIds.slice(-5).every((id) => seen.includes(id))).toBe(true);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('sessions: owner, person, EXPIRED shown from expires_at, changedCount excludes started/ended', async () => {
    const all = await svc.sessions({ ownerId: owner });
    expect(all.items).toHaveLength(1);
    expect(all.items[0]).toMatchObject({
      id: sess,
      ownerName: `${tag} owner`,
      personName: `${tag} person`,
      schoolName: `${tag} a`,
      status: ImpersonationStatus.EXPIRED,
      changedCount: 2,
      entryKind: 'NORMAL',
    });
    const exp = await svc.sessions({ ownerId: owner, status: ImpersonationStatus.EXPIRED });
    expect(exp.items).toHaveLength(1);
    const act = await svc.sessions({ ownerId: owner, status: ImpersonationStatus.ACTIVE });
    expect(act.items).toHaveLength(0);
    expect((await svc.sessions({ tenantId: s2 })).items).toHaveLength(0);
  });
});

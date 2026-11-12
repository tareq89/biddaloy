import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UserRole, UserStatus } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { AuditService } from '../../audit/audit.service';
import { REFRESH_TOKEN_TTL_MS, RefreshTokenService } from '../../auth/refresh-token.service';
import { SessionCutoffService } from '../../auth/session-cutoff.service';
import { PlatformUsersService } from './platform-users.service';

describe('PlatformUsersService (integration)', () => {
  let module: TestingModule;
  let ds: DataSource;
  let svc: PlatformUsersService;
  let refresh: RefreshTokenService;
  // Unique per run: the phone tail is 8 digits derived from pid + time.
  const stamp = `${process.pid}${Date.now()}`.slice(-8);
  const national = `17${stamp.slice(0, 8)}`.slice(0, 10);
  const tag = `pus${process.pid}`;
  const schoolIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    module = await createTestModule(ALL_ENTITIES, [
      PlatformUsersService,
      SessionCutoffService,
      RefreshTokenService,
      AuditService,
      { provide: REFRESH_TOKEN_TTL_MS, useValue: 60_000 },
    ]);
    ds = module.get(DataSource);
    svc = module.get(PlatformUsersService);
    refresh = module.get(RefreshTokenService);
  });

  afterAll(async () => {
    await ds.query(`DELETE FROM audit_logs WHERE entity_id = ANY($1::text[])`, [userIds]).catch(
      () => undefined, // audit_logs is append-only in migrated DBs; leftovers are harmless
    );
    await ds.query(`DELETE FROM refresh_tokens WHERE user_id = ANY($1)`, [userIds]);
    await ds.query(`DELETE FROM platform_admins WHERE user_id = ANY($1)`, [userIds]);
    await ds.query(`DELETE FROM user_tenants WHERE user_id = ANY($1)`, [userIds]);
    await ds.query(`DELETE FROM users WHERE id = ANY($1)`, [userIds]);
    await ds.query(`DELETE FROM schools WHERE id = ANY($1)`, [schoolIds]);
    await module.close();
  });

  const school = async (n: string) => {
    const [r] = await ds.query(`INSERT INTO schools (name, slug) VALUES ($1, $2) RETURNING id`, [
      `${tag} ${n}`,
      `${tag}-${n}`,
    ]);
    schoolIds.push(r.id);
    return r.id as string;
  };
  const user = async (name: string, phone: string | null, email: string | null) => {
    const [r] = await ds.query(
      `INSERT INTO users (full_name, phone, email, status) VALUES ($1, $2, $3, $4) RETURNING id`,
      [name, phone, email, UserStatus.ACTIVE],
    );
    userIds.push(r.id);
    return r.id as string;
  };
  const member = (userId: string, tenantId: string, role: UserRole) =>
    ds.query(`INSERT INTO user_tenants (user_id, tenant_id, role) VALUES ($1, $2, $3)`, [
      userId,
      tenantId,
      role,
    ]);

  it('finds the same person by +88, 880 and 0 phone prefixes; lists both schools; hides owners', async () => {
    const s1 = await school('a');
    const s2 = await school('b');
    const person = await user('Two Schools', `+880${national}`, `${tag}@x.test`);
    await member(person, s1, UserRole.TEACHER);
    await member(person, s2, UserRole.PARENT);
    // An owner with a phone ending in the same digits must never show up.
    const owner = await user('Owner', `+8801${'9'.repeat(9)}`, `${tag}-owner@x.test`);
    await ds.query(`INSERT INTO platform_admins (user_id) VALUES ($1)`, [owner]);

    for (const q of [`+880${national}`, `880${national}`, `0${national}`]) {
      const found = await svc.search(q);
      expect(found.map((f) => f.userId)).toEqual([person]);
    }
    const [item] = await svc.search(`0${national}`);
    expect(item.memberships.map((m) => m.schoolId).sort()).toEqual([s1, s2].sort());
    expect(item.memberships.every((m) => m.memberId.length > 0)).toBe(true);
    expect(item.emailMasked).not.toContain(tag);

    // Owners are not findable by phone or by email.
    expect(await svc.search('+8801999999999')).toEqual([]);
    expect(await svc.search(`${tag}-owner@x.test`)).toEqual([]);
    // Email is an exact match.
    expect((await svc.search(`${tag.toUpperCase()}@X.test`)).map((f) => f.userId)).toEqual([
      person,
    ]);
  });

  it('logout kills the access token and the refresh token; owner and unknown ids are 404', async () => {
    const person = await user('Logged Out', null, `${tag}-lo@x.test`);
    const issued = await refresh.issueForUser(person, randomUUID(), {
      ip: null,
      userAgent: null,
    });
    const actor = await user('Actor', null, null);

    await svc.logout(person, actor);

    const [row] = await ds.query(`SELECT tokens_valid_after FROM users WHERE id = $1`, [person]);
    expect(row.tokens_valid_after).toBeInstanceOf(Date); // access tokens older than this are refused
    await expect(refresh.rotate(issued.cookieValue, { ip: null, userAgent: null })).rejects.toThrow();
    const [log] = await ds.query(
      `SELECT tenant_id, performed_by_user_id FROM audit_logs
        WHERE action = 'PLATFORM_USER_LOGOUT' AND entity_id = $1`,
      [person],
    );
    expect(log.tenant_id).toBeNull();
    expect(log.performed_by_user_id).toBe(actor);

    const owner = await user('Owner2', null, null);
    await ds.query(`INSERT INTO platform_admins (user_id) VALUES ($1)`, [owner]);
    await expect(svc.logout(owner, actor)).rejects.toBeInstanceOf(NotFoundException);
    const [o] = await ds.query(`SELECT tokens_valid_after FROM users WHERE id = $1`, [owner]);
    expect(o.tokens_valid_after).toBeNull(); // the owner's sessions were not touched
    await expect(svc.logout(randomUUID(), actor)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a too-short phone is 400', async () => {
    await expect(svc.search('+8801')).rejects.toBeInstanceOf(BadRequestException);
  });
});

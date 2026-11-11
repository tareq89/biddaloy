import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { NotFoundException } from '@nestjs/common';
import { SupportAccessMode, UserRole, UserStatus } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { seedGuardian, seedStudent } from '@test/helpers/db.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SchoolSettingsReader } from '../../schools/settings/school-settings-reader.service';
import { School } from '../../schools/entities/school.entity';
import { User } from '../../users/entities/user.entity';
import { UserTenant } from '../../auth/entities/user-tenant.entity';
import { LoginAsCandidatesService } from './login-as-candidates.service';

describe('LoginAsCandidatesService (integration)', () => {
  let module: TestingModule;
  let ds: DataSource;
  let svc: LoginAsCandidatesService;

  beforeAll(async () => {
    module = await createTestModule(ALL_ENTITIES, [
      LoginAsCandidatesService,
      {
        provide: SchoolSettingsReader,
        useValue: { supportAccessFresh: async () => ({ mode: SupportAccessMode.ASK }) },
      },
    ]);
    ds = module.get(DataSource);
    svc = module.get(LoginAsCandidatesService);
  });

  afterAll(async () => {
    await module?.close();
  });

  const sfx = () => randomUUID().slice(0, 8);

  async function school() {
    const s = sfx();
    return ds
      .getRepository(School)
      .save(ds.getRepository(School).create({ name: `S ${s}`, slug: `s-${s}` }));
  }

  async function member(
    schoolId: string,
    role: UserRole,
    name: string,
    opts: { status?: UserStatus; lastLogin?: Date; removed?: boolean } = {},
  ) {
    const user = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        full_name: name,
        status: opts.status ?? UserStatus.ACTIVE,
        email: `${sfx()}@t.test`,
        last_login_at: opts.lastLogin ?? null,
      }),
    );
    const ut = await ds
      .getRepository(UserTenant)
      .save({ user_id: user.id, tenant_id: schoolId, role });
    if (opts.removed) await ds.getRepository(UserTenant).softDelete(ut.id);
    return user;
  }

  it('orders by last login (newest first, never-logged-in last), then name; returns email, never a hash', async () => {
    const sch = await school();
    const old = await member(sch.id, UserRole.ADMIN, 'Old', { lastLogin: new Date('2020-01-01') });
    const recent = await member(sch.id, UserRole.ADMIN, 'Recent', {
      lastLogin: new Date('2025-01-01'),
    });
    const never = await member(sch.id, UserRole.ADMIN, 'Never');
    const res = await svc.list(sch.id, UserRole.ADMIN, undefined, 50);
    expect(res.candidates.map((c) => c.userId)).toEqual([recent.id, old.id, never.id]);
    expect(res.candidates[0].email).toContain('@t.test');
    expect(Object.keys(res.candidates[0]).sort()).toEqual(
      ['email', 'name', 'phone', 'role', 'unavailableReason', 'userId'].sort(),
    );
    expect(res.schoolStatus).toBe('ACTIVE');
    expect(res.supportAccessMode).toBe(SupportAccessMode.ASK);
  });

  it('noActiveAdmin is true when the only admin is suspended or removed, false with one active admin', async () => {
    const suspended = await school();
    await member(suspended.id, UserRole.ADMIN, 'Sus', { status: UserStatus.SUSPENDED });
    const res = await svc.list(suspended.id, UserRole.TEACHER, undefined, 50);
    expect(res.noActiveAdmin).toBe(true);

    const removed = await school();
    await member(removed.id, UserRole.ADMIN, 'Gone', { removed: true });
    expect((await svc.list(removed.id, UserRole.ADMIN, undefined, 50)).noActiveAdmin).toBe(true);

    const ok = await school();
    await member(ok.id, UserRole.ADMIN, 'Fine');
    expect((await svc.list(ok.id, UserRole.TEACHER, undefined, 50)).noActiveAdmin).toBe(false);
  });

  it('marks inactive staff, drops removed memberships (soft delete)', async () => {
    const sch = await school();
    await member(sch.id, UserRole.TEACHER, 'Active T');
    await member(sch.id, UserRole.TEACHER, 'Inactive T', { status: UserStatus.INACTIVE });
    await member(sch.id, UserRole.TEACHER, 'Removed T', { removed: true });
    const res = await svc.list(sch.id, UserRole.TEACHER, undefined, 50);
    const byName = Object.fromEntries(res.candidates.map((c) => [c.name, c.unavailableReason]));
    expect(byName).toEqual({ 'Active T': null, 'Inactive T': 'INACTIVE' });
  });

  it('students: active, inactive, removed and accountless', async () => {
    const sch = await school();
    const mkUser = (status: UserStatus) =>
      ds.getRepository(User).save(ds.getRepository(User).create({ full_name: 'u', status }));
    const a = await mkUser(UserStatus.ACTIVE);
    const i = await mkUser(UserStatus.INACTIVE);
    const base = { tenant_id: sch.id };
    await seedStudent(ds, {
      ...base,
      full_name: 'S Active',
      registration_number: 'R1',
      roll_number: 1,
    });
    await ds.query(
      `UPDATE students SET user_id = $1 WHERE registration_number = 'R1' AND tenant_id = $2`,
      [a.id, sch.id],
    );
    await seedStudent(ds, {
      ...base,
      full_name: 'S Inactive',
      registration_number: 'R2',
      roll_number: 2,
    });
    await ds.query(
      `UPDATE students SET user_id = $1 WHERE registration_number = 'R2' AND tenant_id = $2`,
      [i.id, sch.id],
    );
    await seedStudent(ds, {
      ...base,
      full_name: 'S Nologin',
      registration_number: 'R3',
      roll_number: 3,
    });
    const gone = await seedStudent(ds, {
      ...base,
      full_name: 'S Removed',
      registration_number: 'R4',
      roll_number: 4,
    });
    await ds.query(`UPDATE students SET deleted_at = now() WHERE id = $1`, [gone.id]);

    const res = await svc.list(sch.id, UserRole.STUDENT, undefined, 50);
    const byName = Object.fromEntries(res.candidates.map((c) => [c.name, c]));
    expect(Object.keys(byName).sort()).toEqual(['S Active', 'S Inactive', 'S Nologin']);
    expect(byName['S Active'].unavailableReason).toBeNull();
    expect(byName['S Inactive'].unavailableReason).toBe('INACTIVE');
    expect(byName['S Nologin']).toMatchObject({
      userId: null,
      unavailableReason: 'NO_LOGIN_ACCOUNT',
    });
  });

  it('parents without an account are listed with NO_LOGIN_ACCOUNT', async () => {
    const sch = await school();
    await seedGuardian(ds, { tenant_id: sch.id, full_name: 'Parent P' });
    const res = await svc.list(sch.id, UserRole.PARENT, undefined, 50);
    expect(res.candidates).toHaveLength(1);
    expect(res.candidates[0]).toMatchObject({
      userId: null,
      unavailableReason: 'NO_LOGIN_ACCOUNT',
      email: 'guardian@test.com',
    });
  });

  it('search treats % and _ literally', async () => {
    const sch = await school();
    await member(sch.id, UserRole.ADMIN, '100% Real');
    await member(sch.id, UserRole.ADMIN, '100x Real');
    await member(sch.id, UserRole.ADMIN, 'a_b');
    await member(sch.id, UserRole.ADMIN, 'axb');
    const pct = await svc.list(sch.id, UserRole.ADMIN, '100%', 50);
    expect(pct.candidates.map((c) => c.name)).toEqual(['100% Real']);
    const us = await svc.list(sch.id, UserRole.ADMIN, 'a_b', 50);
    expect(us.candidates.map((c) => c.name)).toEqual(['a_b']);
  });

  it('limit caps the rows', async () => {
    const sch = await school();
    for (const n of ['A', 'B', 'C']) await member(sch.id, UserRole.ACCOUNTANT, n);
    expect((await svc.list(sch.id, UserRole.ACCOUNTANT, undefined, 2)).candidates).toHaveLength(2);
  });

  it('cross-tenant: school B people never appear in school A', async () => {
    const a = await school();
    const b = await school();
    await member(a.id, UserRole.ADMIN, 'In A');
    await member(b.id, UserRole.ADMIN, 'In B');
    await seedGuardian(ds, { tenant_id: b.id, full_name: 'Parent B' });
    expect(
      (await svc.list(a.id, UserRole.ADMIN, undefined, 50)).candidates.map((c) => c.name),
    ).toEqual(['In A']);
    expect(
      (await svc.list(b.id, UserRole.ADMIN, undefined, 50)).candidates.map((c) => c.name),
    ).toEqual(['In B']);
    expect((await svc.list(a.id, UserRole.PARENT, undefined, 50)).candidates).toEqual([]);
  });

  it('unknown school is a fixed 404', async () => {
    await expect(svc.list(randomUUID(), UserRole.ADMIN, undefined, 5)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

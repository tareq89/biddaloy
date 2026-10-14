import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { UserRole } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { AuditService } from '../src/modules/audit/audit.service';
import { AuthTokenService } from '../src/modules/account-access/auth-token.service';
import {
  insertJoinRequest,
  SchoolInviteService,
} from '../src/modules/account-access/school-invite.service';
import { StaffProfilesService } from '../src/modules/staff-profiles/staff-profiles.service';
import { UserService, TeacherService } from '../src/modules/users/users.service';
import { AccessTokenDenylistService } from '../src/modules/auth/access-token-denylist.service';
import { ACCESS_TOKEN_TTL_MS } from '../src/modules/auth/auth-tokens';
import { SessionCutoffService } from '../src/modules/auth/session-cutoff.service';
import { RefreshTokenService } from '../src/modules/auth/refresh-token.service';
import { teacherSectionIds } from '../src/modules/classes/teacher-scope.service';
import { Guardian } from '../src/modules/students/entities/guardian.entity';
import { Teacher } from '../src/modules/academics/entities/teacher.entity';
import { UserTenant } from '../src/modules/auth/entities/user-tenant.entity';

/**
 * [58.0.02] One person (user U) works in two schools: a profile lookup by
 * user always carries the school, so each school sees its own Teacher /
 * StaffProfile / Guardian row for U and never the other's (D11, D13, D14).
 *
 * Runs on the migrated DB with its own schools and users (left behind: audit_logs is
 * append-only, and the test DB is dropped per run).
 */
describe('multi-branch person (integration)', () => {
  let module: TestingModule;
  let ds: DataSource;
  let teachers: TeacherService;
  let users: UserService;
  let staffProfiles: StaffProfilesService;
  let invites: SchoolInviteService;
  const CTX = { ip: null, userAgent: null };

  beforeAll(async () => {
    module = await createTestModule(ALL_ENTITIES, [
      TeacherService,
      UserService,
      StaffProfilesService,
      SchoolInviteService,
      AuthTokenService,
      AuditService,
      { provide: AccessTokenDenylistService, useValue: { revokeUserTokensIssuedBefore: vi.fn() } },
      { provide: ACCESS_TOKEN_TTL_MS, useValue: 900_000 },
      SessionCutoffService,
      { provide: RefreshTokenService, useValue: { revokeAllForUser: vi.fn() } },
    ]);
    ds = module.get(DataSource);
    teachers = module.get(TeacherService);
    users = module.get(UserService);
    staffProfiles = module.get(StaffProfilesService);
    invites = module.get(SchoolInviteService);
  }, 60000);

  afterAll(async () => {
    // audit_logs is append-only, so the rows this spec made stay; the test DB is dropped per run.
    await module.close();
  });

  const mkSchool = async () => {
    const id = randomUUID();
    await ds.query(`INSERT INTO schools (id, name, slug) VALUES ($1, $2, $3)`, [
      id,
      `S ${id}`,
      `mb-${id}`,
    ]);
    return id;
  };
  const mkUser = async () => {
    const id = randomUUID();
    await ds.query(
      `INSERT INTO users (id, email, password_hash, full_name, status) VALUES ($1, $2, 'x', 'U', 'ACTIVE')`,
      [id, `mb-${id}@example.com`],
    );
    return id;
  };
  const member = (userId: string, tenantId: string, role: UserRole) =>
    ds.query(`INSERT INTO user_tenants (user_id, tenant_id, role) VALUES ($1, $2, $3)`, [
      userId,
      tenantId,
      role,
    ]);

  it('promotes the same ADMIN to teacher in school A, then B; a repeat in A is 409 ALREADY_TEACHER_HERE', async () => {
    const [a, b, u] = [await mkSchool(), await mkSchool(), await mkUser()];
    await member(u, a, UserRole.ADMIN);
    await member(u, b, UserRole.ADMIN);

    const tA = await teachers.create({ user_id: u, employee_id: 'T-001' }, a);
    const tB = await teachers.create({ user_id: u, employee_id: 'T-001' }, b);
    expect(tA.tenant_id).toBe(a);
    expect(tB.tenant_id).toBe(b);

    const again = teachers.create({ user_id: u, employee_id: 'T-002' }, a);
    await expect(again).rejects.toBeInstanceOf(ConflictException);
    await expect(again).rejects.toMatchObject({
      response: { details: { code: 'ALREADY_TEACHER_HERE' } },
    });

    // Each school has its own StaffProfile; findIdByUserId answers per school.
    const [spA, spB] = [
      await staffProfiles.findIdByUserId(u, a),
      await staffProfiles.findIdByUserId(u, b),
    ];
    expect(spA).toBeTruthy();
    expect(spB).toBeTruthy();
    expect(spA).not.toBe(spB);
    expect(await ds.getRepository(Teacher).findOneByOrFail({ id: tB.id })).toMatchObject({
      staff_profile_id: spB,
    });
    expect([...(await staffProfiles.findIdsByUserIds([u], b)).values()]).toEqual([spB]);
  });

  it('promoting a real ADMIN (made by UserService.create, who already has a staff profile) reuses it', async () => {
    const [a, b] = [await mkSchool(), await mkSchool()];
    const { user } = await users.create(
      {
        full_name: 'Real Admin',
        email: `real-admin-${randomUUID()}@example.com`,
        password: 'Str0ng!Passw0rd',
        role: UserRole.ADMIN,
      },
      a,
    );
    const profileA = await staffProfiles.findIdByUserId(user.id, a);
    expect(profileA).toBeTruthy();

    const teacherA = await teachers.create({ user_id: user.id, employee_id: 'IGNORED-1' }, a);
    expect(teacherA.staff_profile_id).toBe(profileA);

    // Same person is ADMIN at school B too (membership by accept in real life; created here).
    await member(user.id, b, UserRole.ADMIN);
    await staffProfiles.createFor(user.id, b, {});
    const profileB = await staffProfiles.findIdByUserId(user.id, b);
    const teacherB = await teachers.create({ user_id: user.id, employee_id: 'IGNORED-2' }, b);
    expect(teacherB.staff_profile_id).toBe(profileB);
    expect(profileB).not.toBe(profileA);
  });

  it('promoting with a reused staff profile checks the employee ID actually written (409, not 23505)', async () => {
    const a = await mkSchool();
    const mkAdmin = async (name: string) =>
      (
        await users.create(
          {
            full_name: name,
            email: `${name}-${randomUUID()}@example.com`,
            password: 'Str0ng!Passw0rd',
            role: UserRole.ADMIN,
          },
          a,
        )
      ).user;
    const staffIdOf = async (userId: string) =>
      (
        await ds.query(
          `SELECT employee_id FROM staff_profiles WHERE user_id = $1 AND tenant_id = $2`,
          [userId, a],
        )
      )[0].employee_id as string;

    // The typed ID is not written, so a clash on it must not block.
    const t1 = await mkUser();
    await member(t1, a, UserRole.TEACHER);
    await teachers.create({ user_id: t1, employee_id: 'TYPED-1' }, a);
    const admin1 = await mkAdmin('admin-one');
    const promoted = await teachers.create({ user_id: admin1.id, employee_id: 'TYPED-1' }, a);
    expect(promoted.employee_id).toBe(await staffIdOf(admin1.id));

    // The reused staff ID is already on another teacher (edited via PATCH /teachers).
    const admin2 = await mkAdmin('admin-two');
    const t2 = await mkUser();
    await member(t2, a, UserRole.TEACHER);
    const other = await teachers.create({ user_id: t2, employee_id: 'TMP-2' }, a);
    await ds.query(`UPDATE teachers SET employee_id = $1 WHERE id = $2`, [
      await staffIdOf(admin2.id),
      other.id,
    ]);
    await expect(teachers.create({ user_id: admin2.id, employee_id: 'FREE-2' }, a)).rejects.toThrow(
      ConflictException,
    );
  });

  it('teacher section scope in school B sees only school B sections', async () => {
    const [a, b, u] = [await mkSchool(), await mkSchool(), await mkUser()];
    await member(u, a, UserRole.TEACHER);
    await member(u, b, UserRole.TEACHER);
    const sections: Record<string, string> = {};
    for (const t of [a, b]) {
      const teacher = await teachers.create({ user_id: u, employee_id: `T-${t.slice(0, 6)}` }, t);
      const [year] = await ds.query(
        `INSERT INTO academic_years (name, start_date, end_date, is_current, tenant_id)
         VALUES ('Y', '2026-01-01', '2026-12-31', true, $1) RETURNING id`,
        [t],
      );
      const [klass] = await ds.query(
        `INSERT INTO classes (tenant_id, name, academic_year_id) VALUES ($1, 'C', $2) RETURNING id`,
        [t, year.id],
      );
      const [section] = await ds.query(
        `INSERT INTO class_sections (tenant_id, class_id, section_name) VALUES ($1, $2, 'A') RETURNING id`,
        [t, klass.id],
      );
      await ds.query(
        `INSERT INTO teacher_class_sections (teacher_id, section_id, tenant_id, assignment_type)
         VALUES ($1, $2, $3, 'CLASS_TEACHER')`,
        [teacher.id, section.id, t],
      );
      sections[t] = section.id;
    }
    expect(await teacherSectionIds(ds.manager, { userId: u, tenantId: b })).toEqual([sections[b]]);
    expect(await teacherSectionIds(ds.manager, { userId: u, tenantId: a })).toEqual([sections[a]]);
  });

  it('a guardian account joins school B by request: 2 Guardian rows and 2 PARENT memberships after accept', async () => {
    const [a, b, u] = [await mkSchool(), await mkSchool(), await mkUser()];
    const mkGuardian = async (tenantId: string) => {
      const [g] = await ds.query(
        `INSERT INTO guardians (tenant_id, full_name, relationship, phone) VALUES ($1, 'G', 'FATHER', '+8801700000001') RETURNING id`,
        [tenantId],
      );
      return g.id as string;
    };
    const [gA, gB] = [await mkGuardian(a), await mkGuardian(b)];
    const file = (tenantId: string, guardianId: string) =>
      ds.transaction((m) =>
        insertJoinRequest(m, {
          userId: u,
          tenantId,
          role: UserRole.PARENT,
          createdByUserId: null,
          guardianId,
        }),
      );

    // U has no membership in B until accepting.
    const reqA = await file(a, gA);
    await invites.accept(u, reqA.id, CTX);
    const reqB = await file(b, gB);
    expect(await ds.getRepository(UserTenant).count({ where: { user_id: u, tenant_id: b } })).toBe(
      0,
    );
    await invites.accept(u, reqB.id, CTX);

    expect(await ds.getRepository(Guardian).count({ where: { user_id: u } })).toBe(2);
    const memberships = await ds.getRepository(UserTenant).find({ where: { user_id: u } });
    expect(memberships.map((m) => [m.tenant_id, m.role]).sort()).toEqual(
      [
        [a, UserRole.PARENT],
        [b, UserRole.PARENT],
      ].sort(),
    );
  });
});

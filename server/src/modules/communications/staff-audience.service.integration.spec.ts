import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { UserRole } from '@biddaloy/shared';
import { Teacher } from '../academics/entities/teacher.entity';
import { StaffAudienceService } from './staff-audience.service';

/**
 * [80.1.04] Real rows for two schools: removed and suspended members never come back, another
 * school's people are ignored even when named, designations / teaching work, and a coordinator
 * sees only the teachers of the classes they coordinate.
 */
describe('StaffAudienceService (integration)', () => {
  let ds: DataSource;
  let service: StaffAudienceService;
  const tag = randomUUID().slice(0, 8);
  let a: string;
  let b: string;
  let c1: { c: string; s: string };
  let c2: { c: string; s: string };
  const ids: Record<string, string> = {};

  async function school(name: string): Promise<string> {
    const [{ id }] = await ds.query(
      `INSERT INTO schools (id, name, slug) VALUES (gen_random_uuid(), $1, $2) RETURNING id`,
      [name, `sa-${name}-${tag}`],
    );
    return id;
  }
  async function member(
    key: string,
    tenant: string,
    role: UserRole,
    opts: { phone?: string | null; status?: string; removed?: boolean } = {},
  ): Promise<string> {
    const [{ id }] = await ds.query(
      `INSERT INTO users (email, password_hash, full_name, phone, status, created_at, updated_at)
       VALUES ($1, 'x', $2, $3, $4, NOW(), NOW()) RETURNING id`,
      [
        `${key}-${tag}@sa.example`,
        key,
        opts.phone === undefined ? `+8801${Math.floor(1e9 + Math.random() * 8e9)}` : opts.phone,
        opts.status ?? 'ACTIVE',
      ],
    );
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, deleted_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())`,
      [id, tenant, role, opts.removed ? new Date() : null],
    );
    ids[key] = id;
    return id;
  }
  async function designate(userId: string, tenant: string, teaching: boolean): Promise<string> {
    const [{ id: d }] = await ds.query(
      `INSERT INTO designations (tenant_id, title_en, is_teaching, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) RETURNING id`,
      [tenant, `D-${randomUUID().slice(0, 8)}`, teaching],
    );
    await ds.query(
      `INSERT INTO staff_designation_history (tenant_id, user_id, designation_id, effective_date, status, created_at, updated_at)
       VALUES ($1, $2, $3, '2020-01-01', 'REGULAR', NOW(), NOW())`,
      [tenant, userId, d],
    );
    return d;
  }

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [StaffAudienceService]);
    ds = module.get<DataSource>(getDataSourceToken());
    service = module.get(StaffAudienceService);
    a = await school('a');
    b = await school('b');

    await member('t1', a, UserRole.TEACHER);
    await member('t2', a, UserRole.TEACHER);
    await member('office', a, UserRole.OFFICE_STAFF, { phone: null });
    await member('suspended', a, UserRole.TEACHER, { status: 'SUSPENDED' });
    await member('removed', a, UserRole.TEACHER, { removed: true });
    await member('otherSchool', b, UserRole.TEACHER);

    // Coordinator "coord" coordinates class C1 where t1 teaches; t2 teaches elsewhere.
    await member('coord', a, UserRole.TEACHER);
    const [{ id: year }] = await ds.query(
      `INSERT INTO academic_years (name, start_date, end_date, is_current, tenant_id, created_at, updated_at)
       VALUES ($1, '2026-01-01', '2026-12-31', true, $2, NOW(), NOW()) RETURNING id`,
      [`SA ${tag}`, a],
    );
    const section = async (name: string) => {
      const [{ id: c }] = await ds.query(
        `INSERT INTO classes (tenant_id, name, academic_year_id) VALUES ($1, $2, $3) RETURNING id`,
        [a, `SA ${name} ${tag}`, year],
      );
      const [{ id: s }] = await ds.query(
        `INSERT INTO class_sections (tenant_id, class_id, section_name) VALUES ($1, $2, 'A') RETURNING id`,
        [a, c],
      );
      return { c: c as string, s: s as string };
    };
    c1 = await section('C1');
    c2 = await section('C2');
  }, 60000);

  // The harness truncates teachers / assignments / designations before every `it()`: re-seed.
  beforeEach(async () => {
    ids.teachDes = await designate(ids.t1, a, true);
    await designate(ids.office, a, false);
    await designate(ids.suspended, a, true);
    const repo = ds.getRepository(Teacher);
    const mk = (userId: string, n: string) =>
      repo.save({
        user_id: userId,
        employee_id: `SA-${n}-${randomUUID()}`,
        tenant_id: a,
        designations: [],
      });
    const [tc, t1, t2] = [await mk(ids.coord, 'c'), await mk(ids.t1, '1'), await mk(ids.t2, '2')];
    await ds.query(
      `INSERT INTO teacher_class_sections (teacher_id, section_id, tenant_id, assignment_type)
       VALUES ($1, $2, $4, 'CLASS_TEACHER'), ($3, $5, $4, 'CLASS_TEACHER')`,
      [t1.id, c1.s, t2.id, a, c2.s],
    );
    await ds.query(
      `INSERT INTO coordinator_assignments (tenant_id, teacher_id, class_id) VALUES ($1, $2, $3)`,
      [a, tc.id, c1.c],
    );
  });

  afterAll(async () => {
    await ds.destroy();
  });

  it('role audience: active members only, no phone is skipped (suspended and removed never appear)', async () => {
    const res = await service.resolve(a, { roles: [UserRole.TEACHER, UserRole.OFFICE_STAFF] });
    const got = [...res.recipients, ...res.skipped].map((r) => r.user_id);
    expect(got).toEqual(expect.arrayContaining([ids.t1, ids.t2, ids.office, ids.coord]));
    expect(got).not.toContain(ids.suspended);
    expect(got).not.toContain(ids.removed);
    expect(got).not.toContain(ids.otherSchool);
    expect(res.skipped.map((s) => s.user_id)).toEqual([ids.office]);
  });

  it('named people of another school are ignored (tenant isolation)', async () => {
    const res = await service.resolve(a, { userIds: [ids.otherSchool, ids.t1] });
    expect(res.recipients.map((r) => r.user_id)).toEqual([ids.t1]);
  });

  it('a person matching a role and a designation appears once', async () => {
    const res = await service.resolve(a, {
      roles: [UserRole.TEACHER],
      designationIds: [ids.teachDes],
      teaching: true,
      userIds: [ids.t1],
    });
    expect(res.recipients.filter((r) => r.user_id === ids.t1)).toHaveLength(1);
  });

  it('teaching true / false follow the designation flag', async () => {
    const yes = await service.resolve(a, { teaching: true });
    expect(yes.recipients.map((r) => r.user_id)).toEqual([ids.t1]); // suspended teaching one is out
    const no = await service.resolve(a, { teaching: false });
    expect(no.skipped.map((r) => r.user_id)).toEqual([ids.office]);
  });

  it('a coordinator sees only teachers of the coordinated class', async () => {
    const res = await service.resolve(
      a,
      { roles: [UserRole.TEACHER] },
      { coordinatedOnly: true, callerUserId: ids.coord },
    );
    expect(res.recipients.map((r) => r.user_id)).toEqual([ids.t1]);
  });

  it('a teacher who coordinates nothing gets an empty list', async () => {
    const res = await service.resolve(
      a,
      { roles: [UserRole.TEACHER] },
      { coordinatedOnly: true, callerUserId: ids.t2 },
    );
    expect(res).toEqual({ recipients: [], skipped: [] });
  });
});

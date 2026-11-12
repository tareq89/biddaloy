import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { UserRole, UserStatus } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { UserTenant } from '../../auth/entities/user-tenant.entity';
import { School } from '../../schools/entities/school.entity';
import { PlatformSchoolNote } from '../../support-access/entities/platform-school-note.entity';
import { User } from '../../users/entities/user.entity';
import { SchoolOverviewService } from './school-overview.service';

describe('SchoolOverviewService (integration)', () => {
  let module: TestingModule;
  let ds: DataSource;
  let svc: SchoolOverviewService;
  let homeId: string | undefined;

  beforeAll(async () => {
    module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get(DataSource);
    // Composed services own their own wiring and have their own specs; the new SQL runs on the real DB.
    svc = new SchoolOverviewService(
      ds,
      { getStats: async () => ({ last_activity_at: null }) } as never,
      {
        list: async (id: string) => {
          const rows = await ds.getRepository(UserTenant).find({
            where: { tenant_id: id, role: UserRole.ADMIN },
            relations: { user: true },
          });
          return rows.map((m) => ({
            user_id: m.user_id,
            name: m.user!.full_name,
            email: m.user!.email,
            phone: m.user!.phone,
            membership_status: m.user!.status,
          }));
        },
      } as never,
      { getBalance: async () => ({ available: 0, reserved: 0 }) } as never,
      { id: async () => homeId } as never,
    );
  });

  afterAll(async () => {
    await module?.close();
  });

  const sfx = () => randomUUID().slice(0, 8);
  const school = () => {
    const s = sfx();
    return ds
      .getRepository(School)
      .save(ds.getRepository(School).create({ name: `S ${s}`, slug: `s-${s}` }));
  };
  const member = async (tenantId: string, role: UserRole, email?: string) => {
    const u = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        full_name: `U ${sfx()}`,
        status: UserStatus.ACTIVE,
        email: email ?? null,
      }),
    );
    await ds
      .getRepository(UserTenant)
      .save(ds.getRepository(UserTenant).create({ user_id: u.id, tenant_id: tenantId, role }));
    return u;
  };

  it('every number is the school own: two schools, masked admin, notes count', async () => {
    const a = await school();
    const b = await school();
    const admin = await member(a.id, UserRole.ADMIN, `a-${sfx()}@x.com`);
    await member(a.id, UserRole.TEACHER);
    await member(b.id, UserRole.TEACHER);
    await member(b.id, UserRole.TEACHER);
    await ds
      .getRepository(PlatformSchoolNote)
      .save({ tenant_id: a.id, author_id: admin.id, body: 'n' });

    const outA = await svc.get(a.id);
    const outB = await svc.get(b.id);
    expect(outA.peopleByRole).toEqual([
      { role: UserRole.ADMIN, count: 1 },
      { role: UserRole.TEACHER, count: 1 },
    ]);
    expect(outB.peopleByRole).toEqual([{ role: UserRole.TEACHER, count: 2 }]);
    expect(outA.notesCount).toBe(1);
    expect(outB.notesCount).toBe(0);
    expect(outA.admins![0].email).toContain('•••');
    expect(outA.filesBytes).toBe(0);
  });

  it('alerts and audit rows come from the real SQL and are per school', async () => {
    const a = await school();
    const b = await school();
    const owner = await member(a.id, UserRole.ADMIN);
    // Soft-fail would turn a wrong column into null, so assert non-null values.
    await ds.query(
      `INSERT INTO alerts (tenant_id, rule_key, source, severity, category, status, dedupe_key)
       VALUES ($1, 'r', 'RULE', 'CRITICAL', 'SYSTEM', 'ACTIVE', $2)`,
      [a.id, `d-${sfx()}`],
    );
    await ds.query(
      `INSERT INTO audit_logs (tenant_id, action, entity_type, performed_by_user_id)
       VALUES ($1, 'UPDATE', 'School', $2)`,
      [a.id, owner.id],
    );

    const outA = await svc.get(a.id);
    const outB = await svc.get(b.id);
    expect(outA.openAlerts).toEqual([{ severity: 'CRITICAL', count: 1 }]);
    expect(outB.openAlerts).toEqual([]);
    expect(outA.recentAudit).toHaveLength(1);
    expect(outA.recentAudit![0]).toMatchObject({
      action: 'UPDATE',
      actorName: owner.full_name,
      viaLoginAs: false,
    });
    expect(outB.recentAudit).toEqual([]);
    expect(outA.filesBytes).toBe(0); // files SQL runs (non-null); a size fixture needs a Notice graph, left out
  });

  it('platform-home and unknown ids are 404', async () => {
    const home = await school();
    homeId = home.id;
    await expect(svc.get(home.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.get(randomUUID())).rejects.toBeInstanceOf(NotFoundException);
    homeId = undefined;
  });
});

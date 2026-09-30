import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { ForbiddenException, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { AdmissionReportsService } from './admission-reports.service';
import { AdmissionReportsController } from './admission-reports.controller';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { UserRole } from '@biddaloy/shared';

/** [39.5.1] Lifecycle report: counts/rows, class + year filters, tenant isolation, permission. */
describe('AdmissionReportsService (integration)', () => {
  let ds: DataSource;
  let svc: AdmissionReportsService;

  const T1 = '39500000-0000-4000-8000-000000000001';
  const T2 = '39500000-0000-4000-8000-000000000002';

  async function seedTenant(tenant: string, slug: string) {
    await ds.query(`INSERT INTO schools (id, name, slug) VALUES ($1, $2, $2)`, [tenant, slug]);
    const years: string[] = [];
    for (const name of ['y1', 'y2']) {
      const [y] = await ds.query(
        `INSERT INTO academic_years (name, start_date, end_date, is_current, tenant_id)
         VALUES ($1, '2026-01-01', '2026-12-31', false, $2) RETURNING id`,
        [name, tenant],
      );
      years.push(y.id);
    }
    const classes: { classId: string; sectionId: string }[] = [];
    for (const name of ['Six', 'Seven']) {
      const [c] = await ds.query(
        `INSERT INTO classes (name, numeric_grade, academic_year_id, tenant_id)
         VALUES ($1, 6, $2, $3) RETURNING id`,
        [name, years[0], tenant],
      );
      const [s] = await ds.query(
        `INSERT INTO class_sections (class_id, section_name, tenant_id) VALUES ($1, 'A', $2) RETURNING id`,
        [c.id, tenant],
      );
      classes.push({ classId: c.id, sectionId: s.id });
    }
    return { years, classes };
  }

  let n = 0;
  async function seedEvent(
    tenant: string,
    ctx: Awaited<ReturnType<typeof seedTenant>>,
    cls: number,
    year: number,
    type: string,
    occurredOn: string,
  ) {
    n += 1;
    const { classId, sectionId } = ctx.classes[cls];
    const [st] = await ds.query(
      `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [`Stu ${n}`, `R39-${tenant.slice(-1)}-${n}`, n, sectionId, tenant],
    );
    const [en] = await ds.query(
      `INSERT INTO enrollments (student_id, class_id, section_id, academic_year_id, enrollment_status, tenant_id)
       VALUES ($1, $2, $3, $4, 'INACTIVE', $5) RETURNING id`,
      [st.id, classId, sectionId, ctx.years[year], tenant],
    );
    await ds.query(
      `INSERT INTO student_lifecycle_events
         (tenant_id, student_id, enrollment_id, academic_year_id, event_type, occurred_on, reason)
       VALUES ($1, $2, $3, $4, $5, $6, 'r')`,
      [tenant, st.id, en.id, ctx.years[year], type, occurredOn],
    );
  }

  async function seedAdmitted(tenant: string, ctx: Awaited<ReturnType<typeof seedTenant>>, cls: number) {
    n += 1;
    const [intake] = await ds.query(
      `INSERT INTO admission_intakes (tenant_id, class_section_id, title, seat_count, open_date, close_date)
       VALUES ($1, $2, 'i', 5, '2026-01-01', '2026-02-01') RETURNING id`,
      [tenant, ctx.classes[cls].sectionId],
    );
    await ds.query(
      `INSERT INTO admission_applicants
         (tenant_id, intake_id, reference_number, applicant_name, date_of_birth, gender, guardian_name, guardian_phone, status)
       VALUES ($1, $2, $3, 'Applicant', '2015-01-01', 'M', 'G', $4, 'ADMITTED')`,
      [tenant, intake.id, `REF-${n}`, `0170000${n}`],
    );
  }

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [AdmissionReportsService]);
    ds = module.get(DataSource);
    svc = module.get(AdmissionReportsService);
  });

  afterAll(async () => {
    if (!ds) return;
    for (const t of ['admission_applicants', 'admission_intakes', 'student_lifecycle_events', 'enrollments', 'students', 'class_sections', 'classes', 'academic_years']) {
      await ds.query(`DELETE FROM ${t} WHERE tenant_id IN ($1, $2)`, [T1, T2]);
    }
    await ds.query(`DELETE FROM schools WHERE id IN ($1, $2)`, [T1, T2]);
    await ds.destroy();
  });

  it('counts/rows, class + year filters, tenant isolation', async () => {
    const c1 = await seedTenant(T1, 'ar-1');
    const c2 = await seedTenant(T2, 'ar-2');
    await seedEvent(T1, c1, 0, 0, 'WITHDRAWN', '2026-03-01');
    await seedEvent(T1, c1, 0, 0, 'GRADUATED', '2026-04-01');
    await seedEvent(T1, c1, 1, 0, 'READMITTED', '2026-05-01');
    await seedEvent(T1, c1, 1, 1, 'WITHDRAWN', '2026-06-01'); // other year
    await seedEvent(T2, c2, 0, 0, 'WITHDRAWN', '2026-03-01'); // other tenant
    await seedAdmitted(T1, c1, 0);
    await seedAdmitted(T2, c2, 0);

    const all = await svc.lifecycle(T1, { academic_year_id: c1.years[0] });
    expect(all.counts).toEqual({
      admitted: 1,
      withdrawn: 1,
      transferred_out: 0,
      graduated: 1,
      readmitted: 1,
    });
    expect(all.rows).toHaveLength(4);
    expect(all.truncated).toBe(false);
    const dates = all.rows.map((r) => r.occurred_on);
    expect(dates).toEqual([...dates].sort().reverse());

    const cls = await svc.lifecycle(T1, {
      academic_year_id: c1.years[0],
      class_id: c1.classes[1].classId,
    });
    expect(cls.counts).toMatchObject({ admitted: 0, withdrawn: 0, readmitted: 1 });
    expect(cls.rows.map((r) => r.event_type)).toEqual(['READMITTED']);

    const y2 = await svc.lifecycle(T1, { academic_year_id: c1.years[1] });
    expect(y2.counts.withdrawn).toBe(1);
    expect(y2.counts.graduated).toBe(0);

    // T2's year id under T1 returns nothing: no cross-tenant leak.
    const leak = await svc.lifecycle(T1, { academic_year_id: c2.years[0] });
    expect(leak.rows).toHaveLength(0);
    expect(Object.values(leak.counts).every((v) => v === 0)).toBe(true);
  });

  it('TEACHER gets 403, ADMIN passes', () => {
    const guard = new PermissionsGuard(new Reflector());
    const ctx = (role: string) =>
      ({
        getHandler: () => AdmissionReportsController.prototype.lifecycle,
        getClass: () => AdmissionReportsController,
        switchToHttp: () => ({ getRequest: () => ({ currentTenant: { role } }) }),
      }) as unknown as ExecutionContext;
    expect(() => guard.canActivate(ctx(UserRole.TEACHER))).toThrow(ForbiddenException);
    expect(guard.canActivate(ctx(UserRole.ADMIN))).toBe(true);
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { ForbiddenException, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { AdmissionReportsService } from './admission-reports.service';
import { AdmissionReportsController } from './admission-reports.controller';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { ModuleStateReader } from '../../modules/auth/guards/module-state.reader';
import { UserRole } from '@biddaloy/shared';
import ExcelJS from 'exceljs';

/** [39.5.1] Lifecycle report: counts/rows, class + year filters, tenant isolation, permission. */
describe('AdmissionReportsService (integration)', () => {
  let ds: DataSource;
  let svc: AdmissionReportsService;

  const T1 = '39500000-0000-4000-8000-000000000001';
  const T2 = '39500000-0000-4000-8000-000000000002';
  const T3 = '39500000-0000-4000-8000-000000000003';
  const T4 = '39500000-0000-4000-8000-000000000004';
  const T5 = '39500000-0000-4000-8000-000000000005';
  const T6 = '39500000-0000-4000-8000-000000000006';
  const ALL = [T1, T2, T3, T4, T5, T6];

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

  async function seedAdmitted(
    tenant: string,
    ctx: Awaited<ReturnType<typeof seedTenant>>,
    cls: number,
  ) {
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
    for (const t of [
      'admission_list_members',
      'admission_lists',
      'admission_stage_results',
      'admission_stages',
      'admission_applicants',
      'admission_intakes',
      'student_lifecycle_events',
      'enrollments',
      'students',
      'class_sections',
      'classes',
      'academic_years',
    ]) {
      await ds.query(`DELETE FROM ${t} WHERE tenant_id = ANY($1)`, [ALL]);
    }
    await ds.query(`DELETE FROM schools WHERE id = ANY($1)`, [ALL]);
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

  it('TEACHER gets 403, ADMIN passes', async () => {
    const guard = new PermissionsGuard(new Reflector(), {
      forTenant: async () => ({ platform: {}, school: {} }),
    } as unknown as ModuleStateReader);
    const ctx = (role: string) =>
      ({
        getHandler: () => AdmissionReportsController.prototype.lifecycle,
        getClass: () => AdmissionReportsController,
        switchToHttp: () => ({ getRequest: () => ({ currentTenant: { role } }) }),
      }) as unknown as ExecutionContext;
    expect(() => guard.canActivate(ctx(UserRole.TEACHER))).toThrow(ForbiddenException);
    expect(await guard.canActivate(ctx(UserRole.ADMIN))).toBe(true);
  });

  /** One intake with two stages (WRITTEN, VIVA) and six applicants across the funnel. */
  async function seedFunnel(tenant: string, ctx: Awaited<ReturnType<typeof seedTenant>>) {
    const [intake] = await ds.query(
      `INSERT INTO admission_intakes (tenant_id, class_section_id, title, seat_count, open_date, close_date)
       VALUES ($1, $2, 'f', 5, '2026-01-01', '2026-02-01') RETURNING id`,
      [tenant, ctx.classes[0].sectionId],
    );
    const stageIds: string[] = [];
    for (const [pos, kind] of [
      [1, 'WRITTEN'],
      [2, 'VIVA'],
    ] as const) {
      const [st] = await ds.query(
        `INSERT INTO admission_stages (tenant_id, intake_id, position, kind) VALUES ($1, $2, $3, $4) RETURNING id`,
        [tenant, intake.id, pos, kind],
      );
      stageIds.push(st.id);
    }
    const mk = async (
      name: string,
      status: string,
      source: string,
      quotas: string[],
      passedStages: number,
      score: number | null = null,
    ) => {
      n += 1;
      const [a] = await ds.query(
        `INSERT INTO admission_applicants
           (tenant_id, intake_id, reference_number, applicant_name, date_of_birth, gender, guardian_name, guardian_phone, status, source, quota_tags)
         VALUES ($1, $2, $3, $4, '2015-01-01', 'M', 'G', $5, $6, $7, $8::jsonb) RETURNING id`,
        [tenant, intake.id, `FN-${n}`, name, `0180000${n}`, status, source, JSON.stringify(quotas)],
      );
      for (let k = 0; k < passedStages; k++) {
        await ds.query(
          `INSERT INTO admission_stage_results (tenant_id, stage_id, applicant_id, score, passed) VALUES ($1, $2, $3, $4, true)`,
          [tenant, stageIds[k], a.id, score],
        );
      }
      return a.id as string;
    };
    await mk('Online rejected at written', 'REJECTED', 'ONLINE', [], 0);
    await mk('Online passed written only', 'SHORTLISTED', 'ONLINE', ['FF'], 1);
    await mk('=HYPERLINK("x")', 'OFFERED', 'ONLINE', ['FF'], 2, 88.5);
    await mk('Online admitted', 'ADMITTED', 'ONLINE', ['SIBLING'], 2);
    await mk('Clerk admitted no stages', 'ADMITTED', 'CLERK', ['FF', 'SIBLING'], 0);
    await mk('Clerk pending', 'PENDING', 'CLERK', [], 0);
    return intake.id as string;
  }

  it('funnel counts by status (CLERK admitted counted), steps never grow, tenant isolation', async () => {
    const c3 = await seedTenant(T3, 'ar-3');
    const c4 = await seedTenant(T4, 'ar-4');
    await seedFunnel(T3, c3);
    await seedFunnel(T4, c4);

    const r = await svc.funnel(T3, { academic_year_id: c3.years[0] });
    expect(r.funnel.map((s) => [s.step, s.position, s.kind, s.count])).toEqual([
      ['APPLIED', null, null, 6],
      ['STAGE', 1, 'WRITTEN', 4], // passed written (2) + offered + both admitted
      ['STAGE', 2, 'VIVA', 3], // offered + both admitted
      ['OFFERED', null, null, 3],
      ['ADMITTED', null, null, 2],
    ]);
    const counts = r.funnel.map((s) => s.count);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
    // Admitted is by status: the CLERK one counts too.
    expect(r.sources).toEqual([
      { source: 'ONLINE', applied: 4, admitted: 1 },
      { source: 'CLERK', applied: 2, admitted: 1 },
    ]);
    expect(r.quotas).toEqual([
      { quota: 'FF', applied: 3, admitted: 1 },
      { quota: 'SIBLING', applied: 2, admitted: 2 },
    ]);

    // Another tenant's year under T3 returns an empty funnel; class filter narrows.
    const leak = await svc.funnel(T3, { academic_year_id: c4.years[0] });
    expect(leak.funnel).toEqual([
      { step: 'APPLIED', position: null, kind: null, count: 0 },
      { step: 'OFFERED', position: null, kind: null, count: 0 },
      { step: 'ADMITTED', position: null, kind: null, count: 0 },
    ]);
    const other = await svc.funnel(T3, {
      academic_year_id: c3.years[0],
      class_id: c3.classes[1].classId,
    });
    expect(other.funnel[0].count).toBe(0);
  });

  it('exports: numeric cells, formula text escaped, tenant isolated', async () => {
    const c5 = await seedTenant(T5, 'ar-5');
    const c6 = await seedTenant(T6, 'ar-6');
    await seedFunnel(T5, c5);
    await seedFunnel(T6, c6);
    const load = async (kind: 'applicants' | 'scores' | 'lists', tenant: string, year: string) => {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load((await svc.exportKind(tenant, kind, { academic_year_id: year })) as never);
      return wb.worksheets[0];
    };
    const apps = await load('applicants', T5, c5.years[0]);
    expect(apps.rowCount).toBe(7); // header + 6, none from T6
    const names = apps.getColumn(2).values.slice(2);
    expect(names).toContain('\'=HYPERLINK("x")');

    const scores = await load('scores', T5, c5.years[0]);
    expect(scores.rowCount).toBe(1 + 1 + 2 + 2 + 0); // stage rows: 1 + 2 + 2
    const scored = scores.getColumn(6).values.filter((v) => v === 88.5);
    expect(scored).toHaveLength(2); // numeric, not "88.5"

    const lists = await load('lists', T5, c5.years[0]);
    expect(lists.rowCount).toBe(1); // header only

    const empty = await load('applicants', T5, c6.years[0]);
    expect(empty.rowCount).toBe(1);
  });

  it('new routes need ADMISSION_REVIEW: TEACHER 403, ADMIN passes', async () => {
    const guard = new PermissionsGuard(new Reflector(), {
      forTenant: async () => ({ platform: {}, school: {} }),
    } as unknown as ModuleStateReader);
    for (const handler of [
      AdmissionReportsController.prototype.funnel,
      AdmissionReportsController.prototype.exportKind,
    ]) {
      const ctx = (role: string) =>
        ({
          getHandler: () => handler,
          getClass: () => AdmissionReportsController,
          switchToHttp: () => ({ getRequest: () => ({ currentTenant: { role } }) }),
        }) as unknown as ExecutionContext;
      expect(() => guard.canActivate(ctx(UserRole.TEACHER))).toThrow(ForbiddenException);
      expect(await guard.canActivate(ctx(UserRole.ADMIN))).toBe(true);
    }
  });
});

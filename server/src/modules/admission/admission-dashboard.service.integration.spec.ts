import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { localToday, startOfLocalDay, endOfLocalDay } from '../../common/time';
import { AdmissionApplicant } from './entities/admission-applicant.entity';
import { AdmissionDashboardService } from './admission-dashboard.service';
import { ApplicantReviewService } from './applicant-review.service';

/**
 * [8.10.7.4.12] `admissions-today` widget against the real schema. The cache is a
 * pass-through stub (caching is covered by `dashboard-cache.service.integration.spec.ts`).
 * "Today" is the Dhaka day; only `Date` is faked.
 */
describe('AdmissionDashboardService (integration)', () => {
  let ds: DataSource;
  let service: AdmissionDashboardService;
  let review: ApplicantReviewService;
  let tenantA: string;
  let tenantB: string;
  let intakeA: string;
  let intakeB: string;
  let n = 0;

  const passThroughCache = { getOrLoad: (_t: string, _k: string, _s: string, load: any) => load() };
  const schools = { todayFor: async () => localToday() };

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get(getDataSourceToken());
    const repo = module.get(getRepositoryToken(AdmissionApplicant));
    service = new AdmissionDashboardService(repo, schools as any, passThroughCache as any);
    review = new ApplicantReviewService(
      repo,
      null as any,
      null as any,
      null as any,
      null as any,
      null as any,
      null as any,
    );
  }, 60000);

  afterAll(async () => {
    await ds.destroy();
  });

  async function makeTenant(name: string): Promise<{ id: string; intake: string }> {
    const [{ id }] = await ds.query(
      `INSERT INTO schools (id, name, slug) VALUES (gen_random_uuid(), $1, 'adm-dash-' || substr(gen_random_uuid()::text, 1, 8)) RETURNING id`,
      [name],
    );
    const [yr] = await ds.query(
      `INSERT INTO academic_years (name, start_date, end_date, is_current, tenant_id)
       VALUES ('y', '2026-01-01', '2026-12-31', false, $1) RETURNING id`,
      [id],
    );
    const [c] = await ds.query(
      `INSERT INTO classes (name, numeric_grade, academic_year_id, tenant_id) VALUES ('Six', 6, $1, $2) RETURNING id`,
      [yr.id, id],
    );
    const [s] = await ds.query(
      `INSERT INTO class_sections (class_id, section_name, tenant_id) VALUES ($1, 'A', $2) RETURNING id`,
      [c.id, id],
    );
    const [i] = await ds.query(
      `INSERT INTO admission_intakes (tenant_id, class_section_id, title, seat_count, open_date, close_date)
       VALUES ($1, $2, 'i', 50, '2026-01-01', '2026-12-31') RETURNING id`,
      [id, s.id],
    );
    return { id, intake: i.id };
  }

  async function addApplicant(
    tenant: string,
    intake: string,
    createdAt: string,
    status = 'PENDING',
    deleted = false,
  ): Promise<string> {
    n += 1;
    const [{ id }] = await ds.query(
      `INSERT INTO admission_applicants
         (tenant_id, intake_id, reference_number, applicant_name, date_of_birth, gender,
          guardian_name, guardian_phone, status, created_at, updated_at, deleted_at)
       VALUES ($1, $2, $3, $4, '2015-01-01', 'M', 'G', '01700000000', $5, $6, $6, $7) RETURNING id`,
      [
        tenant,
        intake,
        `ADM-T-${n}`,
        `Applicant ${n}`,
        status,
        createdAt,
        deleted ? createdAt : null,
      ],
    );
    return id;
  }

  beforeEach(async () => {
    // Wed 2026-10-07 16:00 Dhaka.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-07T10:00:00Z'));
    const a = await makeTenant('Adm Dash A');
    const b = await makeTenant('Adm Dash B');
    tenantA = a.id;
    intakeA = a.intake;
    tenantB = b.id;
    intakeB = b.intake;
  });

  afterEach(async () => {
    vi.useRealTimers();
    for (const t of [
      'admission_applicants',
      'admission_intakes',
      'class_sections',
      'classes',
      'academic_years',
    ]) {
      await ds.query(`DELETE FROM ${t} WHERE tenant_id IN ($1, $2)`, [tenantA, tenantB]);
    }
    await ds.query(`DELETE FROM schools WHERE id IN ($1, $2)`, [tenantA, tenantB]);
  });

  it('counts 00:10 and noon today, not 23:50 yesterday (Dhaka)', async () => {
    await addApplicant(tenantA, intakeA, '2026-10-06T17:50:00Z'); // 23:50 on 6 Oct Dhaka
    await addApplicant(tenantA, intakeA, '2026-10-06T18:10:00Z'); // 00:10 on 7 Oct
    await addApplicant(tenantA, intakeA, '2026-10-07T06:00:00Z'); // noon
    expect((await service.getAdmissionsToday(tenantA)).new_today).toBe(2);
  });

  it('Dhaka midnight boundary: clock at 00:30 Dhaka', async () => {
    vi.setSystemTime(new Date('2026-10-06T18:30:00Z'));
    await addApplicant(tenantA, intakeA, '2026-10-06T18:10:00Z');
    await addApplicant(tenantA, intakeA, '2026-10-06T17:50:00Z');
    expect((await service.getAdmissionsToday(tenantA)).new_today).toBe(1);
  });

  it('pending_total counts PENDING only, any day; soft-deleted ignored', async () => {
    await addApplicant(tenantA, intakeA, '2026-09-01T05:00:00Z', 'PENDING');
    await addApplicant(tenantA, intakeA, '2026-10-07T05:00:00Z', 'PENDING');
    await addApplicant(tenantA, intakeA, '2026-10-07T05:00:00Z', 'SHORTLISTED');
    await addApplicant(tenantA, intakeA, '2026-10-07T05:00:00Z', 'PENDING', true);
    const r = await service.getAdmissionsToday(tenantA);
    expect(r.pending_total).toBe(2);
    expect(r.new_today).toBe(2);
  });

  it('latest is at most 5, newest first, any status, ISO created_at', async () => {
    for (let i = 0; i < 7; i++) {
      await addApplicant(
        tenantA,
        intakeA,
        `2026-10-0${i + 1}T05:00:00Z`,
        i % 2 ? 'REJECTED' : 'PENDING',
      );
    }
    const { latest } = await service.getAdmissionsToday(tenantA);
    expect(latest).toHaveLength(5);
    expect(latest.map((l) => l.created_at)).toEqual([
      '2026-10-07T05:00:00.000Z',
      '2026-10-06T05:00:00.000Z',
      '2026-10-05T05:00:00.000Z',
      '2026-10-04T05:00:00.000Z',
      '2026-10-03T05:00:00.000Z',
    ]);
    expect(Object.keys(latest[0]).sort()).toEqual([
      'applicant_name',
      'created_at',
      'id',
      'reference_number',
      'status',
    ]);
  });

  it('reconciles with ApplicantReviewService.list', async () => {
    await addApplicant(tenantA, intakeA, '2026-10-06T17:59:59Z');
    await addApplicant(tenantA, intakeA, '2026-10-06T18:00:00Z');
    await addApplicant(tenantA, intakeA, '2026-10-07T05:00:00Z', 'ADMITTED');
    await addApplicant(tenantA, intakeA, '2026-10-01T05:00:00Z');
    const r = await service.getAdmissionsToday(tenantA);
    const pending = await review.list(tenantA, { status: 'PENDING' } as any);
    const all = await review.list(tenantA, {} as any);
    const from = startOfLocalDay('2026-10-07');
    const to = endOfLocalDay('2026-10-07');
    expect(r.pending_total).toBe(pending.total);
    expect(r.new_today).toBe(
      all.data.filter((a) => a.created_at >= from && a.created_at <= to).length,
    );
  });

  it('tenant isolation', async () => {
    await addApplicant(tenantB, intakeB, '2026-10-07T05:00:00Z');
    await addApplicant(tenantA, intakeA, '2026-10-07T05:00:00Z');
    const r = await service.getAdmissionsToday(tenantA);
    expect(r.new_today).toBe(1);
    expect(r.pending_total).toBe(1);
    expect(r.latest).toHaveLength(1);
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { EnrollmentsDashboardService } from './enrollments-dashboard.service';
import { AcademicYearService } from '../academics/academic-year.service';
import { AuditService } from '../audit/audit.service';

/** #1888: committee-enrollment trend: window, status rule, reconciliation, isolation. */
describe('EnrollmentsDashboardService (integration)', () => {
  let ds: DataSource;
  let svc: EnrollmentsDashboardService;
  let years: AcademicYearService;

  const T1 = '18880000-0000-4000-8000-000000000001';
  const T2 = '18880000-0000-4000-8000-000000000002';
  const T3 = '18880000-0000-4000-8000-000000000003';
  let n = 0;

  async function tenant(id: string) {
    await ds.query(`INSERT INTO schools (id, name, slug) VALUES ($1, $2, $2)`, [id, `ed-${id.slice(-1)}`]);
  }
  async function year(t: string, name: string, y: number, current = false) {
    const [r] = await ds.query(
      `INSERT INTO academic_years (name, start_date, end_date, is_current, tenant_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [name, `${y}-01-01`, `${y}-12-31`, current, t],
    );
    return r.id as string;
  }
  async function classOf(t: string, yearId: string) {
    const [c] = await ds.query(
      `INSERT INTO classes (name, numeric_grade, academic_year_id, tenant_id) VALUES ('C', 6, $1, $2) RETURNING id`,
      [yearId, t],
    );
    const [s] = await ds.query(
      `INSERT INTO class_sections (class_id, section_name, tenant_id) VALUES ($1, 'A', $2) RETURNING id`,
      [c.id, t],
    );
    return { classId: c.id as string, sectionId: s.id as string };
  }
  async function enrol(t: string, yearId: string, status: string, k: { classId: string; sectionId: string }) {
    n += 1;
    const [st] = await ds.query(
      `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [`S ${n}`, `ED-${n}`, n, k.sectionId, t],
    );
    await ds.query(
      `INSERT INTO enrollments (student_id, class_id, section_id, academic_year_id, enrollment_status, tenant_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [st.id, k.classId, k.sectionId, yearId, status, t],
    );
  }

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [EnrollmentsDashboardService, AcademicYearService, AuditService]);
    ds = module.get(DataSource);
    svc = module.get(EnrollmentsDashboardService);
    years = module.get(AcademicYearService);
  }, 60000);

  afterAll(async () => {
    if (!ds) return;
    for (const t of ['enrollments', 'students', 'class_sections', 'classes', 'academic_years']) {
      await ds.query(`DELETE FROM ${t} WHERE tenant_id IN ($1, $2, $3)`, [T1, T2, T3]);
    }
    await ds.query(`DELETE FROM schools WHERE id IN ($1, $2, $3)`, [T1, T2, T3]);
    await ds.destroy();
  });

  it('5 newest years up to current, oldest first; future year excluded; statuses; reconciliation; isolation', async () => {
    await tenant(T1);
    await tenant(T2);
    const ids: string[] = [];
    for (let y = 2020; y <= 2026; y++) ids.push(await year(T1, String(y), y, y === 2026));
    const future = await year(T1, '2027', 2027);
    const k26 = await classOf(T1, ids[6]);
    await enrol(T1, ids[6], 'ACTIVE', k26);
    await enrol(T1, ids[6], 'ACTIVE', k26);
    await enrol(T1, ids[6], 'INACTIVE', k26);
    await enrol(T1, ids[6], 'TRANSFERRED', k26);
    const k25 = await classOf(T1, ids[5]);
    await enrol(T1, ids[5], 'GRADUATED', k25);
    await enrol(T1, ids[5], 'ACTIVE', k25);
    await enrol(T1, future, 'ACTIVE', await classOf(T1, future));
    // tenant B noise in tenant-A-shaped years
    const b = await year(T2, '2026', 2026, true);
    const kb = await classOf(T2, b);
    for (let i = 0; i < 4; i++) await enrol(T2, b, 'ACTIVE', kb);

    const r = await svc.getEnrollmentTrend(T1);
    expect(r.years.map((y) => y.year_label)).toEqual(['2022', '2023', '2024', '2025', '2026']);
    expect(r.years.map((y) => y.student_count)).toEqual([0, 0, 0, 2, 2]);
    expect(r.current_count).toBe(2);
    expect(r.previous_count).toBe(2);
    expect(r.current_count).toBe((await years.getStats(ids[6], T1)).students_count);
    expect((await svc.getEnrollmentTrend(T2)).current_count).toBe(4);
  });

  it('only one year: previous_count null', async () => {
    await tenant(T3);
    const y = await year(T3, '2026', 2026, true);
    await enrol(T3, y, 'ACTIVE', await classOf(T3, y));
    const r = await svc.getEnrollmentTrend(T3);
    expect(r).toEqual({ years: [{ year_label: '2026', student_count: 1 }], current_count: 1, previous_count: null });
  });

  it('no current year: empty', async () => {
    expect(await svc.getEnrollmentTrend('18880000-0000-4000-8000-0000000000ff')).toEqual({
      years: [],
      current_count: 0,
      previous_count: null,
    });
  });
});

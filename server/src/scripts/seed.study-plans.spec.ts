import { describe, expect, it } from 'vitest';
import type { Repository } from 'typeorm';
import { ensureStudyPlansSeed, type StudyPlansSeedRepositories } from './seed.study-plans';

/** Minimal in-memory repo: findOne by equality, create, save. */
class FakeRepo {
  readonly rows: Record<string, unknown>[] = [];
  private n = 0;
  constructor(private readonly prefix: string) {}
  findOne({ where }: { where: Record<string, unknown> }) {
    const hit = this.rows.find((r) => Object.entries(where).every(([k, v]) => r[k] === v));
    return Promise.resolve(hit ?? null);
  }
  create(data: Record<string, unknown>) {
    return { ...data };
  }
  save(e: Record<string, unknown>) {
    if (e.id === undefined) e.id = `${this.prefix}-${(this.n += 1)}`;
    if (!this.rows.includes(e)) this.rows.push(e);
    return Promise.resolve(e);
  }
}

const TENANT = 'school-1';
const TODAY = '2026-10-09'; // a Friday

function setup() {
  const r = Object.fromEntries(
    [
      'user',
      'academicYear',
      'academicTerm',
      'class',
      'classSection',
      'subject',
      'periodSlot',
      'routineSlot',
      'exam',
      'template',
      'plan',
      'delivery',
    ].map((k) => [k, new FakeRepo(k)]),
  ) as Record<string, FakeRepo>;
  void r.academicYear.save({ tenant_id: TENANT, name: '2026-2027' });
  void r.academicTerm.save({ tenant_id: TENANT, academic_year_id: 'academicYear-1', seq: 1 });
  void r.class.save({
    tenant_id: TENANT,
    academic_year_id: 'academicYear-1',
    name: 'Class 6',
    numeric_grade: 6,
  });
  void r.classSection.save({ tenant_id: TENANT, class_id: 'class-1', section_name: 'A' });
  void r.subject.save({ tenant_id: TENANT, code: 'MATH' });
  void r.subject.save({ tenant_id: TENANT, code: 'SCI' });
  void r.user.save({ email: 'teacher@biddaloy.test' });
  void r.periodSlot.save({ tenant_id: TENANT, shift_id: 'shift-1', sequence: 1 });
  void r.periodSlot.save({ tenant_id: TENANT, shift_id: 'shift-2', sequence: 3 });
  void r.periodSlot.save({ tenant_id: TENANT, shift_id: 'shift-1', sequence: 3 });
  void r.routineSlot.save({
    tenant_id: TENANT,
    section_id: 'classSection-1',
    weekday: 1,
    period_slot_id: 'periodSlot-1',
  });
  const repos = Object.fromEntries(
    Object.entries(r).map(([k, v]) => [`${k}Repository`, v as unknown as Repository<never>]),
  ) as unknown as StudyPlansSeedRepositories;
  return { r, repos };
}

const counts = (r: Record<string, FakeRepo>) =>
  Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.rows.length]));

describe('ensureStudyPlansSeed [66.1.07]', () => {
  it('seeds 1 template, 2 plans and 4 deliveries, all on the given tenant', async () => {
    const { r, repos } = setup();
    await ensureStudyPlansSeed(repos, TENANT, TODAY);

    expect(r.template.rows).toHaveLength(1);
    expect(r.plan.rows).toHaveLength(2);
    expect(r.delivery.rows).toHaveLength(4);
    for (const row of [...r.template.rows, ...r.plan.rows, ...r.delivery.rows]) {
      expect(row.tenant_id).toBe(TENANT);
    }
  });

  it('NOT_TAUGHT carries a reason, the others do not (DB CHECK from 66.1.02)', async () => {
    const { r, repos } = setup();
    await ensureStudyPlansSeed(repos, TENANT, TODAY);

    for (const d of r.delivery.rows) {
      expect(d.reason !== null).toBe(d.status === 'NOT_TAUGHT');
    }
    // The CHECK also forbids an extra NOT_TAUGHT row.
    expect(r.delivery.rows.filter((d) => d.is_extra)).toEqual([
      expect.objectContaining({ status: 'TAUGHT' }),
    ]);
  });

  it("puts the extra class on period 3 of section A's own shift", async () => {
    const { r, repos } = setup();
    await ensureStudyPlansSeed(repos, TENANT, TODAY);
    expect(r.delivery.rows.find((d) => d.is_extra)?.period_slot_id).toBe('periodSlot-3');
  });

  it('is idempotent across days: a run a week later adds no deliveries', async () => {
    const { r, repos } = setup();
    await ensureStudyPlansSeed(repos, TENANT, TODAY);
    const first = counts(r);
    await ensureStudyPlansSeed(repos, TENANT, '2026-10-16');
    expect(counts(r)).toEqual(first);
  });

  it('is idempotent: a second run adds no rows', async () => {
    const { r, repos } = setup();
    await ensureStudyPlansSeed(repos, TENANT, TODAY);
    const first = counts(r);
    await ensureStudyPlansSeed(repos, TENANT, TODAY);
    expect(counts(r)).toEqual(first);
  });
});

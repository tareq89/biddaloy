import { describe, expect, it } from 'vitest';
import { DEMO_ACADEMIC_YEAR } from './seed.util';
import { ensureApplicationsSeed, type ApplicationsSeedRepositories } from './seed.applications';

/** Minimal in-memory repo: findOne by equality on scalar keys, find, create, save. */
class FakeRepo {
  readonly rows: Record<string, unknown>[] = [];
  private n = 0;
  constructor(
    private readonly prefix: string,
    seed: Record<string, unknown>[] = [],
  ) {
    for (const r of seed) this.rows.push(r);
  }
  findOne({ where }: { where: Record<string, unknown> }) {
    // Nested filters (e.g. the parent's `user.email`) are not modelled; the seed rows already match.
    const hit = this.rows.find((r) =>
      Object.entries(where).every(([k, v]) => typeof v === 'object' || r[k] === v),
    );
    return Promise.resolve(hit ?? null);
  }
  find() {
    return Promise.resolve(this.rows.slice(0, 1));
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
const ADMIN = 'admin-1';

function setup() {
  const app = new FakeRepo('app');
  const event = new FakeRepo('ev');
  const repos = {
    applicationRepository: app,
    eventRepository: event,
    staffProfileRepository: new FakeRepo('staff', [
      { id: 'staff-1', tenant_id: TENANT, user_id: 'staff-user', employee_id: 'E-1' },
    ]),
    guardianRepository: new FakeRepo('g', [
      { id: 'g-1', tenant_id: TENANT, user_id: 'parent-user', students: [{ id: 'stu-1' }] },
    ]),
    academicYearRepository: new FakeRepo('year', [
      { id: 'year-1', tenant_id: TENANT, name: DEMO_ACADEMIC_YEAR.name },
    ]),
  };
  return { app, event, repos: repos as unknown as ApplicationsSeedRepositories };
}

describe('ensureApplicationsSeed', () => {
  it('creates 3 PENDING applications with serials 1..3, each with one SUBMITTED event', async () => {
    const { app, event, repos } = setup();
    await ensureApplicationsSeed(repos, TENANT, ADMIN);
    expect(app.rows.map((r) => r.serial_no)).toEqual([1, 2, 3]);
    expect(app.rows.every((r) => r.status === 'PENDING' && r.tenant_id === TENANT)).toBe(true);
    expect(event.rows).toHaveLength(3);
    expect(event.rows.every((r) => r.kind === 'SUBMITTED')).toBe(true);
  });

  it('creates nothing on a second run', async () => {
    const { app, event, repos } = setup();
    await ensureApplicationsSeed(repos, TENANT, ADMIN);
    await ensureApplicationsSeed(repos, TENANT, ADMIN);
    expect(app.rows).toHaveLength(3);
    expect(event.rows).toHaveLength(3);
  });

  it('GENERAL row is a PAPER application entered by the admin for an applicant with no login', async () => {
    const { app, repos } = setup();
    await ensureApplicationsSeed(repos, TENANT, ADMIN);
    const general = app.rows.find((r) => r.type === 'GENERAL')!;
    expect(general.source).toBe('PAPER');
    expect(general.entered_by_user_id).toBe(ADMIN);
    expect(general.applicant_user_id).toBeNull();
    expect(general.applicant_name).toBe('আব্দুল করিম');
  });
});

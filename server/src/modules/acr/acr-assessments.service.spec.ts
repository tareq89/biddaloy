import { describe, it, expect, vi } from 'vitest';
import { FindOperator } from 'typeorm';
import { AcrAssessmentsService } from './acr-assessments.service';

const T = 't1';
const ADMIN = 'admin';
const SUBJECT = 'staff';
const YEAR = 'y1';

const match = (row: any, where: any) =>
  Object.entries(where).every(([k, v]: [string, any]) => {
    if (v instanceof FindOperator) {
      const op = v as any;
      if (op.type === 'not') return row[k] !== op.value;
      if (op.type === 'in') return op.value.includes(row[k]);
    }
    return row[k] === v;
  });

function fakeRepo(rows: any[], prefix: string) {
  let n = 0;
  const repo: any = {
    create: (v: any) => ({ ...v }),
    save: async (v: any) => {
      const existing = v.id ? rows.find((r) => r.id === v.id) : null;
      if (existing) return Object.assign(existing, v);
      const row = { id: `${prefix}${++n}`, created_at: new Date(), ...v };
      rows.push(row);
      return row;
    },
    findOne: async ({ where, order }: any) => {
      const hits = rows.filter((r) => match(r, where));
      if (order?.version) hits.sort((a, b) => b.version - a.version);
      return hits[0] ?? null;
    },
    find: async ({ where }: any) => rows.filter((r) => match(r, where)),
    upsert: async (vals: any[], keys: string[]) => {
      for (const v of vals) {
        const hit = rows.find((r) => keys.every((k) => r[k] === v[k]));
        if (hit) hit.score = v.score;
        else rows.push({ id: `${prefix}${++n}`, ...v });
      }
    },
    count: async ({ where }: any) => rows.filter((r) => match(r, where)).length,
  };
  return repo;
}

function setup() {
  const db = {
    assessments: [] as any[],
    scores: [] as any[],
    criteria: [
      { id: 'c1', tenant_id: T, form_version_id: 'v1' },
      { id: 'c2', tenant_id: T, form_version_id: 'v1' },
    ],
    versions: [{ id: 'v1', tenant_id: T, version: 1 }],
    userTenants: [
      { user_id: SUBJECT, tenant_id: T, role: 'TEACHER' },
      { user_id: 'other', tenant_id: T, role: 'TEACHER' },
      { user_id: 'guardian', tenant_id: T, role: 'PARENT' },
    ],
    years: [{ id: YEAR, tenant_id: T }],
  };
  const aRepo = fakeRepo(db.assessments, 'a');
  const sRepo = fakeRepo(db.scores, 's');
  const cRepo = fakeRepo(db.criteria, 'cc');
  aRepo.manager = {
    transaction: async (cb: any) =>
      cb({
        getRepository: (e: any) =>
          e.name === 'AcrAssessment' ? aRepo : e.name === 'AcrScore' ? sRepo : cRepo,
      }),
  };
  const audit = { record: vi.fn() };
  const svc = new AcrAssessmentsService(
    aRepo,
    sRepo,
    cRepo,
    fakeRepo(db.versions, 'v'),
    fakeRepo(db.userTenants, 'u'),
    fakeRepo(db.years, 'y'),
    audit as any,
  );
  const start = (user = SUBJECT) => svc.start({ user_id: user, academic_year_id: YEAR }, T, ADMIN);
  return { svc, db, audit, start };
}

describe('AcrAssessmentsService', () => {
  it('total = sum of scores, server-computed', async () => {
    const { svc, start } = setup();
    const a = await start();
    const r = await svc.update(
      a.id,
      {
        scores: [
          { criterion_id: 'c1', score: 4 },
          { criterion_id: 'c2', score: 2 },
        ],
      },
      T,
      ADMIN,
    );
    expect(r.total).toBe(6);
    // rescoring one criterion recomputes, does not double count
    const r2 = await svc.update(a.id, { scores: [{ criterion_id: 'c2', score: 1 }] }, T, ADMIN);
    expect(r2.total).toBe(5);
  });

  it('rejects score 5 and unknown criterion', async () => {
    const { svc, start } = setup();
    const a = await start();
    await expect(
      svc.update(a.id, { scores: [{ criterion_id: 'c1', score: 5 }] }, T, ADMIN),
    ).rejects.toThrow(/1-4/);
    await expect(
      svc.update(a.id, { scores: [{ criterion_id: 'nope', score: 3 }] }, T, ADMIN),
    ).rejects.toThrow(/criterion/);
  });

  it('incomplete cannot complete; complete locks edits; reopen allows edits; audits both', async () => {
    const { svc, start, audit } = setup();
    const a = await start();
    await svc.update(a.id, { scores: [{ criterion_id: 'c1', score: 3 }] }, T, ADMIN);
    await expect(svc.complete(a.id, T, ADMIN)).rejects.toThrow(/scored/);
    await svc.update(a.id, { scores: [{ criterion_id: 'c2', score: 3 }] }, T, ADMIN);
    const done = await svc.complete(a.id, T, ADMIN);
    expect(done.status).toBe('COMPLETED');
    expect(done.total).toBe(6);
    await expect(svc.update(a.id, { step1_data: { x: 1 } }, T, ADMIN)).rejects.toThrow(/read-only/);
    const re = await svc.reopen(a.id, T, ADMIN);
    expect(re.status).toBe('INCOMPLETE');
    await expect(svc.update(a.id, { step1_data: { x: 1 } }, T, ADMIN)).resolves.toBeTruthy();
    expect(audit.record).toHaveBeenCalledTimes(2);
    expect(audit.record.mock.calls[0][0].old_values).toEqual({ status: 'INCOMPLETE' });
    expect(audit.record.mock.calls[1][0].old_values).toEqual({ status: 'COMPLETED' });
    expect(audit.record.mock.calls[1][0].new_values.status).toBe('INCOMPLETE');
    // privacy: no total in the audit payload; written inside the transaction
    for (const [entry, manager] of audit.record.mock.calls) {
      expect(entry.new_values).not.toHaveProperty('total');
      expect(entry.old_values).not.toHaveProperty('total');
      expect(manager).toBeDefined();
    }
  });

  it('reopen only from COMPLETED', async () => {
    const { svc, start } = setup();
    const a = await start();
    await expect(svc.reopen(a.id, T, ADMIN)).rejects.toThrow(/completed/);
  });

  it('one per user per year (409); bad user/year 400; no form version 409', async () => {
    const { svc, start, db } = setup();
    await start();
    await expect(start()).rejects.toThrow(/already exists/);
    await expect(start('stranger')).rejects.toThrow(/staff/);
    await expect(start('guardian')).rejects.toThrow(/staff/);
    await expect(
      svc.start({ user_id: 'other', academic_year_id: 'bad' }, T, ADMIN),
    ).rejects.toThrow(/year/);
    db.versions.length = 0;
    await expect(start('other')).rejects.toThrow(/form version/);
  });

  it('subject gets 404 on get/update/complete/reopen/history and is absent from the register', async () => {
    const { svc, start } = setup();
    const a = await start(SUBJECT);
    await start('other');
    await expect(svc.get(a.id, T, SUBJECT)).rejects.toThrow(/not found/);
    await expect(svc.update(a.id, {}, T, SUBJECT)).rejects.toThrow(/not found/);
    await expect(svc.complete(a.id, T, SUBJECT)).rejects.toThrow(/not found/);
    await expect(svc.reopen(a.id, T, SUBJECT)).rejects.toThrow(/not found/);
    await expect(svc.history(SUBJECT, T, SUBJECT)).rejects.toThrow(/not found/);
    await expect(
      svc.start({ user_id: SUBJECT, academic_year_id: YEAR }, T, SUBJECT),
    ).rejects.toThrow(/not found/);
    const reg = await svc.list(T, SUBJECT, {});
    expect(reg.map((r) => r.user_id)).toEqual(['other']);
  });

  it('cross-tenant id is 404', async () => {
    const { svc, start } = setup();
    const a = await start();
    await expect(svc.get(a.id, 'tenant-b', ADMIN)).rejects.toThrow(/not found/);
  });
});

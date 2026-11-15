import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { AdmissionStageResultService } from './admission-stage-result.service';

const TENANT = 't1';
const actor = { userId: 'u1' };
const stage = {
  id: 's1',
  intake_id: 'i1',
  position: 1,
  tenant_id: TENANT,
  config: { total_marks: 100 },
};

type Row = {
  applicant_id: string;
  score: string | null;
  recorded: boolean;
  dob?: string;
  at?: string;
};

function build(rows: Row[], config: Record<string, unknown> = stage.config) {
  const saved: Record<string, unknown>[] = [];
  const stageSaves: { config: Record<string, unknown> }[] = [];
  const updates: unknown[][] = [];
  const audits: unknown[] = [];
  const manager = {
    query: vi.fn(async (sql: string, params: unknown[]) => {
      if (sql.includes('FROM admission_stages')) return [];
      if (sql.startsWith('UPDATE')) {
        updates.push(params);
        return [];
      }
      return rows.map((r) => ({
        applicant_id: r.applicant_id,
        date_of_birth: r.dob ?? '2015-01-01',
        created_at: r.at ?? '2026-01-01T00:00:00.000000',
        name: `Name ${r.applicant_id}`,
        roll: null,
        recorded: r.recorded,
        score: r.score,
      }));
    }),
    getRepository: () => ({
      findOne: async () => ({ ...stage, config }),
      create: (v: object) => ({ ...v }),
      save: async (v: Record<string, unknown>[] | Record<string, unknown>) =>
        Array.isArray(v) ? saved.push(...v) : (stageSaves.push(v as never), v),
      createQueryBuilder: () => {
        const qb = { where: () => qb, getMany: async () => [] };
        return qb;
      },
    }),
  };
  const ds = { transaction: async (cb: (m: unknown) => unknown) => cb(manager) };
  const lockIntake = vi.fn();
  const auditRecord = vi.fn(async (e: unknown) => audits.push(e));
  const service = new AdmissionStageResultService(
    ds as never,
    { lockIntake } as never,
    { record: auditRecord } as never,
  );
  return { service, saved, stageSaves, updates, audits, lockIntake };
}

const row = (id: string, score: string | null, recorded = true): Row => ({
  applicant_id: id,
  score,
  recorded,
});
const body = (results: object[]) => ({ results }) as never;

describe('AdmissionStageResultService.putResults', () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => {
    ctx = build([row('a1', null, false), row('a2', null, false)]);
  });

  it('saves rows under the intake lock and audits once', async () => {
    const res = await ctx.service.putResults(
      's1',
      body([
        { applicant_id: 'a1', attended: true, score: 72.5 },
        { applicant_id: 'a2', attended: false },
      ]),
      TENANT,
      actor,
    );
    expect(res).toEqual({ saved: 2 });
    expect(ctx.lockIntake).toHaveBeenCalled();
    expect(ctx.saved).toMatchObject([
      { applicant_id: 'a1', score: '72.50', passed: null, remarks: null },
      { applicant_id: 'a2', score: null, passed: null, remarks: 'ABSENT' },
    ]);
    expect(ctx.audits).toHaveLength(1);
  });

  it.each([
    ['score above total marks', { applicant_id: 'a1', attended: true, score: 100.01 }],
    ['attended with no score', { applicant_id: 'a1', attended: true }],
    ['passed on a score stage', { applicant_id: 'a1', attended: true, score: 5, passed: true }],
    ['absent with a score', { applicant_id: 'a1', attended: false, score: 5 }],
    ['applicant not in the stage', { applicant_id: 'zzz', attended: true, score: 5 }],
  ])('refuses %s', async (_n, r) => {
    await expect(ctx.service.putResults('s1', body([r]), TENANT, actor)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(ctx.saved).toHaveLength(0);
  });

  it('refuses the same applicant twice', async () => {
    const r = { applicant_id: 'a1', attended: true, score: 5 };
    await expect(ctx.service.putResults('s1', body([r, r]), TENANT, actor)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('a score change clears the stale cut-off commit marker; pass/fail stages keep it', async () => {
    const sc = build([row('a1', null, false)], { total_marks: 100, cutoff_committed_at: 'X' });
    await sc.service.putResults(
      's1',
      body([{ applicant_id: 'a1', attended: true, score: 50 }]),
      TENANT,
      actor,
    );
    expect(sc.stageSaves[0].config).toEqual({ total_marks: 100 });
    const pf = build([row('a1', null, false)], { cutoff_committed_at: 'X' });
    await pf.service.putResults(
      's1',
      body([{ applicant_id: 'a1', attended: true, passed: true }]),
      TENANT,
      actor,
    );
    expect(pf.stageSaves).toHaveLength(0);
  });

  it('a pass/fail stage takes passed, not a score', async () => {
    const pf = build([row('a1', null, false)], {});
    await pf.service.putResults(
      's1',
      body([{ applicant_id: 'a1', attended: true, passed: true }]),
      TENANT,
      actor,
    );
    expect(pf.saved[0]).toMatchObject({ score: null, passed: true });
    await expect(
      pf.service.putResults(
        's1',
        body([{ applicant_id: 'a1', attended: true, score: 3 }]),
        TENANT,
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('cut-off preview and commit', () => {
  const rows = [
    row('a', '90.00'),
    row('b', '80.00'),
    row('c', '80.00'),
    row('d', '10.00'),
    row('e', null),
  ];
  const passed = (updates: unknown[][]) => new Set(updates[0][2] as string[]);

  it('TOP_N: best first, boundary tie split by tie-break, absent fails', async () => {
    const { service } = build(rows);
    const p = await service.preview('s1', 'TOP_N', 2, TENANT);
    expect(p.passing).toEqual(['a', 'b']);
    expect(p.failing).toEqual(['c', 'd', 'e']);
    expect(p).toMatchObject({
      passing_count: 2,
      failing_count: 3,
      boundary_score: 80,
      tied_at_boundary: 2,
    });
  });

  it('MIN_SCORE keeps every applicant at or above the score', async () => {
    const { service } = build(rows);
    const p = await service.preview('s1', 'MIN_SCORE', 80, TENANT);
    expect(p.passing).toEqual(['a', 'b', 'c']);
    expect(p.tied_at_boundary).toBe(0);
  });

  it('preview equals commit', async () => {
    const { service, updates } = build(rows);
    const p = await service.preview('s1', 'TOP_N', 3, TENANT);
    const c = await service.commit('s1', { mode: 'TOP_N', value: 3 } as never, TENANT, actor);
    expect(c).toMatchObject({ passed: p.passing_count, failed: p.failing_count });
    expect(c.passing_rows).toEqual(p.passing_rows);
    expect(c.failing_rows).toEqual(p.failing_rows);
    expect(c.cutoff_committed_at).toEqual(expect.any(String));
    expect(passed(updates)).toEqual(new Set(p.passing));
  });

  it('manual add and remove adjust the passers', async () => {
    const { service, updates } = build(rows);
    await service.commit(
      's1',
      { mode: 'TOP_N', value: 2, add: ['d'], remove: ['a'] } as never,
      TENANT,
      actor,
    );
    expect(passed(updates)).toEqual(new Set(['b', 'd']));
  });

  it('refuses add or remove of an applicant outside the stage, or in both', async () => {
    const { service } = build(rows);
    for (const extra of [{ add: ['zzz'] }, { remove: ['zzz'] }, { add: ['a'], remove: ['a'] }])
      await expect(
        service.commit('s1', { mode: 'TOP_N', value: 2, ...extra } as never, TENANT, actor),
      ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('commit refuses incomplete results; preview does not', async () => {
    const { service } = build([row('a', '5.00'), row('b', null, false)]);
    await expect(
      service.commit('s1', { mode: 'TOP_N', value: 1 } as never, TENANT, actor),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(service.preview('s1', 'TOP_N', 1, TENANT)).resolves.toBeDefined();
  });

  it('a stage without total marks has no cut-off', async () => {
    const { service } = build(rows, {});
    await expect(service.preview('s1', 'TOP_N', 1, TENANT)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('a non-whole TOP_N value is refused', async () => {
    const { service } = build(rows);
    await expect(service.preview('s1', 'TOP_N', 1.5, TENANT)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

import { describe, it, expect, vi } from 'vitest';
import { AdmissionListService } from './admission-list.service';

const actor = { userId: 'u1' };
const T = 't1';
const I = 'i1';

const cand = (id: string, score: string, extra: Record<string, unknown> = {}) => ({
  applicant_id: id,
  date_of_birth: '2015-01-01',
  created_at: '2026-01-01T00:00:00.000000',
  quota_tags: [],
  gender: 'MALE',
  score,
  ...extra,
});

interface Opts {
  intake?: { seat_count: number };
  admitted?: number;
  offered?: number;
  stageConfig?: Record<string, unknown>;
  rows?: ReturnType<typeof cand>[];
  merit?: number;
  lists?: Record<string, unknown>[];
  list?: Record<string, unknown> | null;
  today?: string;
  waitingIds?: string[];
}

function build(o: Opts = {}) {
  const saved: Record<string, unknown>[] = [];
  const statusWrites: { ids: string[]; status: string }[] = [];
  const audits: Record<string, unknown>[] = [];
  const query = vi.fn(async (sql: string, params: unknown[]) => {
    if (sql.includes('FROM admission_stages'))
      return [{ id: 's1', kind: 'WRITTEN', config: o.stageConfig ?? {} }];
    if (sql.includes('FROM admission_applicants a') && sql.includes('quota_tags'))
      return o.rows ?? [];
    if (sql.includes('SELECT status, count(*)'))
      return [
        { status: 'ADMITTED', n: o.admitted ?? 0 },
        { status: 'OFFERED', n: o.offered ?? 0 },
      ];
    if (sql.includes('UPDATE admission_applicants SET status')) {
      statusWrites.push({ ids: params[1] as string[], status: params[2] as string });
      return [];
    }
    if (sql.includes('RETURNING a.id')) return [[], 0];
    if (sql.includes('FROM admission_list_members m'))
      return (o.waitingIds ?? []).slice(0, params[3] as number).map((id) => ({ id }));
    return [];
  });
  const repoFor = () => ({
    count: async () => o.merit ?? 0,
    create: (v: object) => ({ id: 'L1', ...v }),
    save: async (v: Record<string, unknown> | Record<string, unknown>[]) => {
      saved.push(...(Array.isArray(v) ? v : [v]));
      return Array.isArray(v) ? v : { id: 'L1', sequence: 1, ...v };
    },
    findOne: async () => (o.list === undefined ? null : o.list),
    find: async () => o.lists ?? [],
    update: vi.fn(async () => undefined),
    createQueryBuilder: () => {
      const qb: Record<string, unknown> = {};
      for (const m of ['select', 'where', 'andWhere']) qb[m] = () => qb;
      qb.getRawOne = async () => ({ max: 0 });
      return qb;
    },
  });
  const manager = { query, getRepository: repoFor };
  const ds = { transaction: async (cb: (m: unknown) => unknown) => cb(manager), manager };
  const stages = {
    lockIntake: async () => ({
      id: I,
      tenant_id: T,
      seat_count: o.intake?.seat_count ?? 5,
    }),
  };
  const schools = { todayFor: async () => o.today ?? '2026-02-01' };
  const audit = {
    record: vi.fn(async (e: { new_values: Record<string, unknown> }) => audits.push(e.new_values)),
  };
  const service = new AdmissionListService(
    ds as never,
    stages as never,
    schools as never,
    audit as never,
  );
  return { service, saved, statusWrites, audits, query };
}

const dto = { capacity: 2, act_by_date: '2026-02-10' };

describe('AdmissionListService.createMerit', () => {
  it('offers the top capacity by score, then date of birth (default tie-break)', async () => {
    const { service, statusWrites, audits } = build({
      rows: [
        cand('c', '70.00'),
        cand('b', '80.00', { date_of_birth: '2016-01-01' }),
        cand('a', '80.00'),
      ],
    });
    const res = await service.createMerit(I, dto, T, actor);
    expect(res.affected).toBe(2);
    expect(statusWrites).toEqual([{ ids: ['a', 'b'], status: 'OFFERED' }]);
    expect(audits[0]).toMatchObject({ op: 'ADMISSION_LIST_CREATED', ranked: 3, offered: 2 });
  });

  it('honours the stage tie-break order', async () => {
    const { service, statusWrites } = build({
      stageConfig: { tie_break: ['APPLIED_AT'] },
      rows: [
        cand('a', '80.00', { created_at: '2026-01-03T00:00:00.000000' }),
        cand('b', '80.00', {
          created_at: '2026-01-02T00:00:00.000000',
          date_of_birth: '2017-01-01',
        }),
      ],
    });
    await service.createMerit(I, { ...dto, capacity: 1 }, T, actor);
    expect(statusWrites[0].ids).toEqual(['b']);
  });

  it('refuses a capacity above the seats left (400) and a second merit list (409)', async () => {
    await expect(
      build({ admitted: 2 }).service.createMerit(I, { ...dto, capacity: 4 }, T, actor),
    ).rejects.toMatchObject({ status: 400 });
    await expect(build({ merit: 1 }).service.createMerit(I, dto, T, actor)).rejects.toMatchObject({
      status: 409,
    });
  });
});

describe('AdmissionListService.createWaiting', () => {
  const rows = [
    cand('a', '90.00', {
      created_at: '2026-01-05T00:00:00.000000',
      quota_tags: ['FF'],
      gender: 'FEMALE',
    }),
    cand('b', '70.00', { created_at: '2026-01-01T00:00:00.000000', gender: 'FEMALE' }),
    cand('c', '80.00', { created_at: '2026-01-03T00:00:00.000000', quota_tags: ['FF'] }),
  ];
  const ids = (s: ReturnType<typeof build>) => s.statusWrites[0].ids;

  it('needs a merit list first (409)', async () => {
    await expect(
      build({ rows }).service.createWaiting(I, { ...dto, order: 'MERIT' }, T, actor),
    ).rejects.toMatchObject({ status: 409 });
  });

  it.each([
    ['MERIT', {}, ['a', 'c', 'b']],
    ['FIRST_COME', {}, ['b', 'c', 'a']],
    ['FILTER', { filter: { quota_tags: ['FF'] } }, ['a', 'c']],
    ['FILTER', { filter: { gender: 'female', min_score: 75 } }, ['a']],
    ['MANUAL', { applicant_ids: ['b', 'a'] }, ['b', 'a']],
  ] as const)('%s order %j', async (order, extra, expected) => {
    const s = build({ rows, merit: 1 });
    await s.service.createWaiting(I, { ...dto, capacity: 10, order, ...extra } as never, T, actor);
    expect(ids(s)).toEqual(expected);
    expect(s.statusWrites[0].status).toBe('WAITING');
  });

  it('MANUAL with an applicant who is not a candidate is 400', async () => {
    await expect(
      build({ rows, merit: 1 }).service.createWaiting(
        I,
        { ...dto, order: 'MANUAL', applicant_ids: ['zzz'] },
        T,
        actor,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('AdmissionListService.activate / expirePending / patchMembers', () => {
  const list = (over: Record<string, unknown>) => ({
    id: 'L2',
    intake_id: I,
    tenant_id: T,
    kind: 'WAITING',
    sequence: 1,
    capacity: 3,
    activated_at: null,
    act_by_date: '2026-02-20',
    ...over,
  });
  const merit = (over: Record<string, unknown> = {}) => ({
    id: 'L1',
    kind: 'MERIT',
    sequence: 1,
    activated_at: new Date(),
    act_by_date: '2026-01-31',
    ...over,
  });
  const codeOf = async (p: Promise<unknown>) =>
    p.then(
      () => null,
      (e) => e.getResponse?.().details?.code ?? e.status,
    );

  it('refuses a list that is already active, with the previous deadline not passed, or with no seats', async () => {
    const wl = list({});
    expect(
      await codeOf(
        build({ list: list({ activated_at: new Date() }) }).service.activate('L2', T, actor),
      ),
    ).toBe('LIST_ALREADY_ACTIVATED');
    expect(
      await codeOf(
        build({ list: wl, lists: [merit({ act_by_date: '2026-02-01' }), wl] }).service.activate(
          'L2',
          T,
          actor,
        ),
      ),
    ).toBe('PREVIOUS_DEADLINE_NOT_PASSED');
    expect(
      await codeOf(
        build({ list: wl, lists: [merit({ activated_at: null }), wl] }).service.activate(
          'L2',
          T,
          actor,
        ),
      ),
    ).toBe('PREVIOUS_LIST_NOT_ACTIVATED');
    expect(
      await codeOf(
        build({ list: wl, lists: [merit(), wl], admitted: 5 }).service.activate('L2', T, actor),
      ),
    ).toBe('NO_SEATS_LEFT');
  });

  it('offers min(capacity, vacant) still-waiting members and audits', async () => {
    const wl = list({});
    const s = build({
      list: wl,
      lists: [merit(), wl],
      admitted: 2,
      waitingIds: ['a', 'b', 'c'],
    });
    const res = await s.service.activate('L2', T, actor);
    expect(res.affected).toBe(3);
    const s2 = build({ list: wl, lists: [merit(), wl], admitted: 4, waitingIds: ['a', 'b', 'c'] });
    expect((await s2.service.activate('L2', T, actor)).affected).toBe(1);
    expect(s2.audits.at(-1)).toMatchObject({
      op: 'ADMISSION_LIST_ACTIVATED',
      offered: 1,
      vacant: 1,
    });
  });

  it('expire-pending needs an activated list past its date', async () => {
    expect(await codeOf(build({ list: list({}) }).service.expirePending('L2', T, actor))).toBe(
      'LIST_NOT_ACTIVATED',
    );
    expect(
      await codeOf(
        build({ list: merit({ act_by_date: '2026-02-01' }) }).service.expirePending('L1', T, actor),
      ),
    ).toBe('DEADLINE_NOT_PASSED');
    const s = build({ list: merit() });
    expect(await s.service.expirePending('L1', T, actor)).toEqual({ id: 'L1', affected: 0 });
    expect(s.audits).toHaveLength(1);
  });

  it('an unknown list is 404 and an activated list cannot be edited', async () => {
    expect(await codeOf(build({ list: null }).service.activate('L2', T, actor))).toBe(404);
    expect(
      await codeOf(build({ list: merit() }).service.patchMembers('L1', { remove: [] }, T, actor)),
    ).toBe('LIST_LOCKED');
  });
});

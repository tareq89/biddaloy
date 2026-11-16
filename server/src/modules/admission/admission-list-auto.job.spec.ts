import { ConflictException } from '@nestjs/common';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdmissionListAutoJob } from './admission-list-auto.job';

vi.mock('../schools/settings/school-modules.util', () => ({
  isModuleOnForSchool: vi.fn().mockResolvedValue(true),
}));

describe('AdmissionListAutoJob', () => {
  const manager = {};
  let activations: string[];
  let nextListIds: ({ id: string } | undefined)[];
  let job: AdmissionListAutoJob;
  let lists: {
    expireLapsedForIntake: ReturnType<typeof vi.fn>;
    activate: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    activations = [];
    // First run: list L1 is next. Second run: it is open, so L2 is next but its predecessor is not due.
    nextListIds = [{ id: 'L1' }, { id: 'L2' }];
    lists = {
      expireLapsedForIntake: vi.fn().mockResolvedValue(0),
      activate: vi.fn(async (id: string) => {
        if (id === 'L2') throw new ConflictException('PREVIOUS_DEADLINE_NOT_PASSED');
        activations.push(id);
        return { id, affected: 1 };
      }),
    };
    const dataSource = {
      transaction: vi.fn((fn: (m: unknown) => Promise<unknown>) => fn(manager)),
      query: vi.fn(async (sql: string) =>
        sql.includes('auto_activate_lists')
          ? [{ id: 'I1', tenant_id: 'T1' }]
          : [nextListIds.shift()].filter(Boolean),
      ),
    };
    job = new AdmissionListAutoJob(
      {} as never,
      dataSource as never,
      { todayFor: vi.fn().mockResolvedValue('2043-03-02') } as never,
      lists as never,
      { lockIntake: vi.fn().mockResolvedValue({ auto_activate_lists: true }) } as never,
      {} as never,
    );
  });

  it('does nothing when staff turned auto-activation off after the round was selected', async () => {
    const off = new AdmissionListAutoJob(
      {} as never,
      { transaction: (fn: (m: unknown) => unknown) => fn({}), query: vi.fn() } as never,
      { todayFor: vi.fn().mockResolvedValue('2043-03-02') } as never,
      lists as never,
      { lockIntake: vi.fn().mockResolvedValue({ auto_activate_lists: false }) } as never,
      {} as never,
    );
    await off.runRound('I1', 'T1');
    expect(lists.expireLapsedForIntake).not.toHaveBeenCalled();
    expect(lists.activate).not.toHaveBeenCalled();
  });

  it('only selects rounds with auto_activate_lists on (auto off does nothing)', async () => {
    const dataSource = { query: vi.fn().mockResolvedValue([]) };
    const off = new AdmissionListAutoJob(
      {} as never,
      dataSource as never,
      {} as never,
      lists as never,
      {} as never,
      {} as never,
    );
    await off.process();
    expect(dataSource.query.mock.calls[0][0]).toContain('auto_activate_lists = true');
    expect(lists.activate).not.toHaveBeenCalled();
  });

  it('auto on: expires lapsed offers then activates the next list with a system actor', async () => {
    await job.process();
    expect(lists.expireLapsedForIntake).toHaveBeenCalledWith(
      manager,
      'I1',
      'T1',
      expect.objectContaining({ userId: null }),
      '2043-03-02',
    );
    expect(activations).toEqual(['L1']);
  });

  it('running twice activates once (the 409 of the second run is swallowed)', async () => {
    await job.process();
    await job.process();
    expect(activations).toEqual(['L1']);
    expect(lists.activate).toHaveBeenCalledTimes(2);
  });

  it('a failing round does not block the next one', async () => {
    const calls: string[] = [];
    const runRound = vi.fn(async (id: string) => {
      calls.push(id);
      if (id === 'I1') throw new Error('boom');
    });
    const j = new AdmissionListAutoJob(
      {} as never,
      {
        query: vi.fn().mockResolvedValue([
          { id: 'I1', tenant_id: 'T1' },
          { id: 'I2', tenant_id: 'T2' },
        ]),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    j.runRound = runRound;
    await j.process();
    expect(calls).toEqual(['I1', 'I2']);
  });
});

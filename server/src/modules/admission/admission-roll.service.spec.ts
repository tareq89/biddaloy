import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { AdmissionRollService } from './admission-roll.service';

type Row = { id: string; applicant_name: string; roll_number: string | null };

/** Fake manager: the intake query builder returns `intake`, the applicant one records order and returns `rows`. */
function build(intake: Record<string, unknown>, rows: Row[], stage?: Record<string, unknown>) {
  const orderBy = vi.fn();
  const where: string[] = [];
  const applicantQb: Record<string, unknown> = {};
  for (const m of ['where', 'andWhere']) {
    applicantQb[m] = vi.fn((sql: string) => {
      where.push(sql);
      return applicantQb;
    });
  }
  applicantQb.orderBy = vi.fn((...a: unknown[]) => (orderBy(...a), applicantQb));
  applicantQb.addOrderBy = vi.fn(() => applicantQb);
  applicantQb.getMany = vi.fn(async () => rows);
  const intakeQb = { setLock: () => intakeQb, where: () => intakeQb, getOne: async () => intake };
  const intakeUpdate = vi.fn();
  const applicantSave = vi.fn();
  const manager = {
    getRepository: (entity: { name: string }) =>
      entity.name === 'AdmissionIntake'
        ? { createQueryBuilder: () => intakeQb, update: intakeUpdate }
        : entity.name === 'AdmissionStage'
          ? { findOne: async () => stage, save: async (s: unknown) => s }
          : { createQueryBuilder: () => applicantQb, save: applicantSave, find: async () => rows },
  };
  const dataSource = {
    transaction: (fn: (m: unknown) => unknown) => fn(manager),
    getRepository: manager.getRepository,
  };
  const notify = vi.fn();
  const service = new AdmissionRollService(
    dataSource as never,
    {
      notifyStageSchedule: notify,
    } as never,
  );
  return { service, orderBy, where, intakeUpdate, applicantSave, notify };
}

const rows = (): Row[] => [
  { id: 'a', applicant_name: 'Zed', roll_number: null },
  { id: 'b', applicant_name: 'Amy', roll_number: null },
];

describe('AdmissionRollService.assign', () => {
  it('numbers in query order with prefix, 4-digit padding, continuing the counter', async () => {
    const t = build({ id: 'i', roll_prefix: 'C6-', roll_counter: 9 }, rows());
    const res = await t.service.assign('i', 'APPLIED_AT', 't');
    expect(res).toEqual({ assigned: 2, first_roll: 'C6-0010', last_roll: 'C6-0011' });
    expect(t.intakeUpdate).toHaveBeenCalledWith({ id: 'i', tenant_id: 't' }, { roll_counter: 11 });
    expect(t.orderBy).toHaveBeenCalledWith('a.created_at', 'ASC');
  });

  it('orders by name when asked; no prefix means bare padded number', async () => {
    const t = build({ id: 'i', roll_prefix: null, roll_counter: 0 }, rows());
    const res = await t.service.assign('i', 'NAME', 't');
    expect(t.orderBy).toHaveBeenCalledWith('a.applicant_name', 'ASC');
    expect(res.first_roll).toBe('0001');
  });

  it('only eligible applicants are asked for: no existing roll, never FEE_PENDING', async () => {
    const t = build({ id: 'i', roll_prefix: null, roll_counter: 0 }, rows());
    await t.service.assign('i', 'NAME', 't');
    expect(t.where.join(' ')).toContain('roll_number IS NULL');
    expect(t.where.join(' ')).toContain('a.status IN');
  });

  it('a repeat with nobody new assigns nothing and leaves the counter', async () => {
    const t = build({ id: 'i', roll_prefix: null, roll_counter: 5 }, []);
    expect(await t.service.assign('i', 'NAME', 't')).toEqual({
      assigned: 0,
      first_roll: null,
      last_roll: null,
    });
    expect(t.intakeUpdate).not.toHaveBeenCalled();
  });
});

describe('AdmissionRollService.setSchedule', () => {
  const dto = { date: '2099-01-02', start_time: '10:30', venue: 'Hall' };

  it('keeps other config keys and texts only when the round publishes by SMS', async () => {
    const stage = { id: 's', intake_id: 'i', kind: 'WRITTEN', title: null, config: { pass: 40 } };
    const on = build(
      { id: 'i', tenant_id: 't', title: 'T', publish_channels: ['SMS'] },
      rows(),
      stage,
    );
    await on.service.setSchedule('s', dto, 't');
    expect(stage.config).toEqual({ pass: 40, ...dto });
    expect(on.notify).toHaveBeenCalledTimes(2);

    const off = build({ id: 'i', tenant_id: 't', title: 'T', publish_channels: [] }, rows(), stage);
    await off.service.setSchedule('s', dto, 't');
    expect(off.notify).not.toHaveBeenCalled();
  });

  it('keeps cutoff_committed_at', async () => {
    const stage = { id: 's', intake_id: 'i', config: { cutoff_committed_at: 'X' } };
    const t = build({ id: 'i', publish_channels: [] }, [], stage);
    await t.service.setSchedule('s', dto, 't');
    expect(stage.config).toMatchObject({ cutoff_committed_at: 'X', ...dto });
  });

  it('refuses a past date', async () => {
    const t = build({ id: 'i' }, [], {});
    await expect(
      t.service.setSchedule('s', { ...dto, date: '2000-01-01' }, 't'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

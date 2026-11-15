import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { AdmissionLotteryService, lotteryOrder } from './admission-lottery.service';

const actor = { userId: 'u1' };
const IDS = ['a', 'b', 'c', 'd', 'e'];

function build(opts: { kind?: string; existing?: number } = {}) {
  const saved: Record<string, unknown>[] = [];
  const updates: unknown[] = [];
  const audits: { new_values: Record<string, unknown> }[] = [];
  const manager = {
    query: vi.fn(async () => [{ n: opts.existing ?? 0 }]),
    getRepository: () => ({
      create: (v: object) => ({ ...v }),
      save: async (v: Record<string, unknown>[]) => saved.push(...v),
      update: async (...a: unknown[]) => updates.push(a),
    }),
  };
  const ds = { transaction: async (cb: (m: unknown) => unknown) => cb(manager) };
  const results = {
    lockStage: async () => ({ id: 's1', kind: opts.kind ?? 'LOTTERY', config: {} }),
    eligible: async () => IDS.map((applicant_id) => ({ applicant_id })),
  };
  const audit = { record: vi.fn(async (e) => audits.push(e)) };
  const service = new AdmissionLotteryService(
    ds as never,
    results as never,
    {} as never,
    audit as never,
  );
  return { service, saved, updates, audits };
}

describe('lotteryOrder', () => {
  it('is a permutation fixed by the seed', () => {
    const a = lotteryOrder(IDS, 'seed-1');
    expect([...a].sort()).toEqual(IDS);
    expect(lotteryOrder([...IDS].reverse(), 'seed-1')).toEqual(a);
    expect(lotteryOrder(IDS, 'seed-2')).not.toEqual(a);
  });
});

describe('AdmissionLotteryService.draw', () => {
  it('gives every applicant a unique rank (points N..1) and audits seed and count', async () => {
    const { service, saved, updates, audits } = build();
    expect(await service.draw('s1', 't1', actor)).toEqual({ drawn: 5 });
    expect(saved.map((r) => r.score).sort()).toEqual(['1.00', '2.00', '3.00', '4.00', '5.00']);
    expect(new Set(saved.map((r) => r.applicant_id)).size).toBe(5);
    expect(updates).toHaveLength(1);
    expect(audits[0].new_values).toMatchObject({ op: 'LOTTERY_DRAW', count: 5, stage_id: 's1' });
    const seed = audits[0].new_values.seed as string;
    const order = lotteryOrder(IDS, seed);
    // rank 1 holds the highest points
    expect(saved.find((r) => r.applicant_id === order[0])!.score).toBe('5.00');
  });

  it('second draw is 409', async () => {
    const { service, saved } = build({ existing: 5 });
    await expect(service.draw('s1', 't1', actor)).rejects.toBeInstanceOf(ConflictException);
    expect(saved).toHaveLength(0);
  });

  it('refuses a stage that is not a lottery', async () => {
    const { service } = build({ kind: 'WRITTEN' });
    await expect(service.draw('s1', 't1', actor)).rejects.toBeInstanceOf(BadRequestException);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ModuleStateReader, sanitizePlatformModules } from './module-state.reader';

function make(findOne: ReturnType<typeof vi.fn>) {
  const dataSource = { getRepository: () => ({ findOne }) };
  const schools = { getSchoolModules: vi.fn().mockResolvedValue({ fees: { on: false } }) };
  return new ModuleStateReader(schools as never, dataSource as never);
}

describe('ModuleStateReader platform map (77.6.01)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reads the row once and serves the cache for 30 s', async () => {
    const findOne = vi.fn().mockResolvedValue({ value: { fees: false } });
    const reader = make(findOne);
    expect(await reader.platformModules()).toEqual({ fees: false });
    await reader.platformModules();
    expect(findOne).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_001);
    await reader.platformModules();
    expect(findOne).toHaveBeenCalledTimes(2);
  });

  it('invalidate forces a fresh read', async () => {
    const findOne = vi
      .fn()
      .mockResolvedValueOnce({ value: { fees: false } })
      .mockResolvedValueOnce({ value: {} });
    const reader = make(findOne);
    await reader.platformModules();
    reader.invalidatePlatformModules();
    expect(await reader.platformModules()).toEqual({});
  });

  it('a read in flight during an invalidation is not cached', async () => {
    let release!: (v: unknown) => void;
    const findOne = vi
      .fn()
      .mockReturnValueOnce(new Promise((r) => (release = r)))
      .mockResolvedValueOnce({ value: { exams: false } });
    const reader = make(findOne);
    const slow = reader.platformModules();
    reader.invalidatePlatformModules();
    release({ value: { fees: false } });
    await slow;
    expect(await reader.platformModules()).toEqual({ exams: false });
  });

  it('a failed read throws (fails closed) and is not cached', async () => {
    const findOne = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce(null);
    const reader = make(findOne);
    await expect(reader.platformModules()).rejects.toThrow('down');
    expect(await reader.platformModules()).toEqual({});
  });

  it('forTenant returns the platform map beside the school block', async () => {
    const reader = make(vi.fn().mockResolvedValue({ value: { exams: false } }));
    expect(await reader.forTenant('t1')).toEqual({
      platform: { exams: false },
      school: { fees: { on: false } },
    });
  });

  it('sanitize keeps only known keys with boolean values', () => {
    expect(sanitizePlatformModules({ fees: false, nope: false, exams: 'x' })).toEqual({
      fees: false,
    });
    expect(sanitizePlatformModules(null)).toEqual({});
    expect(sanitizePlatformModules([true])).toEqual({});
  });
});

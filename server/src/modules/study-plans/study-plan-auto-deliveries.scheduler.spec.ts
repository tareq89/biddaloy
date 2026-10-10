import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StudyPlanAutoDeliveriesScheduler } from './study-plan-auto-deliveries.scheduler';

/**
 * Gate logic only (deadline, local day, school day, once-a-day marker, tenant
 * isolation of failures). All collaborators are mocked; `writeAutoRows` is
 * spied so no DB is touched. Time is frozen with only `Date` faked.
 */
describe('StudyPlanAutoDeliveriesScheduler (unit)', () => {
  const settings = { region: { timezone: 'Asia/Dhaka' } };
  let redis: { set: ReturnType<typeof vi.fn>; del: ReturnType<typeof vi.fn> };
  let calendar: { isNonWorkingDay: ReturnType<typeof vi.fn> };
  let schools: { findAll: ReturnType<typeof vi.fn>; getResolvedSettings: ReturnType<typeof vi.fn> };
  let scheduler: StudyPlanAutoDeliveriesScheduler;
  let write: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    redis = { set: vi.fn().mockResolvedValue('OK'), del: vi.fn().mockResolvedValue(1) };
    calendar = { isNonWorkingDay: vi.fn().mockResolvedValue(false) };
    schools = {
      findAll: vi.fn().mockResolvedValue([{ id: 'ta' }]),
      getResolvedSettings: vi.fn().mockResolvedValue(settings),
    };
    scheduler = new StudyPlanAutoDeliveriesScheduler(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      schools as never,
      { studyPlansSettings: vi.fn().mockResolvedValue({ statusDeadline: '18:00' }) } as never,
      calendar as never,
      {} as never,
      {} as never,
      redis as never,
    );
    write = vi.spyOn(scheduler, 'writeAutoRows').mockResolvedValue(0);
  });

  afterEach(() => vi.useRealTimers());

  const at = (iso: string) => vi.setSystemTime(new Date(iso));

  it('writes nothing at 17:59 Dhaka', async () => {
    at('2026-10-15T11:59:00Z');
    await scheduler.sweepTenant('ta');
    expect(write).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('writes at 18:01 Dhaka, window is today-7 .. today', async () => {
    at('2026-10-15T12:01:00Z');
    await scheduler.sweepTenant('ta');
    expect(write).toHaveBeenCalledWith('ta', '2026-10-08', '2026-10-15');
  });

  it('uses the Dhaka date after local midnight, not the UTC date', async () => {
    // 18:05Z on the 15th is 00:05 on the 16th in Dhaka: before the deadline.
    at('2026-10-15T18:05:00Z');
    await scheduler.sweepTenant('ta');
    expect(write).not.toHaveBeenCalled();
  });

  it('marker key and window follow the Dhaka date once past the deadline', async () => {
    // 12:01Z on the 16th = 18:01 on the 16th in Dhaka.
    at('2026-10-16T12:01:00Z');
    await scheduler.sweepTenant('ta');
    expect(redis.set).toHaveBeenCalledWith(
      'tenant:ta:study-plans:auto:2026-10-16',
      '1',
      'EX',
      3 * 24 * 3600,
      'NX',
    );
    expect(write).toHaveBeenCalledWith('ta', '2026-10-09', '2026-10-16');
  });

  it('skips when the marker is already set', async () => {
    at('2026-10-15T12:01:00Z');
    redis.set.mockResolvedValue(null);
    await scheduler.sweepTenant('ta');
    expect(write).not.toHaveBeenCalled();
  });

  it('skips a non-working day', async () => {
    at('2026-10-15T12:01:00Z');
    calendar.isNonWorkingDay.mockResolvedValue(true);
    await scheduler.sweepTenant('ta');
    expect(redis.set).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('Redis failure skips that tenant but the sweep continues', async () => {
    at('2026-10-15T12:01:00Z');
    schools.findAll.mockResolvedValue([{ id: 'ta' }, { id: 'tb' }]);
    redis.set.mockRejectedValueOnce(new Error('redis down')).mockResolvedValue('OK');
    await scheduler.process();
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]![0]).toBe('tb');
  });

  it('a throwing tenant does not stop the next, and its marker is released', async () => {
    at('2026-10-15T12:01:00Z');
    schools.findAll.mockResolvedValue([{ id: 'ta' }, { id: 'tb' }]);
    write.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(0);
    await scheduler.process();
    expect(write).toHaveBeenCalledTimes(2);
    expect(redis.del).toHaveBeenCalledWith('tenant:ta:study-plans:auto:2026-10-15');
  });
});

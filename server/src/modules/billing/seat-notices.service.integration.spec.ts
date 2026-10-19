import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SchoolsService } from '../schools/schools.service';
import { AdminNoticeService } from '../schools/trial/admin-notice.service';
import { SeatNoticesService, seatNoticeFor } from './seat-notices.service';

describe('seatNoticeFor', () => {
  it('maps days left to the notice due', () => {
    expect(seatNoticeFor(31)).toBeNull();
    expect(seatNoticeFor(30)).toBe('seats_d30');
    expect(seatNoticeFor(8)).toBe('seats_d30');
    expect(seatNoticeFor(7)).toBe('seats_d7');
    expect(seatNoticeFor(1)).toBe('seats_d7');
    expect(seatNoticeFor(0)).toBe('seats_expired');
    expect(seatNoticeFor(-3)).toBe('seats_expired');
  });
});

describe('SeatNoticesService (integration)', () => {
  let ds: DataSource;
  let service: SeatNoticesService;
  // School-local date for this instant is 2026-12-01.
  const now = new Date('2026-12-01T06:00:00Z');
  const findAllActive = vi.fn();
  const notifyAdmins = vi.fn();
  const schoolIds: string[] = [];

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [
      SeatNoticesService,
      { provide: SchoolsService, useValue: { findAllActive } },
      { provide: AdminNoticeService, useValue: { notifyAdmins } },
    ]);
    ds = module.get<DataSource>(getDataSourceToken());
    service = module.get(SeatNoticesService);
  }, 60000);

  beforeEach(() => {
    notifyAdmins.mockReset().mockResolvedValue(undefined);
    findAllActive.mockReset().mockImplementation(async () => schoolIds.map((id) => ({ id })));
  });

  afterEach(async () => {
    await ds.query('DELETE FROM seat_orders WHERE school_id = ANY($1)', [schoolIds]);
    // audit_logs is append-only elsewhere; these rows have none, but stay safe and deactivate.
    await ds.query(
      `UPDATE schools SET status = 'SUSPENDED', deleted_at = NOW() WHERE id = ANY($1)`,
      [schoolIds],
    );
    schoolIds.length = 0;
  });

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  /** `seatLimit` null = the free period. */
  const newSchool = async (seatLimit: number | null): Promise<string> => {
    const id = randomUUID();
    await ds.query(`INSERT INTO schools (id, name, slug, seat_limit) VALUES ($1, $2, $3, $4)`, [
      id,
      `Seats ${id.slice(0, 6)}`,
      `seats-${id.slice(0, 8)}`,
      seatLimit,
    ]);
    schoolIds.push(id);
    return id;
  };
  /** A PAID order whose first unpaid day is `daysAhead` days after 2026-12-01. */
  const paid = (schoolId: string, daysAhead: number, seats = 20) =>
    ds.query(
      `INSERT INTO seat_orders (school_id, seats, months, unit_price_paisa, amount_paisa, period_start, period_end, status, idempotency_key, paid_at)
       VALUES ($1, $2, 1, 1000, 5000, DATE '2026-12-01' - 30, DATE '2026-12-01' + $3::int, 'PAID', gen_random_uuid()::text, NOW())`,
      [schoolId, seats, daysAhead],
    );

  it('sends each key once per period: d30, then d7, then expired', async () => {
    const id = await newSchool(20);
    await paid(id, 30);
    await service.runDaily(now);
    await service.runDaily(now); // same day again: nothing new
    expect(notifyAdmins).toHaveBeenCalledTimes(1);
    expect(notifyAdmins).toHaveBeenCalledWith(id, 'seats_d30', { date: '2026-12-31', seats: 20 });

    // 7 days before the end.
    await service.runDaily(new Date('2026-12-24T06:00:00Z'));
    expect(notifyAdmins).toHaveBeenLastCalledWith(id, 'seats_d7', {
      date: '2026-12-31',
      seats: 20,
    });
    // The end date itself.
    await service.runDaily(new Date('2026-12-31T06:00:00Z'));
    expect(notifyAdmins).toHaveBeenLastCalledWith(id, 'seats_expired', {
      date: '2026-12-31',
      seats: 20,
    });
    expect(notifyAdmins).toHaveBeenCalledTimes(3);
    await service.runDaily(new Date('2027-01-02T06:00:00Z'));
    expect(notifyAdmins).toHaveBeenCalledTimes(3);
  });

  it('a renewal resets the stamps: the new period_end warns again', async () => {
    const id = await newSchool(20);
    await paid(id, 5);
    await service.runDaily(now);
    expect(notifyAdmins).toHaveBeenLastCalledWith(id, 'seats_d7', {
      date: '2026-12-06',
      seats: 20,
    });
    // Renewed for a month, then that month nears its end.
    await paid(id, 35, 25);
    await service.runDaily(new Date('2026-12-06T06:00:00Z')); // 30 days before 2027-01-05
    expect(notifyAdmins).toHaveBeenLastCalledWith(id, 'seats_d30', {
      date: '2027-01-05',
      seats: 25,
    });
    expect(notifyAdmins).toHaveBeenCalledTimes(2);
  });

  it('says nothing in the free period, with no paid order, or 31 days out', async () => {
    const free = await newSchool(null);
    await paid(free, 3);
    const none = await newSchool(0);
    const far = await newSchool(20);
    await paid(far, 31);
    await service.runDaily(now);
    expect(notifyAdmins).not.toHaveBeenCalled();
    expect(none).toBeTruthy();
  });

  it('one failing school does not stop the rest', async () => {
    const a = await newSchool(20);
    await paid(a, 3);
    const b = await newSchool(20);
    await paid(b, 3);
    notifyAdmins.mockRejectedValueOnce(new Error('boom'));
    const res = await service.runDaily(now);
    expect(res).toEqual({ sent: 1, failed: 1 });
  });
});

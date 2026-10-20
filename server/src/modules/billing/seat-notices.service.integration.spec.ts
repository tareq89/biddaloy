import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_SECTION_1_ID } from '@test/constants';
import { SchoolsService } from '../schools/schools.service';
import { AdminNoticeService } from '../schools/trial/admin-notice.service';
import { renderNotice } from '../schools/trial/admin-notice-templates';
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

  it('the expired notice says read-only only for a school over its seats', () => {
    const body = (over: boolean, free = false) =>
      renderNotice('seats_expired', 'en', { school: 'X', date: '2027-01-01', over, free }).body;
    expect(body(true)).toContain('read-only for 7 days, then paused');
    expect(body(false)).not.toContain('read-only');
    expect(body(false, true)).toContain('Free use of X ended');
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
  const originalFreeUntil = process.env.BILLING_FREE_UNTIL;

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
    // Billing started long ago unless a test says otherwise.
    process.env.BILLING_FREE_UNTIL = '2026-01-01T00:00:00+06:00';
    notifyAdmins.mockReset().mockResolvedValue(undefined);
    findAllActive.mockReset().mockImplementation(async () => schoolIds.map((id) => ({ id })));
  });

  afterEach(async () => {
    if (originalFreeUntil === undefined) delete process.env.BILLING_FREE_UNTIL;
    else process.env.BILLING_FREE_UNTIL = originalFreeUntil;
    await ds.query('DELETE FROM seat_orders WHERE school_id = ANY($1)', [schoolIds]);
    await ds.query('DELETE FROM students WHERE tenant_id = ANY($1)', [schoolIds]);
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
  /** A PAID order whose first unpaid day is `daysAhead` days after 2026-12-01, `length` days long. */
  const paid = (schoolId: string, daysAhead: number, seats = 20, length = 60) =>
    ds.query(
      `INSERT INTO seat_orders (school_id, seats, months, unit_price_paisa, amount_paisa, period_start, period_end, status, idempotency_key, paid_at)
       VALUES ($1, $2, 1, 1000, 5000, DATE '2026-12-01' + $3::int - $4::int, DATE '2026-12-01' + $3::int, 'PAID', gen_random_uuid()::text, NOW())`,
      [schoolId, seats, daysAhead, length],
    );
  const addStudent = (tenantId: string) =>
    ds.query(
      `INSERT INTO students (tenant_id, full_name, registration_number, roll_number, class_section_id)
       VALUES ($1, 'Seat Holder', $2, 1, $3)`,
      [tenantId, `R-${randomUUID().slice(0, 8)}`, SEED_SECTION_1_ID],
    );
  const vars = (date: string, seats: number, extra: { free?: boolean; over?: boolean } = {}) => ({
    date,
    seats,
    free: false,
    over: false,
    ...extra,
  });

  it('sends each key once per period: d30, then d7, then expired', async () => {
    const id = await newSchool(20);
    await paid(id, 30);
    await service.runDaily(now);
    await service.runDaily(now); // same day again: nothing new
    expect(notifyAdmins).toHaveBeenCalledTimes(1);
    expect(notifyAdmins).toHaveBeenCalledWith(id, 'seats_d30', vars('2026-12-31', 20));

    // 7 days before the end.
    await service.runDaily(new Date('2026-12-24T06:00:00Z'));
    expect(notifyAdmins).toHaveBeenLastCalledWith(id, 'seats_d7', vars('2026-12-31', 20));
    // The end date itself.
    await service.runDaily(new Date('2026-12-31T06:00:00Z'));
    expect(notifyAdmins).toHaveBeenLastCalledWith(id, 'seats_expired', vars('2026-12-31', 20));
    expect(notifyAdmins).toHaveBeenCalledTimes(3);
    await service.runDaily(new Date('2027-01-02T06:00:00Z'));
    expect(notifyAdmins).toHaveBeenCalledTimes(3);
  });

  it('a renewal resets the stamps: the new period_end warns again', async () => {
    const id = await newSchool(20);
    await paid(id, 5);
    await service.runDaily(now);
    expect(notifyAdmins).toHaveBeenLastCalledWith(id, 'seats_d7', vars('2026-12-06', 20));
    // Renewed for a month, then that month nears its end.
    await paid(id, 35, 25);
    await service.runDaily(new Date('2026-12-06T06:00:00Z')); // 30 days before 2027-01-05
    expect(notifyAdmins).toHaveBeenLastCalledWith(id, 'seats_d30', vars('2027-01-05', 25));
    expect(notifyAdmins).toHaveBeenCalledTimes(2);
  });

  it('says nothing 31 days out, or in a free period that ends later than that', async () => {
    const far = await newSchool(20);
    await paid(far, 31);
    process.env.BILLING_FREE_UNTIL = '2027-01-01T00:00:00+06:00'; // 31 days after 2026-12-01
    const free = await newSchool(null);
    await paid(free, 3); // ends inside the free period: the free period is the cover
    await service.runDaily(now);
    expect(notifyAdmins).not.toHaveBeenCalled();
  });

  it('warns a school that never paid before the free period ends', async () => {
    process.env.BILLING_FREE_UNTIL = '2026-12-31T00:00:00+06:00';
    const id = await newSchool(null);
    await addStudent(id);
    await service.runDaily(now);
    expect(notifyAdmins).toHaveBeenLastCalledWith(
      id,
      'seats_d30',
      vars('2026-12-31', 0, { free: true, over: true }),
    );
    await service.runDaily(new Date('2026-12-31T06:00:00Z'));
    expect(notifyAdmins).toHaveBeenLastCalledWith(
      id,
      'seats_expired',
      vars('2026-12-31', 0, { free: true, over: true }),
    );
  });

  it('gives an order of 31 days or less no 30-day notice, only the 7-day one', async () => {
    const id = await newSchool(20);
    await paid(id, 30, 20, 31); // paid yesterday, ends in 30 days
    await service.runDaily(now);
    expect(notifyAdmins).not.toHaveBeenCalled();
    await service.runDaily(new Date('2026-12-24T06:00:00Z'));
    expect(notifyAdmins).toHaveBeenLastCalledWith(id, 'seats_d7', vars('2026-12-31', 20));
  });

  it('says the school goes read-only only when it has students', async () => {
    const empty = await newSchool(20);
    await paid(empty, 0);
    const busy = await newSchool(20);
    await paid(busy, 0);
    await addStudent(busy);
    await service.runDaily(now);
    expect(notifyAdmins).toHaveBeenCalledWith(empty, 'seats_expired', vars('2026-12-01', 20));
    expect(notifyAdmins).toHaveBeenCalledWith(
      busy,
      'seats_expired',
      vars('2026-12-01', 20, { over: true }),
    );
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

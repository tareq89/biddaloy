import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SCHOOL_TZ, localDate } from '../../common/time';
import { SchoolsService } from '../schools/schools.service';
import { AdminNoticeService } from '../schools/trial/admin-notice.service';
import type { AdminNoticeKey } from '../schools/trial/admin-notice-templates';

const DAY_MS = 86_400_000;

type SeatNoticeKey = Extract<AdminNoticeKey, 'seats_d30' | 'seats_d7' | 'seats_expired'>;

/** The notice due `daysLeft` days before the first unpaid day (0 or less = already unpaid). */
export function seatNoticeFor(daysLeft: number): SeatNoticeKey | null {
  if (daysLeft <= 0) return 'seats_expired';
  if (daysLeft <= 7) return 'seats_d7';
  if (daysLeft <= 30) return 'seats_d30';
  return null;
}

/**
 * Daily SMS + email to a school's admins at 30 / 7 / 0 days before its paid seats end (Epic 49 D9).
 * Each key goes out once per `period_end`: the stamp lives in `schools.onboarding.seat_warnings`
 * next to the `period_end` it was sent for, so a renewal (a later `period_end`) starts afresh.
 */
@Injectable()
export class SeatNoticesService {
  private readonly logger = new Logger(SeatNoticesService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly schools: SchoolsService,
    private readonly notices: AdminNoticeService,
  ) {}

  async runDaily(now: Date = new Date()): Promise<{ sent: number; failed: number }> {
    const today = localDate(now, SCHOOL_TZ);
    let sent = 0;
    let failed = 0;
    for (const { id } of await this.schools.findAllActive()) {
      try {
        if (await this.checkSchool(id, today, now)) sent++;
      } catch (err) {
        // One school's failure must not stop the rest; tomorrow's run retries it.
        failed++;
        this.logger.error(
          `Seat notice failed for school ${id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    this.logger.log(`Seat notices done: ${sent} sent, ${failed} failed`);
    return { sent, failed };
  }

  private async checkSchool(id: string, today: string, now: Date): Promise<boolean> {
    let due: { key: SeatNoticeKey; date: string; seats: number } | null = null;

    await this.dataSource.transaction(async (m) => {
      const [school]: { seat_limit: number | null; onboarding: Record<string, any> | null }[] =
        await m.query(
          `SELECT seat_limit, onboarding FROM schools
            WHERE id = $1 AND status = 'ACTIVE' AND deleted_at IS NULL
              FOR NO KEY UPDATE`,
          [id],
        );
      // NULL limit = free period: nothing to warn about.
      if (!school || school.seat_limit === null) return;
      const [last]: { period_end: string; seats: number }[] = await m.query(
        `SELECT period_end::text AS period_end, SUM(seats)::int AS seats FROM seat_orders
          WHERE school_id = $1 AND status = 'PAID'
          GROUP BY period_end ORDER BY period_end DESC LIMIT 1`,
        [id],
      );
      if (!last) return;

      const daysLeft = Math.round((Date.parse(last.period_end) - Date.parse(today)) / DAY_MS);
      const key = seatNoticeFor(daysLeft);
      if (!key) return;

      const stamp = school.onboarding?.seat_warnings;
      const already: Record<string, string> =
        stamp?.period_end === last.period_end ? stamp.sent : {};
      if (already?.[key]) return;
      const next = { period_end: last.period_end, sent: { ...already, [key]: now.toISOString() } };
      await m.query(
        `UPDATE schools
            SET onboarding = jsonb_set(COALESCE(onboarding, '{}'::jsonb), '{seat_warnings}', $2::jsonb)
          WHERE id = $1`,
        [id, JSON.stringify(next)],
      );
      due = { key, date: last.period_end, seats: last.seats };
    });

    if (!due) return false;
    const { key, date, seats } = due as { key: SeatNoticeKey; date: string; seats: number };
    // Stamped first: a crash after commit loses one notice rather than sending it twice.
    await this.notices.notifyAdmins(id, key, { date, seats });
    return true;
  }
}

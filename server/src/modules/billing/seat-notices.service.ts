import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SCHOOL_TZ, localDate } from '../../common/time';
import { SchoolsService } from '../schools/schools.service';
import { AdminNoticeService } from '../schools/trial/admin-notice.service';
import type { AdminNoticeKey, NoticeVars } from '../schools/trial/admin-notice-templates';
import { seatCover } from './seat-grace';

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
 * Daily SMS + email to a school's admins at 30 / 7 / 0 days before its seats end (Epic 49 D9):
 * the last paid period, or the free period for a school that never paid.
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
    let due: { key: SeatNoticeKey; vars: Omit<NoticeVars, 'school'> } | null = null;

    await this.dataSource.transaction(async (m) => {
      const [school]: { used: number; onboarding: Record<string, any> | null }[] = await m.query(
        `SELECT onboarding,
                (SELECT count(*)::int FROM students st
                  WHERE st.tenant_id = s.id AND st.deleted_at IS NULL
                    AND st.enrollment_status = 'ACTIVE') AS used
           FROM schools s
          WHERE id = $1 AND status = 'ACTIVE' AND deleted_at IS NULL
            FOR NO KEY UPDATE`,
        [id],
      );
      if (!school) return;
      // A school that never paid is covered by the free period, so it is warned too.
      const cover = await seatCover(m, id);

      const daysLeft = Math.round((Date.parse(cover.periodEnd) - Date.parse(today)) / DAY_MS);
      const key = seatNoticeFor(daysLeft);
      if (!key) return;
      // A one-month order would get the 30-day warning on the day it was paid.
      if (key === 'seats_d30' && cover.short) return;

      const stamp = school.onboarding?.seat_warnings;
      const already: Record<string, string> =
        stamp?.period_end === cover.periodEnd ? stamp.sent : {};
      if (already?.[key]) return;
      const next = { period_end: cover.periodEnd, sent: { ...already, [key]: now.toISOString() } };
      await m.query(
        `UPDATE schools
            SET onboarding = jsonb_set(COALESCE(onboarding, '{}'::jsonb), '{seat_warnings}', $2::jsonb)
          WHERE id = $1`,
        [id, JSON.stringify(next)],
      );
      // No order covers the day after `periodEnd`, so any ACTIVE student puts the school over.
      due = {
        key,
        vars: {
          date: cover.periodEnd,
          seats: cover.seats,
          free: cover.free,
          over: school.used > 0,
        },
      };
    });

    if (!due) return false;
    const { key, vars } = due as { key: SeatNoticeKey; vars: Omit<NoticeVars, 'school'> };
    // Stamped first: a crash after commit loses one notice rather than sending it twice.
    await this.notices.notifyAdmins(id, key, vars);
    return true;
  }
}

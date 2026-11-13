import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SCHOOL_TZ, localDate } from '../../../common/time';
import { resolveAppBaseUrl } from '../../account-access/app-base-url.util';
import { SmsCreditService } from '../../communications/credits/sms-credit.service';
import { AdminNoticeService } from '../../schools/trial/admin-notice.service';
import type { AdminNoticeKey } from '../../schools/trial/admin-notice-templates';

const DAY_MS = 86_400_000;
/** Sent markers older than this are dropped from `schools.onboarding` (a lot expires long before). */
const MARKER_KEEP_DAYS = 30;

type ExpiryKey = Extract<AdminNoticeKey, 'sms_expiring_d7' | 'sms_expiring_d1'>;

/** The notice due when a lot ends `daysLeft` school-local days from today. */
export function smsExpiryNoticeFor(daysLeft: number): ExpiryKey | null {
  if (daysLeft === 7) return 'sms_expiring_d7';
  if (daysLeft === 1) return 'sms_expiring_d1';
  return null;
}

/** School-local date (YYYY-MM-DD) `days` after `today` (YYYY-MM-DD). */
export function addDays(today: string, days: number): string {
  return new Date(Date.parse(today) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * [100.2.gB.04] The daily SMS-package expiry job (D1, D18, D21):
 * 1. unused units of lots past expiry are written off (`SmsCreditService.expireDue`);
 * 2. each bundle order whose lot is now closed becomes EXPIRED (units were left) or USED_UP;
 * 3. admins get an email 7 and 1 day before a lot with units left ends, once per lot and key.
 */
@Injectable()
export class SmsExpiryService {
  private readonly logger = new Logger(SmsExpiryService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly credits: SmsCreditService,
    private readonly notices: AdminNoticeService,
  ) {}

  async run(now: Date = new Date()): Promise<{
    expiredLots: number;
    expiredUnits: number;
    ordersClosed: number;
    noticesSent: number;
    noticesFailed: number;
  }> {
    // ponytail: one sweep of up to 1000 lots a day; a bigger backlog drains over the next days.
    const { lots, units } = await this.credits.expireDue(now, { limit: 1000 });
    const ordersClosed = await this.closeOrders(now);
    const { sent, failed } = await this.sendNotices(now);
    this.logger.log(
      `SMS expiry done: ${lots} lots / ${units} units expired, ${ordersClosed} orders closed, ${sent} notices sent, ${failed} failed`,
    );
    return {
      expiredLots: lots,
      expiredUnits: units,
      ordersClosed,
      noticesSent: sent,
      noticesFailed: failed,
    };
  }

  /**
   * An order is closed from its lot: lot closed after expiry with `expired_units > 0` -> EXPIRED,
   * with none -> USED_UP. Only PAID/ACTIVE orders move (the local transition guard: nothing
   * else may be overwritten, and a repeat run matches no row).
   * ponytail: no `canMove` helper on this branch (#3857); swap this guard for it when it lands.
   */
  async closeOrders(now: Date): Promise<number> {
    // TypeORM returns [rows, affectedCount] for UPDATE ... RETURNING.
    const [rows]: [unknown[], number] = await this.dataSource.query(
      `UPDATE sms_bundle_orders o
          SET status = CASE WHEN l.expired_units > 0 THEN 'EXPIRED' ELSE 'USED_UP' END,
              updated_at = now()
         FROM sms_credit_lots l
        WHERE l.bundle_order_id = o.id
          AND l.source = 'BUNDLE'
          AND l.status IN ('EXPIRED', 'USED_UP')
          AND l.expires_at IS NOT NULL AND l.expires_at <= $1
          AND o.status IN ('PAID', 'ACTIVE')
      RETURNING o.id`,
      [now],
    );
    return rows.length;
  }

  async sendNotices(now: Date): Promise<{ sent: number; failed: number }> {
    const today = localDate(now, SCHOOL_TZ);
    const due: { id: string; tenant_id: string; remaining: number; day: string }[] =
      await this.dataSource.query(
        `SELECT l.id, l.tenant_id, l.remaining,
                to_char(l.expires_at AT TIME ZONE '${SCHOOL_TZ}', 'YYYY-MM-DD') AS day
           FROM sms_credit_lots l
           JOIN schools s ON s.id = l.tenant_id AND s.status = 'ACTIVE' AND s.deleted_at IS NULL
          WHERE l.remaining > 0 AND l.expires_at IS NOT NULL
            AND (l.expires_at AT TIME ZONE '${SCHOOL_TZ}')::date IN ($1::date, $2::date)
          ORDER BY l.expires_at, l.id`,
        [addDays(today, 1), addDays(today, 7)],
      );
    let sent = 0;
    let failed = 0;
    for (const lot of due) {
      try {
        const key = smsExpiryNoticeFor(
          Math.round((Date.parse(lot.day) - Date.parse(today)) / DAY_MS),
        );
        if (!key) continue;
        if (await this.stamp(lot.tenant_id, lot.id, key, now)) {
          // Stamped first: a crash after commit loses one notice rather than sending it twice.
          await this.notices.notifyAdmins(
            lot.tenant_id,
            key,
            {
              link: `${resolveAppBaseUrl(this.config)}/settings?section=communication&smsBuy=1`,
              date: lot.day,
              units: lot.remaining,
            },
            { emailOnly: true },
          );
          sent++;
        }
      } catch (err) {
        // One lot or school failing must not stop the rest; the marker is already set or the
        // stamp failed, so tomorrow's window no longer matches: at worst one notice is lost.
        failed++;
        this.logger.error(
          `SMS expiry notice failed for school ${lot.tenant_id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return { sent, failed };
  }

  /** Records `<lotId>:<key>` in `schools.onboarding.sms_expiry_notices`; false when already there. */
  private async stamp(
    schoolId: string,
    lotId: string,
    key: ExpiryKey,
    now: Date,
  ): Promise<boolean> {
    const marker = `${lotId}:${key}`;
    return this.dataSource.transaction(async (m) => {
      const [school]: { sent: Record<string, string> | null }[] = await m.query(
        `SELECT onboarding->'sms_expiry_notices' AS sent FROM schools WHERE id = $1 FOR NO KEY UPDATE`,
        [schoolId],
      );
      if (!school) return false;
      const sent = school.sent ?? {};
      if (sent[marker]) return false;
      const cutoff = now.getTime() - MARKER_KEEP_DAYS * DAY_MS;
      const kept = Object.fromEntries(
        Object.entries(sent).filter(([, at]) => Date.parse(at) > cutoff),
      );
      kept[marker] = now.toISOString();
      await m.query(
        `UPDATE schools
            SET onboarding = jsonb_set(COALESCE(onboarding, '{}'::jsonb), '{sms_expiry_notices}', $2::jsonb)
          WHERE id = $1`,
        [schoolId, JSON.stringify(kept)],
      );
      return true;
    });
  }
}

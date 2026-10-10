import { Logger } from '@nestjs/common';

const logger = new Logger('SentryCron');

/** Node twin of `cron_checkin()` in scripts/backup/backup.sh. Never throws; unset URL = no-op. */
export async function sentryCronCheckIn(
  url: string | undefined,
  status: 'in_progress' | 'ok' | 'error',
): Promise<void> {
  if (!url) return;
  try {
    await fetch(`${url}?status=${status}`, { method: 'POST', signal: AbortSignal.timeout(10_000) });
  } catch (e) {
    logger.warn(`Sentry cron check-in failed: ${String(e)}`);
  }
}

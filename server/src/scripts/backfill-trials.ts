import dataSource from '../data-source';
import { AuditAction } from '@biddaloy/shared';
import { AuditLog } from '../modules/audit/entities/audit-log.entity';
import { AuditService } from '../modules/audit/audit.service';
import { billingFreeUntil } from '../config/env.validation';
import { applyGuardError } from './reconcile-sms-credit';

/**
 * [Epic 49 / #2716] One-off, per environment: retires the old trial for schools that already exist.
 * Every school's `trial_ends_at` goes to NULL, and a school the trial job suspended
 * (SUSPENDED + TRIAL_EXPIRED) is reactivated with an audit row. Idempotent: a second run finds
 * nothing to change. `seat_limit` is left alone; the next daily `billing-recompute` sets it.
 *
 * Dry run unless `--apply`, which also needs `--confirm-db=<name>` equal to the connected database.
 * Does not boot AppModule. Prints counts only.
 */
const USAGE = 'usage: backfill-trials [--apply --confirm-db=<database name>]';

export async function main(argv: string[]): Promise<number> {
  const apply = argv.includes('--apply');
  const confirmDb = argv.find((a) => a.startsWith('--confirm-db='))?.slice('--confirm-db='.length);
  if (argv.some((a) => a !== '--apply' && !a.startsWith('--confirm-db='))) {
    console.error(USAGE);
    return 2;
  }

  await dataSource.initialize();
  try {
    const [{ current_database }] = await dataSource.query('SELECT current_database()');
    console.log(`backfill-trials mode=${apply ? 'APPLY' : 'DRY-RUN'} database=${current_database}`);
    const guardError = applyGuardError(apply, confirmDb, current_database);
    if (guardError) {
      console.error(guardError);
      return 2;
    }

    const audit = new AuditService(dataSource.getRepository(AuditLog));
    const result = await dataSource.transaction(async (m) => {
      const reactivate: { id: string }[] = await m.query(
        `SELECT id FROM schools WHERE status = 'SUSPENDED' AND status_reason = 'TRIAL_EXPIRED'`,
      );
      const [{ n }] = await m.query(
        `SELECT count(*)::int AS n FROM schools WHERE trial_ends_at IS NOT NULL`,
      );
      if (!apply) return { cleared: n as number, reactivated: reactivate.length };

      for (const { id } of reactivate) {
        await m.query(
          `UPDATE schools SET status = 'ACTIVE', status_reason = NULL, status_changed_at = now() WHERE id = $1`,
          [id],
        );
        await audit.record(
          {
            action: AuditAction.REACTIVATE,
            entity_type: 'Trial',
            entity_id: id,
            tenant_id: id,
            performed_by_user_id: null,
            old_values: { status: 'SUSPENDED', reason: 'TRIAL_EXPIRED' },
            new_values: { status: 'ACTIVE', reason: null, event: 'TRIAL_RETIRED' },
          },
          m,
        );
      }
      await m.query(`UPDATE schools SET trial_ends_at = NULL WHERE trial_ends_at IS NOT NULL`);
      // Before the cutoff every school is unlimited (the trial used to cap new ones at 10).
      if (Date.now() < billingFreeUntil().getTime()) {
        await m.query(`UPDATE schools SET seat_limit = NULL WHERE seat_limit IS NOT NULL`);
      }
      return { cleared: n as number, reactivated: reactivate.length };
    });
    console.log(`trial_ends_at cleared=${result.cleared} reactivated=${result.reactivated}`);
    if (apply) {
      console.log(
        'Restart the server (or wait up to 5 minutes) so cached tenant status is refreshed.',
      );
    }
    return 0;
  } finally {
    await dataSource.destroy();
  }
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error('backfill-trials failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    });
}

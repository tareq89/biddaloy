import dataSource from '../data-source';
import { SmsCreditBalance } from '../modules/communications/credits/entities/sms-credit-balance.entity';
import { SmsCreditLedger } from '../modules/communications/credits/entities/sms-credit-ledger.entity';
import { SmsCreditService } from '../modules/communications/credits/sms-credit.service';
import {
  reconcileStrandedSmsCredit,
  ReconcileAction,
} from '../modules/communications/credits/sms-credit-reconcile';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * [#1317] Settles SMS credit reservations stranded by the old `batch:` key
 * mismatch. Dry run unless `--apply`; optional `--tenant=<uuid>`. Does not
 * boot AppModule (no queue workers/crons in the operator's shell). Prints
 * ids, counts and codes only; see docs/architecture/05-communications.md.
 */
export async function main(argv: string[]): Promise<number> {
  const apply = argv.includes('--apply');
  const tenantArg = argv.find((a) => a.startsWith('--tenant='));
  const tenantId = tenantArg?.slice('--tenant='.length);
  const unknown = argv.filter((a) => a !== '--apply' && !a.startsWith('--tenant='));
  if ((tenantId !== undefined && !UUID.test(tenantId)) || unknown.length > 0) {
    console.error('usage: sms-credit:reconcile [--apply] [--tenant=<uuid>]');
    return 2;
  }

  await dataSource.initialize();
  try {
    const [{ current_database }] = await dataSource.query('SELECT current_database()');
    console.log(
      `sms-credit:reconcile mode=${apply ? 'APPLY' : 'DRY-RUN'} database=${current_database}`,
    );
    // isMetered/getCreditsSummary are never called here, settlePart only.
    const credits = new SmsCreditService(
      dataSource.getRepository(SmsCreditBalance),
      dataSource.getRepository(SmsCreditLedger),
      dataSource,
      undefined as never,
    );
    let errors = 0;
    await reconcileStrandedSmsCredit(dataSource, credits, {
      apply,
      tenantId,
      onTenantDone: (rep) => {
        const sum = (a: ReconcileAction) => rep.rows.filter((r) => r.action === a);
        const fmt = (a: ReconcileAction, total = false) => {
          const rows = sum(a);
          const u = rows.reduce((n, r) => n + r.units, 0);
          return total ? `${rows.length}/${u}u` : `${rows.length}`;
        };
        for (const r of rep.rows) {
          console.log(
            `tenant=${r.tenantId} reserve=${r.reserveLedgerId} source=${r.source} log=${r.logId ?? '-'} units=${r.units} action=${r.action} reason=${r.reason}`,
          );
        }
        errors += sum('ERROR').length;
        console.log(
          `tenant=${rep.tenantId} stranded_reserves=${rep.strandedReserves} settled_reserves=${rep.settledReserves} debit=${fmt('DEBIT', true)} release=${fmt('RELEASE', true)} manual=${fmt('MANUAL_REVIEW', true)} already_settled=${fmt('ALREADY_SETTLED')} in_flight=${fmt('IN_FLIGHT')} errors=${fmt('ERROR')}`,
        );
      },
    });
    return errors > 0 ? 1 : 0;
  } finally {
    await dataSource.destroy();
  }
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error('sms-credit:reconcile failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    });
}

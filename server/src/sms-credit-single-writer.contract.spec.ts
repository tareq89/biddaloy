import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Contract test [#3847, Epic 100 D1 D28, Rule 27 style]: only `SmsCreditService` writes the
 * SMS credit tables.
 *
 * Why: the balance row, the ledger and the lots only agree because one class writes them in one
 * transaction. A second writer can change one without the others, and the numbers drift.
 *
 * Fixing a failure: do not add a file to ALLOWED to make it pass. Call `SmsCreditService`
 * instead. ALLOWED holds files that only name a table (entity lists, read-only reconcile, a
 * comment) and each carries its reason. An entry ending in `/` matches a directory prefix.
 *
 * `SmsCreditLot` and `SmsCreditLotDraw` (tables `sms_credit_lots`, `sms_credit_lot_draws`) do
 * not exist yet; naming them now means Wave 1 needs no edit here.
 *
 * Skips `*.spec.ts`, `*.e2e-spec.ts` and `src/migrations/**` (any `migrations` directory).
 */
export const ALLOWED: Record<string, string> = {
  'modules/communications/credits/sms-credit.service.ts': 'the one writer',
  'modules/communications/credits/entities/': 'the entity files',
  'modules/communications/credits/sms-credit-lot-invariants.ts':
    'read-only invariant check, writes nothing',
  'modules/communications/credits/sms-credit-reconcile.ts': 'reads and delegates to the service',
  'scripts/reconcile-sms-credit.ts': 'reads and delegates to the service',
  'modules/communications/credits/credits.module.ts': 'entity list',
  'app.module.ts': 'entity list',
  'modules/workbook/codec/entity-coverage.ts': 'coverage table',
  'scripts/demo-seed/slices/comms-print.ts': 'fresh-database demo seed, a reviewed exception',
  'scripts/demo-seed/slices/sms-bundles.ts':
    'fresh-database demo seed, a reviewed exception: balance becomes one LEGACY lot (see the slice comment)',
  'scripts/demo-seed/slices.ts': 'EXEMPT list names SmsCreditLotDraw; no write',
  'modules/sms-bundles/expiry/sms-expiry.service.ts':
    'reads sms_credit_lots; its only UPDATE is on sms_bundle_orders; lots expire via SmsCreditService.expireDue',
  'modules/communications/credits/sms-credit-summary.service.ts':
    'read-only school summary, never writes',
  'modules/attention/rules/system/comms-sms-low.rule.ts': 'read-only SELECT on lots',
  'modules/attention/rules/system/comms-sms-expiring.rule.ts': 'read-only SELECT on lots',
  'scripts/demo-seed/slices/sms-bundles.ts': 'fresh-database demo seed, a reviewed exception',
  'modules/calendar/calendar.module.ts': 'comment mention',
  'modules/calendar/calendar-notify.service.ts': 'comment mention',
  'modules/push/entities/push-subscription.entity.ts': 'comment mention',
};

const GUARDED =
  /\b(SmsCreditLedger|SmsCreditBalance|SmsCreditLot|SmsCreditLotDraw|sms_credit_ledger|sms_credit_balance|sms_credit_lots|sms_credit_lot_draws)\b/;

const SRC_DIR = __dirname;

function collectFiles(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'migrations') continue;
    const fullPath = join(dir, name);
    if (statSync(fullPath).isDirectory()) {
      files.push(...collectFiles(fullPath));
    } else if (
      name.endsWith('.ts') &&
      !name.endsWith('.spec.ts') &&
      !name.endsWith('.e2e-spec.ts')
    ) {
      files.push(fullPath);
    }
  }
  return files;
}

/** Paths (relative to src) of every file that mentions a guarded name. */
function filesMentioningGuardedNames(files: Map<string, string>): string[] {
  return [...files].filter(([, text]) => GUARDED.test(text)).map(([path]) => path);
}

const isAllowed = (path: string, allowed: string[]) =>
  allowed.some((entry) => (entry.endsWith('/') ? path.startsWith(entry) : path === entry));

const sources = new Map<string, string>(
  collectFiles(SRC_DIR).map((f) => [relative(SRC_DIR, f), readFileSync(f, 'utf8')]),
);

describe('only SmsCreditService writes the SMS credit tables', () => {
  it('has no file outside ALLOWED that mentions a guarded name', () => {
    const offenders = filesMentioningGuardedNames(sources).filter(
      (p) => !isAllowed(p, Object.keys(ALLOWED)),
    );
    // The message names each file: move the write into SmsCreditService.
    expect(offenders).toEqual([]);
  });

  it('has no stale ALLOWED entry (the list can only shrink)', () => {
    const mentioning = filesMentioningGuardedNames(sources);
    const stale = Object.keys(ALLOWED).filter(
      (entry) => !mentioning.some((p) => isAllowed(p, [entry])),
    );
    expect(stale).toEqual([]);
  });

  it('flags a throwaway file that mentions a guarded name', () => {
    const fake = new Map([
      [
        'modules/fake/rogue.service.ts',
        'await m.query("UPDATE sms_credit_balance SET available = 0")',
      ],
      ['modules/fake/clean.service.ts', 'const SmsCreditLedgerDto = 1; // not a guarded word'],
    ]);
    const hits = filesMentioningGuardedNames(fake);
    expect(hits).toEqual(['modules/fake/rogue.service.ts']);
    expect(isAllowed(hits[0], Object.keys(ALLOWED))).toBe(false);
  });
});

import 'reflect-metadata';
import {
  CutoverRefusedError,
  PlatformCutoverService,
  type CutoverResult,
} from '../modules/platform-identity/platform-cutover.service';
import { createScriptAppContext } from './script-app-context';

/**
 * Converts the old platform authority, once, on request. [Epic 98 #3768, D18, D23]
 *
 *   node server/dist/scripts/platform-cutover.js --dry-run   # prints the plan, changes nothing
 *   node server/dist/scripts/platform-cutover.js             # does it
 *
 * Not automatic: it turns every legacy school SUPER_ADMIN into an ADMIN and removes platform
 * memberships, so an operator runs it after the owners are verified (#3773). Refuses unless an
 * active, unlocked owner with a confirmed authenticator exists. Safe to run twice (`cutover.done`);
 * a run that stopped before cutting sessions off resumes from the stored user ids (Rule 8).
 * Output carries ids and counts only, never an email, phone or secret (Rule 13).
 */
export function formatCutoverResult(result: CutoverResult): string[] {
  if (result.status === 'already_done') return ['cutover already done: nothing to change'];
  const lines = [
    result.status === 'dry_run' ? 'DRY RUN: nothing was changed' : 'cutover done',
    `memberships removed: ${result.counts.removed}`,
    `SUPER_ADMIN downgraded to ADMIN: ${result.counts.downgraded}`,
    `duplicate SUPER_ADMIN rows removed: ${result.counts.duplicatesRemoved}`,
    `users whose sessions ${result.status === 'dry_run' ? 'would be' : 'were'} cut off: ${result.sessionsCut}`,
  ];
  for (const row of result.plan)
    lines.push(`  ${row.action} user ${row.userId} school ${row.tenantId}`);
  return lines;
}

/**
 * Only no argument (a real run) or exactly `--dry-run`. Anything else, such as `--dryrun` or
 * `--dry-run=true`, is refused so a typo can never fall through to a real cutover.
 */
export function parseCutoverArgs(args: string[]): { dryRun: boolean } | null {
  if (args.length === 0) return { dryRun: false };
  if (args.length === 1 && args[0] === '--dry-run') return { dryRun: true };
  return null;
}

if (require.main === module) {
  void (async () => {
    const parsed = parseCutoverArgs(process.argv.slice(2));
    if (!parsed) {
      console.error('usage: platform-cutover [--dry-run]');
      process.exit(1);
    }
    const dryRun = parsed.dryRun;
    let code = 1;
    const app = await createScriptAppContext();
    try {
      const result = await app.get(PlatformCutoverService).run({ dryRun });
      for (const line of formatCutoverResult(result)) console.log(line);
      code = 0;
    } catch (err) {
      // A refusal has fixed text; anything else is not echoed (it could carry row data).
      console.error(
        'platform-cutover failed:',
        err instanceof CutoverRefusedError ? err.message : 'error, see the application log',
      );
    }
    await app.close();
    process.exit(code);
  })();
}

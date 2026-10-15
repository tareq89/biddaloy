import { parse } from 'pg-connection-string';
import { assertLocalSeedTarget } from '../seed-guard';

/** Database names `scripts/test-env.sh` and the load-run guide create. Nothing else is allowed. */
const THROWAWAY_NAME = /^(biddaloy_test_run_|biddaloy_load_)[a-z0-9_]+$/;

/**
 * [8.10.7.6.01] The load seed writes ~1M rows. It runs only when ALL are true:
 *  - LOAD_SEED_CONFIRM=yes (a deliberate act, never an accident)
 *  - NODE_ENV is not production
 *  - the database is on this machine
 *  - the database NAME says it is throwaway (biddaloy_test_run_* / biddaloy_load_*)
 * Throws with a message naming the failed rule; the caller prints it and exits 1.
 */
export function assertThrowawayDatabase(url: string, env: NodeJS.ProcessEnv): void {
  if (env.LOAD_SEED_CONFIRM !== 'yes') {
    throw new Error(
      'Refusing to run the load seed: set LOAD_SEED_CONFIRM=yes to confirm this is a throwaway database.',
    );
  }
  // NODE_ENV=production + local-host rules are shared with seed / db:reset.
  assertLocalSeedTarget({ ...env, DATABASE_URL: url }, 'load:seed');
  const name = (parse(url).database ?? '').toLowerCase();
  if (!THROWAWAY_NAME.test(name)) {
    throw new Error(
      `Refusing to run the load seed against database "${name}": the name must start with ` +
        '"biddaloy_test_run_" or "biddaloy_load_". Create one with `yarn test-env up`.',
    );
  }
}

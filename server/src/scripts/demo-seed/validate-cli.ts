import type { DataSource } from 'typeorm';
import dataSource from '../../data-source';
import { validate } from './validator';

/**
 * Runs the invariant validator against `DATABASE_URL`. Returns the exit code: 0 only when there
 * are no violations, 1 on any violation or error. scripts/demo/reset.sh (nightly reset) swaps a
 * new demo database in only on 0, so this code is the swap gate (validate-cli.spec.ts).
 */
export async function main(
  ds: Pick<DataSource, 'initialize' | 'destroy' | 'query'> = dataSource,
  check: typeof validate = validate,
): Promise<number> {
  try {
    await ds.initialize();
    try {
      const violations = await check(ds);
      for (const v of violations) console.error(`[${v.check}] ${v.message}`);
      console.log(`demo validator: ${violations.length} violation(s)`);
      return violations.length === 0 ? 0 : 1;
    } finally {
      await ds.destroy();
    }
  } catch (e) {
    console.error((e as Error).message);
    return 1;
  }
}

if (require.main === module) {
  void main().then((code) => process.exit(code));
}

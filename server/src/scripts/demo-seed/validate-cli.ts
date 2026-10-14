import dataSource from '../../data-source';
import { validate } from './validator';

/**
 * Runs the invariant validator against `DATABASE_URL`. Exit 1 on any violation or error.
 * Called by scripts/demo/reset.sh (nightly reset) before it swaps a new demo database in.
 */
async function main(): Promise<number> {
  await dataSource.initialize();
  try {
    const violations = await validate(dataSource);
    for (const v of violations) console.error(`[${v.check}] ${v.message}`);
    console.log(`demo validator: ${violations.length} violation(s)`);
    return violations.length === 0 ? 0 : 1;
  } finally {
    await dataSource.destroy();
  }
}

if (require.main === module) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error((e as Error).message);
      process.exit(1);
    },
  );
}

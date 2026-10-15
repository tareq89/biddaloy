import { resolve } from 'path';
import { config } from 'dotenv';
import { parse } from 'pg-connection-string';
import { DataSource } from 'typeorm';
import { RedactingTypeOrmLogger } from '../../db-logger';
import { todayInSchoolTz } from '../../common/time';
import { createScriptAppContext } from '../script-app-context';
import { createContext, demoPassword, type DemoSeedContext, type DemoSlice } from './context';
import { SLICES } from './slices';

export interface DemoSeedArgs {
  scale: number;
  years: number;
  anchor: string;
}

/** The real clock's `YYYY-MM`, read the way `PaymentAllocationService` reads it (`new Date()`, local). */
const realClockMonth = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

/** `--scale 1 --anchor 2026-10-10 --years 10`; every flag optional. Throws on bad input. */
export function parseArgs(
  argv: string[],
  today: () => string = todayInSchoolTz,
  clockMonth: () => string = realClockMonth,
): DemoSeedArgs {
  const flag = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    if (i === -1) return undefined;
    // A flag with its value forgotten must fail, not fall back to the default (or today).
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Error(`--${name} needs a value`);
    return v;
  };
  const scale = Number(flag('scale') ?? 1);
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('--scale must be a number > 0');
  const years = Number(flag('years') ?? 10);
  if (!Number.isInteger(years) || years < 1) throw new Error('--years must be an integer >= 1');
  const anchor = flag('anchor') ?? today();
  const valid =
    /^\d{4}-\d{2}-\d{2}$/.test(anchor) &&
    !Number.isNaN(Date.parse(anchor)) &&
    new Date(anchor).toISOString().slice(0, 10) === anchor;
  if (!valid) throw new Error('--anchor must be a real YYYY-MM-DD date');
  // The fees slice records this month's payments through the real services, which type and date
  // them by the real clock: a bill in a later month than the clock is refused as "future".
  if (anchor.slice(0, 7) > clockMonth()) {
    throw new Error(
      `--anchor ${anchor} is in a later month than the real clock (${clockMonth()}): ` +
        'fees payments use the real clock, so the anchor must be this month or earlier',
    );
  }
  return { scale, years, anchor };
}

/**
 * Guards 1 and 2, run before the app boots. Deliberately not `assertLocalSeedTarget`: the nightly
 * reset runs in production mode against a Docker-service host, which that guard refuses. The
 * database name is the safety net instead (D40).
 */
export function assertDemoTarget(env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV === 'production' && env.DEMO_MODE !== 'true') {
    throw new Error(
      'Refusing to run seed:demo with NODE_ENV=production unless DEMO_MODE=true: it writes a fake school.',
    );
  }
  // Same rule as the server's env validation: a DEMO_MODE host shows DEMO_PASSWORD on the login
  // cards, so seeding the fallback there would make every card fail to log in.
  if ((env.NODE_ENV === 'production' || env.DEMO_MODE === 'true') && !env.DEMO_PASSWORD) {
    throw new Error(
      'DEMO_PASSWORD is required with NODE_ENV=production or DEMO_MODE=true: demo logins must not use a public default.',
    );
  }
  let database: string;
  try {
    database = parse(env.DATABASE_URL ?? '').database ?? '';
  } catch {
    database = '';
  }
  if (!database.startsWith('biddaloy_demo')) {
    throw new Error(
      `Refusing to run seed:demo: database "${database}" does not start with "biddaloy_demo". ` +
        'Build the demo in a fresh biddaloy_demo* database, then swap it in.',
    );
  }
}

/**
 * Guard 3. The `default-school` row is the platform tenant every migrated DB already has
 * (MultiTenantAuth migration), so it does not count.
 */
export async function assertEmptyDatabase(ds: Pick<DataSource, 'query'>): Promise<void> {
  const [{ n }] = await ds.query(
    `SELECT count(*)::int AS n FROM schools WHERE slug <> 'default-school'`,
  );
  if (Number(n) > 0) throw new Error('demo seed needs an empty, migrated database');
}

/** Runs slices in order with one shared context. A throw names the slice and stops the run. */
export async function runSlices(ctx: DemoSeedContext, slices: DemoSlice[]): Promise<void> {
  for (const slice of slices) {
    const t0 = Date.now();
    try {
      const rows = (await slice.run(ctx)) ?? 0;
      ctx.timings.push({ slice: slice.name, rows, ms: Date.now() - t0 });
    } catch (e) {
      throw new Error(`slice "${slice.name}" failed: ${(e as Error).message}`, { cause: e });
    }
  }
}

export function formatTimings(timings: DemoSeedContext['timings']): string {
  const lines = timings.map(
    (t) =>
      `${t.slice.padEnd(16)}${String(t.rows).padStart(10)}${(t.ms / 1000).toFixed(1).padStart(10)}`,
  );
  return ['slice               rows   seconds', ...lines].join('\n');
}

/**
 * Runs guards 1-2, boots the app, checks the DB is empty, runs every slice. The caller owns
 * `app.close()` (main and the coverage spec both need the DataSource afterwards).
 */
export async function runDemoSeed(args: DemoSeedArgs, password: string) {
  assertDemoTarget(process.env);
  const app = await createScriptAppContext();
  try {
    const ds = app.get(DataSource);
    // Dev logging prints every query; millions of them skew the timings. Errors still show.
    (ds as { logger: unknown }).logger = new RedactingTypeOrmLogger(['error', 'warn']);
    await assertEmptyDatabase(ds);
    const ctx = await createContext({ ds, app, ...args, password });
    await runSlices(ctx, SLICES);
    return { app, ds, ctx };
  } catch (e) {
    await app.close();
    throw e;
  }
}

async function main(): Promise<void> {
  // Before the guards read DEMO_MODE / DEMO_PASSWORD / DATABASE_URL. Exported vars still win.
  config({ path: resolve(__dirname, '..', '..', '..', '..', '.env') });
  const args = parseArgs(process.argv.slice(2));
  if (process.env.DEMO_MODE !== 'true') {
    console.warn(
      '\n*** WARNING: DEMO_MODE is not "true". The applications slice decides requests through the real\n' +
        '*** notify services, which then use the real SMS / push providers and SMS credit.\n' +
        '*** Set DEMO_MODE=true so every message becomes a log row.\n',
    );
  }
  const { app, ctx } = await runDemoSeed(args, demoPassword(process.env));
  try {
    console.log(formatTimings(ctx.timings));
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().then(
    () => process.exit(0),
    (e) => {
      console.error((e as Error).message);
      process.exit(1);
    },
  );
}

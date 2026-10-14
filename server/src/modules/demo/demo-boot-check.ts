import { DataSource } from 'typeorm';
import { buildDatabaseSsl } from '../../db-ssl';
import { DEMO_SCHOOL_SLUGS } from './demo-accounts';

type SchoolRow = { id: string; slug: string };

/** Every school row, soft-deleted ones included: a deleted real school still means a real DB. */
async function loadSchools(env: NodeJS.ProcessEnv): Promise<SchoolRow[]> {
  const { ssl } = buildDatabaseSsl(env.NODE_ENV, env.DB_SSL, env.DB_SSL_REJECT_UNAUTHORIZED);
  const ds = new DataSource({ type: 'postgres', url: env.DATABASE_URL, ssl });
  await ds.initialize();
  try {
    return await ds.query('SELECT id, slug FROM schools');
  } finally {
    await ds.destroy();
  }
}

/**
 * D30: a demo build must never run against a real database. With `DEMO_MODE=true`, any school
 * whose slug is not a demo branch throws. Exempt: the configured `PLATFORM_TENANT_ID`, and
 * `default-school`, the platform row every migrated DB holds (random uuid, MultiTenantAuth
 * migration); the seed runner's guard 3 exempts it too. A real DB has real schools besides it.
 *
 * Called from `main.ts` and `createScriptAppContext` BEFORE Nest builds the app. It cannot be a
 * Nest lifecycle hook: every module's `onModuleInit` runs first, and on a wrong Redis that already
 * removes the real trial and backup schedulers and starts BullMQ workers that would settle real
 * queued SMS as SENT through the demo-log provider.
 */
export async function assertDemoDatabase(
  env: NodeJS.ProcessEnv = process.env,
  load: (env: NodeJS.ProcessEnv) => Promise<SchoolRow[]> = loadSchools,
): Promise<void> {
  if (env.DEMO_MODE !== 'true') return;
  const allowed = new Set<string>([...DEMO_SCHOOL_SLUGS, 'default-school']);
  const foreign = (await load(env)).filter(
    (r) => !allowed.has(r.slug) && r.id !== env.PLATFORM_TENANT_ID,
  );
  if (foreign.length > 0) {
    throw new Error(
      `DEMO_MODE refuses to start: database holds non-demo schools (${foreign.map((r) => r.slug).join(', ')})`,
    );
  }
}

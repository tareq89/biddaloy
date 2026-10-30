import { DataSource } from 'typeorm';
import { buildDatabaseSsl } from '../../db-ssl';
import { DEMO_SCHOOL_SLUGS } from './demo-accounts';

type SchoolRow = {
  id: string;
  slug: string;
  has_students?: boolean;
  created_in_demo?: boolean;
};

/** Every school row, soft-deleted ones included: a deleted real school still means a real DB. */
async function loadSchools(env: NodeJS.ProcessEnv): Promise<SchoolRow[]> {
  const { ssl } = buildDatabaseSsl(env.NODE_ENV, env.DB_SSL, env.DB_SSL_REJECT_UNAUTHORIZED);
  const ds = new DataSource({ type: 'postgres', url: env.DATABASE_URL, ssl });
  await ds.initialize();
  try {
    return await ds.query(
      `SELECT s.id, s.slug,
              EXISTS (SELECT 1 FROM students st WHERE st.tenant_id = s.id) AS has_students,
              s.created_in_demo
         FROM schools s`,
    );
  } finally {
    await ds.destroy();
  }
}

/**
 * D30: a demo build must never run against a real database. With `DEMO_MODE=true`, any school
 * whose slug is not a demo branch throws. Only `bmsc-*` rows may hold students. Two rows are
 * exempt while they hold none: `default-school`, the platform row every migrated DB holds (random
 * uuid, MultiTenantAuth migration), and the configured `PLATFORM_TENANT_ID`. A pre-multi-tenant
 * install keeps its real data under `default-school`, and its env names that row as the platform
 * tenant, so a students check on the exemption is what refuses it. The seed runner's guard 3
 * exempts `default-school` too; only this boot check adds the no-students condition.
 *
 * D3 (Epic 88): a school a visitor registered on the demo (`created_in_demo`) is never foreign, however
 * many students it holds. No size cap: one visitor can add 100 rows per request, so any cap a visitor
 * can reach would stop the public demo from booting. The flag is safe to trust on its own: only
 * `ProvisioningService` writes it, from `isDemoMode()`; the migration default is false and the
 * workbook import leaves it out, so a real database gets it only through a deliberate `UPDATE`.
 *
 * Called from `main.ts` and `createScriptAppContext` BEFORE Nest builds the app. It cannot be a
 * Nest lifecycle hook: every module's `onModuleInit` runs first, and on a wrong Redis that already
 * removes the real trial and backup schedulers and starts BullMQ workers that would settle real
 * queued SMS as SENT through the (now retired) demo provider swap.
 */
export async function assertDemoDatabase(
  env: NodeJS.ProcessEnv = process.env,
  load: (env: NodeJS.ProcessEnv) => Promise<SchoolRow[]> = loadSchools,
): Promise<void> {
  if (env.DEMO_MODE !== 'true') return;
  const demo = new Set<string>(DEMO_SCHOOL_SLUGS);
  const foreign = (await load(env)).filter(
    (r) =>
      !demo.has(r.slug) &&
      !r.created_in_demo &&
      (r.has_students || (r.slug !== 'default-school' && r.id !== env.PLATFORM_TENANT_ID)),
  );
  if (foreign.length > 0) {
    throw new Error(
      `DEMO_MODE refuses to start: database holds non-demo schools (${foreign.map((r) => r.slug).join(', ')}). ` +
        'Only the bmsc-* branches and visitor schools (created_in_demo) may hold students, and besides them only an empty default-school ' +
        '(the platform row every migration creates) or the empty PLATFORM_TENANT_ID row. ' +
        'Anything else means this is not a demo database.',
    );
  }
}

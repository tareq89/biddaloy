/**
 * [#3949, Epic 59 D14] In production the app must connect as a role the database tenant wall
 * applies to: not a superuser, not BYPASSRLS, and not the owner of `students` (an owner can
 * `ALTER TABLE ... NO FORCE ROW LEVEL SECURITY` on its own table). One fixed sentence, never the
 * role name (Rule 23). Only `development` and `test` skip it (dev and CI connect as the owner); an unset NODE_ENV is checked too.
 *
 * Takes anything with `query`, so a spec can pass a fake.
 */
export async function assertAppRoleIsNotOwner(
  db: { query(sql: string): Promise<unknown> },
  nodeEnv: string | undefined,
  // Only the demo-reset container's temporary app (it connects as the owner to swap databases) sets
  // allowOwner, and it only counts with DEMO_MODE=true: a real school's app can never opt out.
  allowOwner?: string,
  demoMode?: string,
): Promise<void> {
  if (
    nodeEnv === 'development' ||
    nodeEnv === 'test' ||
    (allowOwner === 'true' && demoMode === 'true')
  )
    return;
  const rows = (await db.query(
    `SELECT r.rolsuper, r.rolbypassrls,
            COALESCE((SELECT pg_has_role(r.oid, c.relowner, 'USAGE') FROM pg_class c
                       WHERE c.relname = 'students' AND c.relnamespace = 'public'::regnamespace), false) AS owns_students
       FROM pg_roles r WHERE r.rolname = current_user`,
  )) as Array<{ rolsuper: boolean; rolbypassrls: boolean; owns_students: boolean }>;
  const row = rows[0];
  if (!row || row.rolsuper || row.rolbypassrls || row.owns_students) {
    throw new Error(
      'The app database role must not be a superuser, bypass row-level security or own the students table. Refusing to boot. ' +
        'Set DATABASE_URL to the biddaloy_app role (see the platform runbook).',
    );
  }
}

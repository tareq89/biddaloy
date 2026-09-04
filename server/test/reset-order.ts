import {
  SEED_TENANT_ID,
  SEED_ADMIN_USER_ID,
  SEED_ACADEMIC_YEAR_ID,
  SEED_CLASS_1_ID,
  SEED_CLASS_2_ID,
  SEED_SECTION_1_ID,
  SEED_SECTION_2_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD_HASH,
} from './constants';

/**
 * Child-first delete order for the transactional tables cleared before
 * every test. Validated against the live `pg_constraint` FK graph by
 * `reset-order.integration.spec.ts` — if a future migration adds an FK
 * this order violates, that spec fails and tells you which table to move.
 *
 * `user_tenants`, `schools`, `users`, `academic_years`, `classes`, and
 * `class_sections` are deliberately absent from this list — they're reset
 * separately, once per spec *file* rather than once per *test*, by
 * `buildReferenceResetSql()` below. See that function's doc comment for
 * why they need their own cadence.
 */
export const TRANSACTIONAL_TABLES_CHILD_FIRST = [
  'payment_allocations',
  'payments',
  'invoices',
  'student_fees',
  'fee_structure_students',
  'fee_structures',
  'communication_logs',
  'reminder_batches',
  'student_guardians',
  'guardians',
  'enrollments',
  'class_subjects',
  'teacher_class_sections',
  'teachers',
  'subjects',
  'audit_logs',
  'students',
] as const;

/**
 * `audit_logs` is append-only at the database level: migration
 * `1784175065078-InitialSchema` installs a `BEFORE UPDATE OR DELETE ...
 * FOR EACH ROW` trigger named `trg_audit_logs_write_only` (running the
 * `block_audit_logs_write_only()` function), which
 * `1785749259955-AddTenantIdToAuditLogs` later drops and recreates —
 * grep for both if you need to change it. The trigger raises on
 * every row-level `DELETE`, by design — audit trail rows must never be
 * editable or removable outside a schema migration. `TRUNCATE` doesn't
 * fire row-level triggers (only statement-level `TRUNCATE` triggers,
 * and none is defined here), so it's the only way to clear this one
 * table between tests. Nothing else has a foreign key to `audit_logs`
 * (checked: no `REFERENCES "audit_logs"` in any migration), so this
 * doesn't need `CASCADE`.
 */
const WRITE_ONLY_TABLES = new Set<string>(['audit_logs']);

/**
 * One multi-statement query — one round trip, implicitly transactional
 * (Postgres runs a multi-statement `simple query` message as a single
 * implicit transaction) — child-first so no FK violation fires mid-reset.
 * `DELETE` for ordinary tables (measured ~60x faster than the old
 * per-table `TRUNCATE` loop); `TRUNCATE` only for `audit_logs`, which
 * rejects `DELETE` outright (see `WRITE_ONLY_TABLES` above).
 */
export function buildResetSql(): string {
  return TRANSACTIONAL_TABLES_CHILD_FIRST.map((t) =>
    WRITE_ONLY_TABLES.has(t) ? `TRUNCATE TABLE "${t}"` : `DELETE FROM "${t}"`,
  ).join('; ');
}

/** Child-first delete order for the six reference tables below. */
export const REFERENCE_TABLES_CHILD_FIRST = [
  'class_sections',
  'classes',
  'academic_years',
  'user_tenants',
  'users',
  'schools',
] as const;

/**
 * Reset the six reference tables (`schools`, `users`, `user_tenants`,
 * `academic_years`, `classes`, `class_sections`) to exactly the baseline
 * seed row set, once per spec *file* (called from `setup.ts`'s per-file
 * `beforeAll`, not its per-test `beforeEach`).
 *
 * These used to be reset implicitly, once per file, as a side effect of
 * `dataSource.dropDatabase()` + re-migrate + re-seed running in every
 * file's own `beforeAll`/`afterAll`. Stage 2 (`test/global-setup.ts`)
 * moved that migrate-and-seed cycle to run once per *run* instead of once
 * per *file*, for the ~340ms → ~6ms no-op win described there — but two
 * classes of spec file mutate these six tables directly and relied on
 * that per-file wipe for isolation:
 *
 * - Several e2e specs (e.g. `academic-years.e2e-spec.ts`,
 *   `auth.e2e-spec.ts`) `INSERT` an extra `user_tenants` row for the
 *   seeded admin, to test a second role, and never delete it themselves.
 * - Integration specs that build their own `TypeOrmModule` with
 *   `{ synchronize: true, dropSchema: true }` (e.g.
 *   `students.service.integration.spec.ts`) drop and rebuild the *entire*
 *   schema from entity metadata in their own `beforeAll`, then seed their
 *   own local fixtures into these tables. Note that this is schema-level
 *   damage, not just stray rows — `repairSchemaIfDamaged()` in `setup.ts`
 *   handles the part that re-inserting rows cannot fix.
 *
 * Without a per-file reset, both leak forward into whichever spec file
 * runs next in the same `vitest run` invocation — e.g. a stray extra
 * `user_tenants` row collides with `IDX_user_tenants_user_tenant_role`'s
 * unique constraint the next time some other file inserts the same
 * (user, tenant, role) tuple.
 *
 * This is *not* run per-test (unlike `buildResetSql()` above) because
 * some files intentionally create additional tenants/users in their own
 * `beforeAll` and mutate them across their own tests — e.g.
 * `cross-tenant-access.e2e-spec.ts`. Resetting every test would wipe
 * those out from under the file's own first test.
 *
 * The seed values are interpolated rather than passed as `$n` parameters
 * because Postgres's simple query protocol — the only one that accepts
 * several statements in a single round trip, which is the whole point of
 * building one string here — does not support bind parameters. That is
 * safe only because every interpolated value is a compile-time constant
 * from `test/constants.ts` (UUIDs, a fixed email, a bcrypt hash, none of
 * which contain a quote). Anything caller-supplied must not go in here.
 */
export function buildReferenceResetSql(): string {
  const deletes = REFERENCE_TABLES_CHILD_FIRST.map((t) => `DELETE FROM "${t}"`);
  const inserts = [
    `INSERT INTO schools (id, name, slug, created_at, updated_at)
     VALUES ('${SEED_TENANT_ID}', 'Test School', 'test-school', NOW(), NOW())`,
    `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
     VALUES ('${SEED_ADMIN_USER_ID}', '${SEED_ADMIN_EMAIL}', '${SEED_ADMIN_PASSWORD_HASH}', 'Test Admin', 'ACTIVE', NOW(), NOW())`,
    `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
     VALUES ('${SEED_ADMIN_USER_ID}', '${SEED_TENANT_ID}', 'ADMIN', NOW(), NOW())`,
    `INSERT INTO academic_years (id, name, start_date, end_date, is_current, tenant_id, created_at, updated_at)
     VALUES ('${SEED_ACADEMIC_YEAR_ID}', '2026-2027', '2026-01-01', '2026-12-31', true, '${SEED_TENANT_ID}', NOW(), NOW())`,
    `INSERT INTO classes (id, name, academic_year_id, tenant_id, created_at, updated_at)
     VALUES ('${SEED_CLASS_1_ID}', 'Class 1', '${SEED_ACADEMIC_YEAR_ID}', '${SEED_TENANT_ID}', NOW(), NOW())`,
    `INSERT INTO classes (id, name, academic_year_id, tenant_id, created_at, updated_at)
     VALUES ('${SEED_CLASS_2_ID}', 'Class 2', '${SEED_ACADEMIC_YEAR_ID}', '${SEED_TENANT_ID}', NOW(), NOW())`,
    `INSERT INTO class_sections (id, section_name, class_id, tenant_id, created_at, updated_at)
     VALUES ('${SEED_SECTION_1_ID}', 'Section A', '${SEED_CLASS_1_ID}', '${SEED_TENANT_ID}', NOW(), NOW())`,
    `INSERT INTO class_sections (id, section_name, class_id, tenant_id, created_at, updated_at)
     VALUES ('${SEED_SECTION_2_ID}', 'Section B', '${SEED_CLASS_2_ID}', '${SEED_TENANT_ID}', NOW(), NOW())`,
  ];
  return [...deletes, ...inserts].join('; ');
}

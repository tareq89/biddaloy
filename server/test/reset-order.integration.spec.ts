import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { TRANSACTIONAL_TABLES_CHILD_FIRST, REFERENCE_TABLES_CHILD_FIRST } from './reset-order';

/**
 * Guards `reset-order.ts`'s delete order and coverage against the live schema.
 *
 * `test/setup.ts` runs `buildResetSql()` before every single test and
 * `buildReferenceResetSql()` before every spec file. If a future migration
 * adds a table or a foreign key those orders don't account for, the failure
 * surfaces as a stray FK violation in some unrelated suite with no obvious
 * cause. This spec fails loudly instead, at the one place responsible for the
 * order, and names the offending table or edge.
 */

/**
 * Tables that are deliberately not reset between tests, and why. Anything in
 * the schema that is not in one of the two ordered lists must be listed here
 * with a reason, or the coverage test below fails.
 */
const INTENTIONALLY_NOT_RESET: Record<string, string> = {
  // TypeORM's own migration bookkeeping. Resetting it would make the next
  // spec file re-run every migration against an already-migrated schema.
  typeorm_migrations: 'TypeORM migration bookkeeping, not test data',
  // Rows are removed implicitly: its only FK (`FK_rt_user` in
  // 1785740608549-AddRefreshTokens) is ON DELETE CASCADE, so deleting `users`
  // in buildReferenceResetSql() clears it. Listed explicitly so that if that
  // FK ever loses its CASCADE, this file is where you find out why.
  refresh_tokens: 'cleared by ON DELETE CASCADE from users',
};

describe('reset-order (integration)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      synchronize: false,
      logging: false,
    });
    await dataSource.initialize();
  }, 30000);

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  it('inspects a migration-derived schema, not one rebuilt from entity metadata', async () => {
    // Specs using `dropSchema: true` rebuild the schema from entities, which
    // drops `typeorm_migrations` and every migration-only object. `setup.ts`'s
    // repairSchemaIfDamaged() is supposed to have restored it before this file
    // runs — if it hasn't, the FK checks below would be validating the wrong
    // schema and quietly passing.
    const rows = await dataSource.query(`SELECT to_regclass('public.typeorm_migrations') AS reg`);
    expect(
      rows[0].reg,
      'typeorm_migrations is missing — this spec is inspecting a schema rebuilt from ' +
        'entity metadata, so its FK assertions prove nothing. repairSchemaIfDamaged() ' +
        'in test/setup.ts should have re-migrated before this file ran.',
    ).not.toBe(null);
  });

  it('every table in the schema is either reset or explicitly exempt', async () => {
    const rows: { table_name: string }[] = await dataSource.query(
      `SELECT c.relname AS table_name
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r' AND n.nspname = 'public'`,
    );

    const covered = new Set<string>([
      ...TRANSACTIONAL_TABLES_CHILD_FIRST,
      ...REFERENCE_TABLES_CHILD_FIRST,
      ...Object.keys(INTENTIONALLY_NOT_RESET),
    ]);
    const uncovered = rows.map((r) => r.table_name).filter((t) => !covered.has(t));

    expect(
      uncovered,
      `these tables exist in the schema but no reset touches them: ${uncovered.join(', ')}. ` +
        'Rows will leak between tests. Add each to TRANSACTIONAL_TABLES_CHILD_FIRST (child-first) ' +
        'in test/reset-order.ts, or to INTENTIONALLY_NOT_RESET here with a reason.',
    ).toHaveLength(0);
  });

  it('every listed table still exists in the schema', async () => {
    for (const table of [...TRANSACTIONAL_TABLES_CHILD_FIRST, ...REFERENCE_TABLES_CHILD_FIRST]) {
      const rows = await dataSource.query('SELECT to_regclass($1) AS reg', [`"${table}"`]);
      expect(rows[0].reg, `table "${table}" no longer exists — update reset-order.ts`).not.toBe(
        null,
      );
    }
  });

  it('no foreign key edge points from an earlier table to a later one', async () => {
    // Checked over both lists concatenated, in the order the resets actually
    // run: buildResetSql()'s transactional tables first, then
    // buildReferenceResetSql()'s reference tables. That covers edges within
    // each list *and* edges that cross between them (e.g. students → schools).
    const tableList = [...TRANSACTIONAL_TABLES_CHILD_FIRST, ...REFERENCE_TABLES_CHILD_FIRST];
    const indexOf = new Map(tableList.map((t, i) => [t, i]));

    const edges: { child: string; parent: string }[] = await dataSource.query(
      `SELECT c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent
       FROM pg_constraint c
       WHERE c.contype = 'f'
         AND c.conrelid::regclass::text = ANY($1)
         AND c.confrelid::regclass::text = ANY($1)`,
      [tableList],
    );

    const violations = edges.filter(({ child, parent }) => {
      // A self-referential FK (e.g. a parent_id pointing at the same table) is
      // always fine: `DELETE FROM t` removes every row in one statement and
      // the constraint is only checked at statement end. It can never be
      // "ordered before itself", so don't report it as a violation.
      if (child === parent) return false;

      const childIndex = indexOf.get(child);
      const parentIndex = indexOf.get(parent);
      // Both are guaranteed present — the query filtered to tableList — but
      // guard defensively rather than crash with a confusing TypeError.
      if (childIndex === undefined || parentIndex === undefined) return true;
      // Child-first: the child (the table holding the FK) must be deleted
      // strictly before the parent it references.
      return childIndex >= parentIndex;
    });

    expect(
      violations,
      violations
        .map(
          (v) =>
            `"${v.child}" (index ${indexOf.get(v.child)}) has a foreign key to ` +
            `"${v.parent}" (index ${indexOf.get(v.parent)}) but is not ordered before it ` +
            `in the reset order — move "${v.child}" earlier in test/reset-order.ts`,
        )
        .join('\n'),
    ).toHaveLength(0);
  });
});

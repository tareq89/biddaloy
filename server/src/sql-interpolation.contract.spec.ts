import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Contract test [75.15]: no `${...}` inside a template literal that is passed
 * straight to a query method (`.query(`, `.where(`, `.andWhere(`, `.orderBy(`,
 * `.leftJoin(` ...), unless the file's count is on the reviewed list below.
 *
 * Why: a `${userInput}` in SQL is injection. User values must be bound as
 * `:param` (query builder) or `$n` (raw `.query`).
 *
 * Fixing a failure:
 *   - value comes from a request  -> bind it as a :param / $n. Never allowlist it.
 *   - value is a code constant / whitelisted identifier -> add or raise the entry
 *     in REVIEWED_INTERPOLATIONS with a one-line reason.
 *
 * What it does NOT catch: SQL built into a variable first
 * (`const sql = \`...${x}...\`; qb.query(sql)`).
 * ponytail: direct-argument guard only; a lint rule or SQL tag function if
 * string-built SQL keeps slipping through.
 *
 * Skips `*.spec.ts`, `*.e2e-spec.ts` and `src/migrations/**` (fixed DDL text).
 */
const QUERY_INTERPOLATION =
  /\.(query|where|andWhere|orWhere|having|andHaving|orderBy|addOrderBy|select|addSelect|innerJoin|leftJoin|innerJoinAndSelect|leftJoinAndSelect|from|groupBy|addGroupBy)\(\s*`[^`]*\$\{/g;

/** Hits per file (path relative to server/src), each audited 2026-10-13: none
 * interpolates request input. Verified safe unless marked UNSAFE. */
const REVIEWED_INTERPOLATIONS: Record<string, number> = {
  // table/column are code constants (documented "constants only" in the helper's JSDoc)
  'common/utils/next-serial.util.ts': 1,
  // SCHOOL_TZ / STALE_DAYS constants
  'modules/applications/application-reports.service.ts': 3,
  // SCHOOL_TZ constant, createdOn built from it, serialClause with :params, IN (:...linked) toggle
  'modules/applications/applications.service.ts': 4,
  // ITEM_COLS / ITEM_FROM / BY_SEVERITY constants; `where` built from $n placeholders
  'modules/attention/api/attention-query.service.ts': 6,
  // `where` joined from fixed fragments whose values are bound as $n (params.push)
  'modules/attention/report/alerts-report.service.ts': 3,
  // priorYearStartSql('$1') helper plus a constant ternary fragment
  'modules/attention/rules/exams/exams-marks-overdue.rule.ts': 1,
  // `dueSql` constant
  'modules/attention/rules/family/family-data.ts': 1,
  // constant scoped / unscoped fragment; ids bound as $4 array
  'modules/calendar/calendar-events.service.ts': 1,
  // constant classScopeExists / noClassScope fragments
  'modules/calendar/calendar-visibility.util.ts': 3,
  // scoped() returns constant fragments
  'modules/calendar/school-calendar.service.ts': 2,
  // `column` typed 'class_id' | 'section_id' (countLiveEnrollments)
  'modules/classes/classes.service.ts': 1,
  // BN_COLLATION constant
  'modules/communications/reminders.service.ts': 1,
  // `k` is a key of Partial<StudentFee> built by internal callers (lockBills); values bound as :v<i>
  'modules/fees/fee-generation-batch.service.ts': 1,
  // BN_COLLATION constant
  'modules/fees/fees.service.ts': 1,
  // ternary between two constant column lists
  'modules/print/exam-documents/exam-documents.service.ts': 1,
  // constant SQL fragments (ID_CARD_WAITING, ROW_SELECT, ROW_FROM, REGISTER_SELECT); values as $n
  'modules/print/jobs/print-history.service.ts': 12,
  // `column` is `list === 'shifts' ? 'shift' : 'version'`
  'modules/schools/schools.service.ts': 2,
  // BN_COLLATION constant
  'modules/students/students.service.ts': 2,
  // BN_COLLATION, NOT_SWAPPED_SQL constants
  'modules/users/users.service.ts': 2,
  // dev seed: demoSchools slug list, not request input
  'scripts/seed.ts': 2,
};

const SRC_DIR = __dirname;

function collectFiles(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const fullPath = join(dir, name);
    if (statSync(fullPath).isDirectory()) {
      if (relative(SRC_DIR, fullPath) === 'migrations') continue;
      files.push(...collectFiles(fullPath));
    } else if (
      name.endsWith('.ts') &&
      !name.endsWith('.spec.ts') &&
      !name.endsWith('.e2e-spec.ts')
    ) {
      files.push(fullPath);
    }
  }
  return files;
}

function countHits(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const file of collectFiles(SRC_DIR)) {
    const n = (readFileSync(file, 'utf8').match(QUERY_INTERPOLATION) ?? []).length;
    if (n > 0) counts[relative(SRC_DIR, file)] = n;
  }
  return counts;
}

describe('SQL interpolation guard', () => {
  it('no file has more template-literal interpolations in SQL than reviewed', () => {
    const over = Object.entries(countHits())
      .filter(([file, n]) => n > (REVIEWED_INTERPOLATIONS[file] ?? 0))
      .map(([file, n]) => `${file}: ${n} found, ${REVIEWED_INTERPOLATIONS[file] ?? 0} reviewed`);
    expect(
      over,
      'bind the value as a :param / $n, or, if it is a code constant, add a reviewed entry with a reason',
    ).toEqual([]);
  });

  it('no reviewed entry is stale', () => {
    const hits = countHits();
    const stale = Object.entries(REVIEWED_INTERPOLATIONS)
      .filter(([file, n]) => (hits[file] ?? 0) < n)
      .map(
        ([file, n]) =>
          `${file}: ${hits[file] ?? 0} found, ${n} reviewed - lower or remove the entry`,
      );
    expect(stale).toEqual([]);
  });
});

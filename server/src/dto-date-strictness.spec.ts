import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * [2608, D19'] A ratchet against new bare `@IsDateString()` in DTOs. Bare
 * `@IsDateString()` accepts `2018-02-30`, which Postgres then rejects (500) or
 * rolls over silently. New date fields use `IsRealDate` / `IsPlausibleBirthDate`
 * (common/decorators/is-real-date.decorator.ts) or `@IsDateString({ strict: true })`.
 *
 * The existing uses are counted per file and allowlisted; a file may not gain
 * one. The numbers only go down: when a file is fixed, lower or delete its entry.
 */
const LEGACY_BARE_DATE_STRINGS = new Map<string, { count: number; reason: string }>([
  ['modules/academics/dto/create-academic-year.dto.ts', { count: 2, reason: 'legacy, not swept' }],
  ['modules/academics/dto/update-academic-year.dto.ts', { count: 2, reason: 'legacy, not swept' }],
  ['modules/admission/dto/create-intake.dto.ts', { count: 2, reason: 'legacy, not swept' }],
  ['modules/attendance/dto/device.dto.ts', { count: 1, reason: 'legacy, not swept' }],
  ['modules/audit/dto/audit-log.dto.ts', { count: 2, reason: 'query filter' }],
  ['modules/calendar/dto/academic-terms.dto.ts', { count: 4, reason: 'legacy, not swept' }],
  ['modules/calendar/dto/calendar-events.dto.ts', { count: 4, reason: 'legacy, not swept' }],
  ['modules/calendar/dto/public-holidays.dto.ts', { count: 2, reason: 'legacy, not swept' }],
  [
    'modules/communications/dto/reminders.dto.ts',
    { count: 2, reason: 'query filter / legacy, not swept' },
  ],
  ['modules/fees/dto/checkout.dto.ts', { count: 1, reason: 'legacy, not swept' }],
  ['modules/fees/dto/discount-rules.dto.ts', { count: 4, reason: 'legacy, not swept' }],
  ['modules/fees/dto/fee-generations.dto.ts', { count: 3, reason: 'legacy, not swept' }],
  ['modules/fees/dto/fees.dto.ts', { count: 5, reason: 'legacy, not swept' }],
  ['modules/fees/dto/recurring-schedules.dto.ts', { count: 4, reason: 'legacy, not swept' }],
  ['modules/fees/fines/dto/fines.dto.ts', { count: 1, reason: 'legacy, not swept' }],
  ['modules/homework/dto/homework-bulk-upload.dto.ts', { count: 2, reason: 'legacy, not swept' }],
  ['modules/homework/dto/homework.dto.ts', { count: 2, reason: 'legacy, not swept' }],
  ['modules/programs/dto/program-enrollments.dto.ts', { count: 3, reason: 'legacy, not swept' }],
  ['modules/routines/dto/resolve.dto.ts', { count: 2, reason: 'legacy, not swept' }],
  ['modules/routines/dto/routine-slots.dto.ts', { count: 2, reason: 'legacy, not swept' }],
  ['modules/routines/dto/substitution.dto.ts', { count: 3, reason: 'legacy, not swept' }],
  ['modules/staff-hr/dto/repeatable-row.dto.ts', { count: 5, reason: 'legacy, not swept' }],
  ['modules/staff-hr/dto/staff-hr-record.dto.ts', { count: 3, reason: 'legacy, not swept' }],
  [
    'modules/students/dto/students.dto.ts',
    { count: 4, reason: 'date_of_birth_from / date_of_birth_to query filters (D19)' },
  ],
  ['modules/surveys/dto/survey.dto.ts', { count: 4, reason: 'legacy, not swept' }],
  ['modules/users/dto/users.dto.ts', { count: 4, reason: 'legacy, not swept' }],
]);

const MODULES_DIR = join(__dirname, 'modules');
const BARE_RE = /@IsDateString\(([^)]*)\)/g;

function dtoFiles(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) files.push(...dtoFiles(full));
    else if (name.includes('dto') && name.endsWith('.ts') && !name.endsWith('.spec.ts')) {
      files.push(full);
    }
  }
  return files;
}

/** Bare `@IsDateString` count per file (calls without `strict: true`), comments ignored. */
function bareCounts(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const file of dtoFiles(MODULES_DIR)) {
    const text = readFileSync(file, 'utf8');
    let n = 0;
    for (const m of text.matchAll(BARE_RE)) {
      const lineStart = text.lastIndexOf('\n', m.index) + 1;
      if (/^\s*(\*|\/\/|\/\*)/.test(text.slice(lineStart, m.index! + 1))) continue;
      if (!/strict:\s*true/.test(m[1])) n++;
    }
    if (n > 0) counts.set(relative(__dirname, file), n);
  }
  return counts;
}

describe('bare @IsDateString ratchet', () => {
  it('no DTO file gains a bare @IsDateString() beyond its allowlisted count', () => {
    const over = [...bareCounts()]
      .filter(([file, n]) => n > (LEGACY_BARE_DATE_STRINGS.get(file)?.count ?? 0))
      .map(
        ([file, n]) => `${file}: ${n} (allowed ${LEGACY_BARE_DATE_STRINGS.get(file)?.count ?? 0})`,
      );
    expect(
      over,
      'use IsRealDate / IsPlausibleBirthDate or @IsDateString({ strict: true }) for a new date field',
    ).toEqual([]);
  });

  it('every allowlist entry still matches its exact count', () => {
    const counts = bareCounts();
    const stale = [...LEGACY_BARE_DATE_STRINGS]
      .filter(([file, { count }]) => (counts.get(file) ?? 0) !== count)
      .map(([file, { count }]) => `${file}: allowlisted ${count}, found ${counts.get(file) ?? 0}`);
    expect(stale, 'lower or delete allowlist entries for files that were fixed').toEqual([]);
  });
});

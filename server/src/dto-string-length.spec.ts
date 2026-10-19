import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync, statSync } from 'fs';
import { join, relative, sep } from 'path';
import { getMetadataArgsStorage } from 'typeorm';
import { getMetadataStorage } from 'class-validator';

/**
 * [2608] A write-DTO string backed by a `varchar(N)` column must carry
 * `@MaxLength(<=N)`, or an over-long value reaches Postgres and comes back as a
 * 500 with database text ("value too long for type character varying(100)").
 *
 * Pairing: a DTO property and an entity column match when they sit in the same
 * module directory and share a property name. When a module has several
 * entities with that property name, the widest column wins (fewer false
 * positives; a narrower mismatch is then caught by review).
 * ponytail: name-based pairing, not a real DTO -> entity link; the allowlist
 * below absorbs the false positives.
 *
 * `Query*` DTOs are filters, not writes, and are skipped.
 */

/** `<module>/<ClassName>.<field>` -> reason it is not a varchar-backed write field. */
const ALLOWLIST = new Map<string, string>([
  ['students/CreateStudentDto.phone', 'no such column on the student entity'],
  ['admission/SubmitApplicantDto.gender', 'bounded by @IsIn([MALE, FEMALE, OTHER])'],
  [
    'calendar/FetchHolidaySetDto.country',
    'name collision: not stored in the matching varchar column',
  ],
  [
    'fees/WaiveFineDto.reason',
    'name collision with recurring-schedule-exclusion.reason; DTO has @MaxLength(280)',
  ],
  [
    'fees/WalletPayoutDto.reason',
    'name collision with recurring-schedule-exclusion.reason; DTO has @MaxLength(500)',
  ],
]);

const MODULES_DIR = join(__dirname, 'modules');

function walk(dir: string, keep: (name: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full, keep);
    return keep(name) ? [full] : [];
  });
}

/** `<module>` is the first directory under src/modules. */
const moduleOf = (file: string) => relative(MODULES_DIR, file).split(sep)[0];

/** [file, module exports] for every entity / DTO file, loaded once. */
let entityFiles: [string, object][] = [];
let dtoFiles: [string, object][] = [];

beforeAll(async () => {
  const load = (files: string[]) =>
    Promise.all(files.map(async (f) => [f, (await import(f)) as object] as [string, object]));
  entityFiles = await load(walk(MODULES_DIR, (n) => n.endsWith('.entity.ts')));
  dtoFiles = await load(
    walk(MODULES_DIR, (n) => n.includes('dto') && n.endsWith('.ts') && !n.endsWith('.spec.ts')),
  );
}, 120_000);

/** `<module>/<property>` -> widest varchar length among that module's entities. */
function columnLengths(): Map<string, number> {
  const classModule = new Map<unknown, string>();
  for (const [path, exports] of entityFiles) {
    for (const value of Object.values(exports as object)) {
      if (typeof value === 'function') classModule.set(value, moduleOf(path));
    }
  }
  const lengths = new Map<string, number>();
  for (const col of getMetadataArgsStorage().columns) {
    const module = classModule.get(col.target);
    const length = Number((col.options as { length?: number | string }).length);
    if (!module || !Number.isFinite(length) || length <= 0) continue;
    const key = `${module}/${col.propertyName}`;
    lengths.set(key, Math.max(lengths.get(key) ?? 0, length));
  }
  return lengths;
}

/** Every `<module>/<Class>.<field>` whose DTO string has no `@MaxLength`/`@Length` within the column. */
function offenders(): string[] {
  const columns = columnLengths();
  const validation = getMetadataStorage();
  const found: string[] = [];
  for (const [path, exports] of dtoFiles) {
    const module = moduleOf(path);
    for (const [name, cls] of Object.entries(exports as Record<string, unknown>)) {
      if (typeof cls !== 'function' || name.startsWith('Query')) continue;
      const metas = validation.getTargetValidationMetadatas(
        cls as never,
        null as never,
        false,
        false,
      );
      const byProp = new Map<string, typeof metas>();
      for (const m of metas) byProp.set(m.propertyName, [...(byProp.get(m.propertyName) ?? []), m]);
      for (const [prop, propMetas] of byProp) {
        const column = columns.get(`${module}/${prop}`);
        if (!column || !propMetas.some((m) => m.name === 'isString')) continue;
        const capped = propMetas.some((m) => {
          if (m.name !== 'maxLength' && m.name !== 'isLength') return false;
          const max = m.name === 'maxLength' ? m.constraints?.[0] : m.constraints?.[1];
          return typeof max === 'number' && max <= column;
        });
        if (!capped) found.push(`${module}/${name}.${prop}`);
      }
    }
  }
  return found.sort();
}

describe('DTO string length vs varchar columns', () => {
  it('every write-DTO string backed by varchar(N) has @MaxLength(<=N), or is allowlisted', () => {
    const bad = offenders().filter((k) => !ALLOWLIST.has(k));
    expect(bad, 'add @MaxLength(N) after @IsString(), or a reviewed ALLOWLIST entry').toEqual([]);
  });

  it('every allowlist entry is still an offender', () => {
    const current = new Set(offenders());
    const stale = [...ALLOWLIST.keys()].filter((k) => !current.has(k));
    expect(stale, 'remove allowlist entries that are now capped or gone').toEqual([]);
  });
});

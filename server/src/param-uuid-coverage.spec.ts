import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * [75.13-b] Every `@Param('name')` in a controller must carry `ParseUUIDPipe`
 * so a malformed id gets 400 instead of reaching Postgres as a 500. Any other
 * pipe does not count. The params below are real non-UUID values and are the
 * only reviewed exceptions. Keys are `<path under src>:<param name>`; a bare
 * `@Param()` (the whole params object) has the name `(all)`.
 */
const NON_UUID_PARAMS = new Set([
  'modules/admission/public-admission.controller.ts:slug', // school slug
  'modules/auth/social/social-auth.controller.ts:provider', // google / facebook
  'modules/calendar/calendar-feed.controller.ts:token', // opaque feed token
  'modules/invoices/public-invoice.controller.ts:token', // share-link token
  'modules/print/verify/public-verify.controller.ts:token', // verify token
  'modules/presets/presets.controller.ts:id', // preset key such as bd/nctb
  'modules/print/templates/print-templates.controller.ts:key', // artwork key
  'modules/print/templates/print-templates.controller.ts:side', // artwork side name
  'modules/staff-hr/staff-document.controller.ts:documentType', // document type name
  'modules/audit/audit.controller.ts:entityType', // Student, Payment, ...
  'modules/leave/leave.controller.ts:type', // LeaveType, ParseEnumPipe
  'modules/admission/applicant-review.controller.ts:type', // AdmissionDocumentType, ParseEnumPipe
]);

const SRC_DIR = __dirname;
// `\s*` and `[^)]*` span newlines, so a call spread over several lines matches.
const PARAM_RE = /@Param\(\s*(?:['"](\w+)['"])?([^)]*)\)/g;

function collectControllers(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const fullPath = join(dir, name);
    if (statSync(fullPath).isDirectory()) {
      files.push(...collectControllers(fullPath));
    } else if (name.endsWith('.controller.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

/** Every `@Param(...)` call outside comments: where it is and whether it has ParseUUIDPipe. */
function collectParams() {
  const found: { key: string; where: string; piped: boolean }[] = [];
  for (const file of collectControllers(SRC_DIR)) {
    const rel = relative(SRC_DIR, file);
    const text = readFileSync(file, 'utf8');
    const lines = text.split('\n');
    for (const m of text.matchAll(PARAM_RE)) {
      const line = text.slice(0, m.index).split('\n').length;
      if (/^\s*(\*|\/\/|\/\*)/.test(lines[line - 1])) continue; // doc comment or line comment
      const name = m[1] ?? '(all)';
      found.push({
        key: `${rel}:${name}`,
        where: `${rel}:${line} ${name}`,
        piped: /\bParseUUIDPipe\b/.test(m[2]),
      });
    }
  }
  return found;
}

describe('param UUID coverage', () => {
  it('every @Param is piped or allowlisted', () => {
    const offenders = collectParams()
      .filter((p) => !p.piped && !NON_UUID_PARAMS.has(p.key))
      .map((p) => p.where);
    // Fix: add ParseUUIDPipe, or add a reviewed NON_UUID_PARAMS entry.
    expect(offenders, 'add ParseUUIDPipe, or add a reviewed NON_UUID_PARAMS entry').toEqual([]);
  });

  it('every allowlist entry still exists', () => {
    const unpiped = new Set(
      collectParams()
        .filter((p) => !p.piped)
        .map((p) => p.key),
    );
    const stale = [...NON_UUID_PARAMS].filter((k) => !unpiped.has(k));
    expect(stale, 'remove allowlist entries whose param is gone or now piped').toEqual([]);
  });
});

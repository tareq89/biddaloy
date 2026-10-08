import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  DocumentKind,
  FIELD_CATALOG,
  boundIssueFields,
  fillPlaceholders,
  textPlaceholders,
  validateTemplateDefinition,
} from '@biddaloy/shared';
import type { PrintElement } from '@biddaloy/shared';
import {
  LINE_MM,
  MM_PER_CHAR,
  STUDENT_CERTIFICATE_SUGGESTIONS as ALL,
} from './student-certificate.suggestions';
import { ARTWORK_DIR } from './suggestions';

const KINDS = [
  DocumentKind.TRANSFER_CERTIFICATE,
  DocumentKind.TESTIMONIAL,
  DocumentKind.CHARACTER_CERTIFICATE,
  DocumentKind.STUDY_CERTIFICATE,
  DocumentKind.PARTICIPATION_CERTIFICATE,
];
const ISSUE_FIELDS: Record<string, string[]> = {
  [DocumentKind.TRANSFER_CERTIFICATE]: ['issue.conduct', 'issue.remark'],
  [DocumentKind.TESTIMONIAL]: ['issue.conduct'],
  [DocumentKind.CHARACTER_CERTIFICATE]: ['issue.conduct', 'issue.remark'],
  [DocumentKind.STUDY_CERTIFICATE]: ['issue.remark'],
  [DocumentKind.PARTICIPATION_CERTIFICATE]: ['issue.event_name', 'issue.event_date'],
};

type S = (typeof ALL)[number];
const els = (s: S): PrintElement[] => s.definition.front.elements;
const keysOf = (s: S) =>
  els(s).flatMap((e) =>
    e.type === 'TEXT' ? [...(e.field ? [e.field] : []), ...textPlaceholders(e.text ?? '')] : [],
  );
const lang = (s: S) => (s.key.endsWith('-bn') ? 'bn' : 'en');
const bodies = (s: S) => els(s).filter((e) => e.type === 'TEXT' && e.overflow === 'WRAP');
const each = ALL.map((s) => [s.key, s] as const);

describe('STUDENT_CERTIFICATE_SUGGESTIONS', () => {
  it('has 10 entries with unique keys, one bn and one en per kind', () => {
    expect(ALL).toHaveLength(10);
    expect(new Set(ALL.map((s) => s.key)).size).toBe(10);
    for (const k of KINDS) {
      expect(
        ALL.filter((s) => s.documentKind === k)
          .map(lang)
          .sort(),
      ).toEqual(['bn', 'en']);
    }
  });

  it.each(each)('%s validates and its artwork exists', (_k, s) => {
    expect(validateTemplateDefinition(s.definition, s.documentKind).success).toBe(true);
    expect(existsSync(join(ARTWORK_DIR, s.artwork.front))).toBe(true);
    expect(s.orientation).toBe('portrait');
    expect(s.nameKey).toBe(`print.suggestion.${s.key.replace(/-/g, '_')}`);
  });

  it.each(each)('%s prints serial, issue date, verify QR and the DUPLICATE label', (_k, s) => {
    const keys = keysOf(s);
    expect(keys).toContain('print.serial_no');
    expect(keys).toContain('print.issue_date');
    expect(keys).toContain('print.copyLabel');
    expect(els(s).some((e) => e.type === 'QR')).toBe(true);
    expect(s.definition.copyLabel).toEqual({ text: 'প্রতিলিপি / DUPLICATE (copy {n})' });
  });

  it.each(each)('%s asks for exactly its issue-time fields (D3)', (_k, s) => {
    expect(boundIssueFields(s.definition, s.documentKind).map((f) => f.key)).toEqual(
      ISSUE_FIELDS[s.documentKind],
    );
  });

  it('the TC places leaving.date, leaving.reason, leaving.destination as placeholders (D4)', () => {
    for (const s of ALL.filter((x) => x.documentKind === DocumentKind.TRANSFER_CERTIFICATE)) {
      expect(keysOf(s)).toEqual(
        expect.arrayContaining(['leaving.date', 'leaving.reason', 'leaving.destination']),
      );
    }
  });

  it.each(each)('%s has a WRAP sentence body naming the student (D43)', (_k, s) => {
    const name = lang(s) === 'bn' ? '{{student.name_bn}}' : '{{student.name}}';
    expect(bodies(s).some((e) => e.type === 'TEXT' && e.text?.includes(name))).toBe(true);
  });

  it.each(each)('%s keeps room for the longest samples, inside the page', (_k, s) => {
    const catalog = FIELD_CATALOG[s.documentKind];
    for (const e of bodies(s)) {
      if (e.type !== 'TEXT') continue;
      const filled = fillPlaceholders(e.text ?? '', (k) => {
        const f = catalog.find((c) => c.key === k);
        return f?.longestSample ?? f?.sample ?? '';
      });
      expect(e.h).toBeGreaterThanOrEqual(Math.ceil((filled.length * MM_PER_CHAR) / e.w) * LINE_MM);
      expect(e.y + e.h).toBeLessThanOrEqual(254);
    }
    expect(els(s).length).toBeLessThanOrEqual(200);
  });
});

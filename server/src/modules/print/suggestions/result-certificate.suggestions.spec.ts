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
  RESULT_CERTIFICATE_SUGGESTIONS as ALL,
} from './result-certificate.suggestions';
import { ARTWORK_DIR } from './suggestions';

type S = (typeof ALL)[number];
const els = (s: S): PrintElement[] => s.definition.front.elements;
const textOf = (e: PrintElement) => (e.type === 'TEXT' ? (e.text ?? '') : '');
const keysOf = (s: S) =>
  els(s).flatMap((e) =>
    e.type === 'TEXT' ? [...(e.field ? [e.field] : []), ...textPlaceholders(e.text ?? '')] : [],
  );
const lang = (s: S) => (s.key.endsWith('-bn') ? 'bn' : 'en');
const bodies = (s: S) => els(s).filter((e) => e.type === 'TEXT' && e.overflow === 'WRAP');
const each = ALL.map((s) => [s.key, s] as const);
const merit = ALL.filter((s) => s.documentKind === DocumentKind.MERIT_CERTIFICATE);

describe('RESULT_CERTIFICATE_SUGGESTIONS', () => {
  it('has 4 entries with unique keys', () => {
    expect(ALL.map((s) => s.key).sort()).toEqual([
      'merit-a4-bn',
      'merit-a4-en',
      'result-a4-bn',
      'result-a4-en',
    ]);
  });

  it.each(each)('%s validates and its landscape artwork exists', (_k, s) => {
    expect(validateTemplateDefinition(s.definition, s.documentKind).success).toBe(true);
    expect(existsSync(join(ARTWORK_DIR, s.artwork.front))).toBe(true);
    expect(s.orientation).toBe('landscape');
    expect(s.definition.page).toEqual({ widthMm: 297, heightMm: 210, sides: ['front'] });
    expect(s.nameKey).toBe(`print.suggestion.${s.key.replace(/-/g, '_')}`);
    expect(s.definition.copyLabel).toEqual({ text: 'প্রতিলিপি / DUPLICATE (copy {n})' });
  });

  it.each(each)('%s prints serial, QR, exam and GPA', (_k, s) => {
    const keys = keysOf(s);
    for (const k of ['print.serial_no', 'exam.name', 'result.gpa', 'print.copyLabel']) {
      expect(keys).toContain(k);
    }
    // the QR element carries no field; print.verify_qr is what the catalog resolves it to
    expect(els(s).some((e) => e.type === 'QR')).toBe(true);
    expect(FIELD_CATALOG[s.documentKind].some((f) => f.key === 'print.verify_qr')).toBe(true);
  });

  it.each(each)('%s asks for no issue-time fields', (_k, s) => {
    expect(boundIssueFields(s.definition, s.documentKind)).toEqual([]);
  });

  it.each(each)('%s has a WRAP sentence naming the student (D43)', (_k, s) => {
    const name = lang(s) === 'bn' ? '{{student.name_bn}}' : '{{student.name}}';
    expect(bodies(s).some((e) => textOf(e).includes(name))).toBe(true);
  });

  it.each(merit.map((s) => [s.key, s] as const))(
    '%s binds position and puts section position on its own line (D29)',
    (_k, s) => {
      const keys = keysOf(s);
      expect(keys).toContain('result.position');
      expect(keys).toContain('result.section_position');
      const holders = els(s).filter((e) => textOf(e).includes('{{result.section_position}}'));
      expect(holders).toHaveLength(1);
      expect(textOf(holders[0])).not.toContain('{{student.');
    },
  );

  it.each(each)('%s keeps room for the longest samples, inside the page', (_k, s) => {
    const catalog = FIELD_CATALOG[s.documentKind];
    for (const e of bodies(s)) {
      if (e.type !== 'TEXT') continue;
      const filled = fillPlaceholders(e.text ?? '', (k) => {
        const f = catalog.find((c) => c.key === k);
        return f?.longestSample ?? f?.sample ?? '';
      });
      expect(e.h).toBeGreaterThanOrEqual(Math.ceil((filled.length * MM_PER_CHAR) / e.w) * LINE_MM);
      expect(e.y + e.h).toBeLessThanOrEqual(158);
    }
  });
});

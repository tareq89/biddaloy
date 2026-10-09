import { describe, expect, it } from 'vitest';

import { CR80, DocumentKind } from '../enums/print';
import {
  boundIssueFields,
  fillPlaceholders,
  PLACEHOLDER_PATTERN,
  textPlaceholders,
  validateIssueValues,
  validateTemplateDefinition,
} from './template-definition';

const UUID = '3f2b8c1e-5d4a-4b6f-8a9c-1d2e3f4a5b6c';

const text = (over: Record<string, unknown> = {}) => ({
  id: 't1',
  type: 'TEXT',
  x: 5,
  y: 5,
  w: 40,
  h: 8,
  field: 'student.name',
  fontFamily: 'Noto Sans Bengali',
  sizePt: 10,
  weight: 600,
  color: '#112233',
  align: 'left',
  overflow: 'SHRINK',
  ...over,
});

const image = (over: Record<string, unknown> = {}) => ({
  id: 'i1',
  type: 'IMAGE',
  x: 5,
  y: 15,
  w: 20,
  h: 25,
  field: 'student.photo',
  fit: 'COVER',
  alignY: 'top',
  ...over,
});

const def = (front: unknown[] = [text(), image()]) => ({
  page: { ...CR80, sides: ['front', 'back'] },
  copyLabel: { text: 'Copy {n}' },
  front: { background: { assetId: UUID, print: false }, elements: front },
  back: { elements: [{ id: 'q', type: 'QR', x: 30, y: 10, w: 25, h: 25 }] },
});

const check = (d: unknown) => validateTemplateDefinition(d, DocumentKind.STUDENT_ID_CARD);

describe('validateTemplateDefinition', () => {
  it('accepts a valid two-sided CR80 definition', () => {
    expect(check(def()).success).toBe(true);
  });

  it('rejects an element outside the page', () => {
    expect(check(def([text({ x: 60, w: 40 })])).success).toBe(false);
  });

  it('rejects a TEXT element with both text and field', () => {
    expect(check(def([text({ text: 'hi' })])).success).toBe(false);
  });

  it('rejects a bad colour', () => {
    expect(check(def([text({ color: 'red' })])).success).toBe(false);
  });

  it('rejects sizePt out of range', () => {
    expect(check(def([text({ sizePt: 2 })])).success).toBe(false);
    expect(check(def([text({ sizePt: 100 })])).success).toBe(false);
  });

  it('rejects a field missing from the catalog', () => {
    expect(check(def([text({ field: 'student.nope' })])).success).toBe(false);
  });

  it('rejects an IMAGE field pointing at a text-type field', () => {
    expect(check(def([image({ field: 'student.name' })])).success).toBe(false);
  });

  it('rejects a staff field on a student card', () => {
    expect(check(def([text({ field: 'staff.name' })])).success).toBe(false);
  });

  it('rejects sides with back but no back side', () => {
    const d = def();
    delete (d as { back?: unknown }).back;
    expect(check(d).success).toBe(false);
  });
});

describe('placeholders and issue fields [48.1.01] D43', () => {
  const cert = (kind: DocumentKind, front: unknown[], back: unknown[] = []) =>
    validateTemplateDefinition(
      {
        page: { widthMm: 210, heightMm: 297, sides: ['front', 'back'] },
        front: { elements: front },
        back: { elements: back },
      },
      kind,
    );
  const t = (txt: string) => text({ field: undefined, text: txt, w: 100 });
  const TC = DocumentKind.TRANSFER_CERTIFICATE;

  it('parses and fills', () => {
    expect(textPlaceholders('{{a.b}} x {{ a.b }} {{c}}')).toEqual(['a.b', 'c']);
    const lookup = (k: string) => ({ a: 'A' })[k] ?? '';
    expect(fillPlaceholders('{{a}} {{zz}} Copy {n}', lookup)).toBe('A  Copy {n}');
  });

  it('accepts text fields of the kind', () => {
    const r = cert(TC, [t('{{student.name_bn}} to {{leaving.destination}}')]);
    expect(r.success).toBe(true);
  });

  it('refuses keys that are not text fields of the kind', () => {
    for (const k of ['exam.sitting.1.subject', 'student.photo', 'print.verify_qr']) {
      const r = cert(TC, [t(`x {{${k}}}`)]);
      expect(r.success).toBe(false);
      if (!r.success) expect(r.errors[0]).toContain(`{{${k}}}`);
    }
  });

  it('refuses a 2001-character text', () => {
    expect(cert(TC, [t('x'.repeat(2001))]).success).toBe(false);
  });

  it('grandfathers a stored text the new rules refuse, until it is edited', () => {
    const stored = {
      page: { widthMm: 210, heightMm: 297, sides: ['front'] },
      front: { elements: [t('{{old.key}} ' + 'x'.repeat(2001))] },
    };
    const moved = { ...stored, front: { elements: [{ ...stored.front.elements[0], x: 1 }] } };
    expect(validateTemplateDefinition(moved, TC).success).toBe(false);
    expect(validateTemplateDefinition(moved, TC, stored).success).toBe(true);
    const edited = { ...stored, front: { elements: [t('{{old.key}}')] } };
    expect(validateTemplateDefinition(edited, TC, stored).success).toBe(false);
  });

  it('does not grandfather a second element that reuses a stored id', () => {
    const legacy = t('{{old.key}}');
    const stored = {
      page: { widthMm: 210, heightMm: 297, sides: ['front'] },
      front: { elements: [legacy] },
    };
    const dup = { ...stored, front: { elements: [legacy, { ...legacy, y: 50 }] } };
    expect(validateTemplateDefinition(dup, TC, stored).success).toBe(false);
  });

  it('keeps PLACEHOLDER_PATTERN stateless for .test()', () => {
    expect(PLACEHOLDER_PATTERN.test('{{a}}')).toBe(true);
    expect(PLACEHOLDER_PATTERN.test('{{a}}')).toBe(true);
  });

  it('refuses an admit-card field in a transfer certificate', () => {
    expect(cert(TC, [text({ field: 'exam.sitting.1.subject' })]).success).toBe(false);
  });

  const parse = (front: unknown[], back: unknown[] = []) => {
    const r = cert(DocumentKind.TESTIMONIAL, front, back);
    if (!r.success) throw new Error(r.errors.join());
    return r.data;
  };
  const K = DocumentKind.TESTIMONIAL;

  it('finds bound issue fields on either side, as field or placeholder', () => {
    const keys = (d: ReturnType<typeof parse>) => boundIssueFields(d, K).map((f) => f.key);
    expect(keys(parse([], [text({ field: 'issue.conduct' })]))).toEqual(['issue.conduct']);
    expect(keys(parse([t('conduct: {{issue.conduct}}')]))).toEqual(['issue.conduct']);
    expect(keys(parse([text()]))).toEqual([]);
  });

  it('validates issue values', () => {
    const d = parse([text({ field: 'issue.conduct' })]);
    expect(validateIssueValues(d, K, {})).toHaveLength(1);
    expect(validateIssueValues(d, K, { 'issue.conduct': '   ' })).toHaveLength(1);
    expect(validateIssueValues(d, K, { 'issue.conduct': 'x'.repeat(121) })).toHaveLength(1);
    expect(
      validateIssueValues(d, K, { 'issue.conduct': 'Good', 'issue.event_name': 'x' }),
    ).toHaveLength(1);
    expect(validateIssueValues(d, K, { 'issue.conduct': 'Good' })).toEqual([]);
  });

  it('partial (preview) lets a missing value through but still refuses bad ones', () => {
    const d = parse([text({ field: 'issue.conduct' })]);
    expect(validateIssueValues(d, K, {}, { partial: true })).toEqual([]);
    expect(
      validateIssueValues(d, K, { 'issue.conduct': 'x'.repeat(121) }, { partial: true }),
    ).toHaveLength(1);
    expect(validateIssueValues(d, K, { 'issue.other': 'x' }, { partial: true })).toHaveLength(1);
  });
});

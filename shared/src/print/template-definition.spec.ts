import { describe, expect, it } from 'vitest';

import { CR80, DocumentKind } from '../enums/print';
import { validateTemplateDefinition } from './template-definition';

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

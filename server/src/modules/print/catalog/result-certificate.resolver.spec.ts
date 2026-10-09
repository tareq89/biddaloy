import { describe, it, expect } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { DocumentKind, FIELD_CATALOG } from '@biddaloy/shared';
import { ResultCertificateResolver } from './result-certificate.resolver';

const ctx = { type: 'EXAM' as const, id: 'e1' };
const row = (id: string, o: Record<string, unknown> = {}) => ({
  id,
  full_name: `Stu ${id}`,
  full_name_bn: null,
  registration_number: `R-${id}`,
  roll_number: 4,
  father_name: null,
  mother_name: null,
  birth_reg_no: null,
  dob: null,
  photo_key: null,
  class_name: 'Class 8',
  section_name: 'A',
  total_marks: '812.00',
  gpa: '5.00',
  grade: 'A+',
  position: 1,
  section_position: 1,
  is_fail: false,
  published_at: new Date(),
  ...o,
});
/** Manager answering the exam lookup, the results query, the student check, then the school lookup. */
const mgr = (rows: unknown[]) =>
  ({
    query: async (sql: string, p: any[]) => {
      if (sql.includes('FROM results')) return rows;
      // Every id is a student of this school except 'foreign'.
      if (sql.includes('FROM students WHERE'))
        return (p[1] as string[]).filter((i) => i !== 'foreign').map((id) => ({ id }));
      return [{ id: 'e1', name: 'Half-Yearly', year_name: '2027' }];
    },
    findOne: async () => null,
  }) as any;

const run = (kind: any, rows: unknown[], ids = ['a']) =>
  new ResultCertificateResolver(kind).resolve('t', ids, mgr(rows), undefined, ctx);
const refusal = async (p: Promise<unknown>) => {
  const e: any = await p.catch((x) => x);
  expect(e).toBeInstanceOf(ConflictException);
  return e.getResponse().details;
};

describe('ResultCertificateResolver', () => {
  it('fills values for a published pass', async () => {
    const v = (await run(DocumentKind.RESULT_CERTIFICATE, [row('a')])).get('a')!.values;
    expect(v).toMatchObject({
      'exam.name': 'Half-Yearly',
      'exam.year': '2027',
      'result.gpa': '5.00',
      'result.grade': 'A+',
      'result.total_marks': '812.00',
      'result.position': '1',
      'student.class': 'Class 8',
    });
  });

  it('emits only catalog keys', async () => {
    for (const kind of [DocumentKind.RESULT_CERTIFICATE, DocumentKind.MERIT_CERTIFICATE]) {
      const keys = new Set(FIELD_CATALOG[kind].map((f) => f.key));
      const v = (await run(kind, [row('a')])).get('a')!.values;
      for (const k of Object.keys(v)) expect(keys.has(k)).toBe(true);
    }
  });

  it('refuses a failed result with FAILED', async () => {
    const d = await refusal(run(DocumentKind.RESULT_CERTIFICATE, [row('a', { is_fail: true })]));
    expect(d).toEqual({
      code: 'CERTIFICATE_NOT_ELIGIBLE',
      kind: 'RESULT_CERTIFICATE',
      students: [{ id: 'a', reason: 'FAILED' }],
    });
  });

  it('refuses an unpublished result with NOT_PUBLISHED', async () => {
    for (const kind of [DocumentKind.RESULT_CERTIFICATE, DocumentKind.MERIT_CERTIFICATE]) {
      const d = await refusal(run(kind, [row('a', { published_at: null })]));
      expect(d.students).toEqual([{ id: 'a', reason: 'NOT_PUBLISHED' }]);
    }
  });

  it('merit: position alone is enough', async () => {
    const v = (
      await run(DocumentKind.MERIT_CERTIFICATE, [row('a', { position: 2, section_position: null })])
    ).get('a')!.values;
    expect(v['result.position']).toBe('2');
    expect(v['result.section_position']).toBe('');
  });

  it('merit: section_position alone is enough, position blank', async () => {
    const v = (
      await run(DocumentKind.MERIT_CERTIFICATE, [row('a', { position: null, section_position: 1 })])
    ).get('a')!.values;
    expect(v['result.position']).toBe('');
    expect(v['result.section_position']).toBe('1');
  });

  it('merit: neither rank -> NOT_RANKED', async () => {
    const d = await refusal(
      run(DocumentKind.MERIT_CERTIFICATE, [row('a', { position: null, section_position: null })]),
    );
    expect(d.students).toEqual([{ id: 'a', reason: 'NOT_RANKED' }]);
  });

  it('mixed batch lists only the failing ids', async () => {
    const d = await refusal(
      run(DocumentKind.RESULT_CERTIFICATE, [row('a'), row('b', { is_fail: true })], ['a', 'b']),
    );
    expect(d.students).toEqual([{ id: 'b', reason: 'FAILED' }]);
  });

  it('a student without a result (absent) is refused with NO_RESULT, next to the others', async () => {
    const d = await refusal(
      run(DocumentKind.RESULT_CERTIFICATE, [row('b', { is_fail: true })], ['a', 'b']),
    );
    expect(d.students).toEqual([
      { id: 'a', reason: 'NO_RESULT' },
      { id: 'b', reason: 'FAILED' },
    ]);
  });

  it('an id that is not a student of this school stays absent (the caller 404s)', async () => {
    expect((await run(DocumentKind.RESULT_CERTIFICATE, [], ['foreign'])).size).toBe(0);
  });

  it('falls back to the English name when there is no Bangla name', async () => {
    const v = (await run(DocumentKind.RESULT_CERTIFICATE, [row('a')])).get('a')!.values;
    expect(v['student.name_bn']).toBe('Stu a');
  });

  it('rejects missing context with 400', async () => {
    await expect(
      new ResultCertificateResolver(DocumentKind.RESULT_CERTIFICATE).resolve('t', ['a'], {} as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

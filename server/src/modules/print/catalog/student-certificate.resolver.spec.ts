import { describe, it, expect, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { DocumentKind, FIELD_CATALOG } from '@biddaloy/shared';
import {
  StudentCertificateResolver,
  type StudentCertificateKind,
} from './student-certificate.resolver';

const SCHOOL = {
  id: 't1',
  name: 'Test School',
  name_bn: null,
  address: null,
  phone: null,
  email: null,
  registration_id: '108765',
  logo_key: null,
};

const student = (id: string, status = 'ACTIVE') => ({
  id,
  full_name: `Student ${id}`,
  full_name_bn: null,
  registration_number: `R-${id}`,
  roll_number: 3,
  father_name: 'Father',
  mother_name: 'Mother',
  birth_reg_no: '123',
  dob: '2013-05-05',
  photo_key: null,
  enrollment_status: status,
  class_name: 'Class 8',
  section_name: 'A',
  admission_date: '2020-01-01',
  academic_year: '2026',
});

/** The mock answers each SQL by the table it reads. */
function manager(opts: { students: unknown[]; events?: unknown[]; exams?: unknown[] }) {
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes('FROM students s')) return opts.students;
      if (sql.includes('student_lifecycle_events')) return opts.events ?? [];
      if (sql.includes('student_public_exams')) return opts.exams ?? [];
      return [];
    }),
    findOne: vi.fn().mockResolvedValue(SCHOOL),
  } as any;
}
const run = (kind: StudentCertificateKind, ids: string[], m: any) =>
  new StudentCertificateResolver(kind).resolve('t1', ids, m);

const leave = (id: string, type: string, over = {}) => ({
  student_id: id,
  event_type: type,
  occurred_on: '2026-12-31',
  reason: 'Family relocation',
  destination: 'Ideal School',
  class_name: 'Class 7',
  ...over,
});

async function refusal(p: Promise<unknown>) {
  const e: any = await p.then(
    () => null,
    (x) => x,
  );
  expect(e).toBeInstanceOf(ConflictException);
  return e.getResponse();
}

describe('StudentCertificateResolver', () => {
  it('TC fills leaving.* from the latest transfer event', async () => {
    const m = manager({
      students: [student('s1', 'TRANSFERRED')],
      events: [leave('s1', 'TRANSFERRED_OUT')],
    });
    const v = (await run(DocumentKind.TRANSFER_CERTIFICATE, ['s1'], m)).get('s1')!.values;
    expect(v['leaving.date']).toBe('2026-12-31');
    expect(v['leaving.reason']).toBe('Family relocation');
    expect(v['leaving.destination']).toBe('Ideal School');
    expect(v['leaving.class']).toBe('Class 7');
    expect(v['student.admission_date']).toBe('2020-01-01');
    expect(v['school.eiin']).toBe('108765');
  });

  it('TC is refused when the latest event is READMITTED (D4: readmission cancels)', async () => {
    const m = manager({ students: [student('s1')], events: [leave('s1', 'READMITTED')] });
    const body = await refusal(run(DocumentKind.TRANSFER_CERTIFICATE, ['s1'], m));
    expect(body.details.students).toEqual([{ id: 's1', reason: 'NO_LEAVING_EVENT' }]);
  });

  it('TC with no event is refused, naming the student', async () => {
    const body = await refusal(
      run(DocumentKind.TRANSFER_CERTIFICATE, ['s1'], manager({ students: [student('s1')] })),
    );
    expect(body.details).toMatchObject({
      code: 'CERTIFICATE_NOT_ELIGIBLE',
      kind: 'TRANSFER_CERTIFICATE',
    });
    expect(body.details.students).toEqual([{ id: 's1', reason: 'NO_LEAVING_EVENT' }]);
  });

  it('a batch of 3 with 2 ineligible gives one 409 listing exactly those 2', async () => {
    const m = manager({
      students: [student('a'), student('b'), student('c')],
      events: [leave('b', 'WITHDRAWN')],
    });
    const body = await refusal(run(DocumentKind.TRANSFER_CERTIFICATE, ['a', 'b', 'c'], m));
    expect(body.details.students.map((s: any) => s.id)).toEqual(['a', 'c']);
  });

  it('testimonial for GRADUATED carries the newest public exam', async () => {
    const m = manager({
      students: [student('s1', 'GRADUATED')],
      exams: [
        {
          student_id: 's1',
          exam_type: 'SSC',
          board: 'Dhaka',
          roll_no: '1',
          registration_no: '2',
          gpa: '5.00',
          passing_year: 2026,
        },
      ],
    });
    const v = (await run(DocumentKind.TESTIMONIAL, ['s1'], m)).get('s1')!.values;
    expect(v['public_exam.name']).toBe('SSC');
    expect(v['public_exam.gpa']).toBe('5.00');
    expect(v['public_exam.year']).toBe('2026');
  });

  it('testimonial for ACTIVE with no exam row leaves public_exam.* empty', async () => {
    const v = (
      await run(DocumentKind.TESTIMONIAL, ['s1'], manager({ students: [student('s1')] }))
    ).get('s1')!.values;
    for (const k of Object.keys(v).filter((k) => k.startsWith('public_exam.'))) {
      expect(v[k]).toBe('');
    }
  });

  it('testimonial for TRANSFERRED is refused NOT_CURRENT_OR_GRADUATED', async () => {
    const body = await refusal(
      run(DocumentKind.TESTIMONIAL, ['s1'], manager({ students: [student('s1', 'TRANSFERRED')] })),
    );
    expect(body.details.students[0].reason).toBe('NOT_CURRENT_OR_GRADUATED');
  });

  it('study certificate for INACTIVE is refused NOT_CURRENT; ACTIVE gets academic_year', async () => {
    const body = await refusal(
      run(
        DocumentKind.STUDY_CERTIFICATE,
        ['s1'],
        manager({ students: [student('s1', 'INACTIVE')] }),
      ),
    );
    expect(body.details.students[0].reason).toBe('NOT_CURRENT');
    const v = (
      await run(DocumentKind.STUDY_CERTIFICATE, ['s1'], manager({ students: [student('s1')] }))
    ).get('s1')!.values;
    expect(v['student.academic_year']).toBe('2026');
  });

  it('character and participation resolve for a TRANSFERRED student', async () => {
    for (const k of [DocumentKind.CHARACTER_CERTIFICATE, DocumentKind.PARTICIPATION_CERTIFICATE]) {
      const out = await run(k, ['s1'], manager({ students: [student('s1', 'TRANSFERRED')] }));
      expect(out.has('s1')).toBe(true);
    }
  });

  it('every kind returns exactly the catalog keys', async () => {
    const kinds: StudentCertificateKind[] = [
      DocumentKind.TRANSFER_CERTIFICATE,
      DocumentKind.TESTIMONIAL,
      DocumentKind.CHARACTER_CERTIFICATE,
      DocumentKind.STUDY_CERTIFICATE,
      DocumentKind.PARTICIPATION_CERTIFICATE,
    ];
    for (const k of kinds) {
      const m = manager({ students: [student('s1')], events: [leave('s1', 'WITHDRAWN')] });
      const v = (await run(k, ['s1'], m)).get('s1')!.values;
      expect(Object.keys(v).sort()).toEqual(FIELD_CATALOG[k].map((f) => f.key).sort());
    }
  });
});

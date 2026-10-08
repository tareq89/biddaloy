import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrintJobsService } from './print-jobs.service';
import { todayInSchoolTz } from '../../../common/time';
import { RESOLVERS } from '../catalog/field-resolver';

const TENANT = 't1';
const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c';
const TPL = '00000000-0000-4000-8000-0000000000f1';

let copies: Record<string, number>;
let template: any;

function makeManager() {
  return {
    findOne: vi.fn(async () => template),
    findOneByOrFail: vi.fn(async () => ({ id: 'v1', version: 1, definition: {} })),
    create: vi.fn((_e: unknown, x: any) => x),
    save: vi.fn(async (x: any) => ({ id: 'row-' + Math.random(), ...x })),
    query: vi.fn(async (sql: string, params: any[]) => {
      if (sql.includes('max(copy_number)')) {
        const subjectId = params[2];
        copies[subjectId] = (copies[subjectId] ?? 0) + 1;
        return [{ n: copies[subjectId] }];
      }
      if (sql.includes('max(serial_no)')) return [{ n: 1 }];
      return [];
    }),
  };
}

function setup(kind: keyof typeof RESOLVERS = 'STUDENT_ID_CARD') {
  const manager = makeManager();
  const ds: any = { manager, transaction: (fn: any) => fn(manager) };
  const settings: any = { documentsSettings: vi.fn(async () => ({})) };
  const svc = new PrintJobsService(ds, {} as any, { record: vi.fn() } as any, settings);
  // The resolver returns every id except 'foreign' (a subject of another tenant).
  vi.spyOn(RESOLVERS[kind]!, 'resolve').mockImplementation(
    async (_t, ids) =>
      new Map(
        ids
          .filter((i) => i !== 'foreign')
          .map((i) => [i, { label: 'L' + i, values: {}, photoKey: null }]),
      ),
  );
  return { svc, manager };
}

const caller = { tenantId: TENANT, userId: 'u', role: 'ADMIN' };
const dto = (ids: string[], type: 'STUDENT' | 'STAFF' = 'STUDENT') =>
  ({ template_id: TPL, subject_type: type, subject_ids: ids }) as any;

beforeEach(() => {
  vi.restoreAllMocks();
  copies = {};
  template = {
    id: TPL,
    tenant_id: TENANT,
    document_kind: 'STUDENT_ID_CARD',
    batch_size: 2,
    current_version_id: 'v1',
    archived_at: null,
  };
});

describe('PrintJobsService', () => {
  it('enforces batch_size', async () => {
    const { svc } = setup();
    await expect(svc.create(caller, dto([A, B, C]))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('409s when the template was never published', async () => {
    template.current_version_id = null;
    const { svc } = setup();
    await expect(svc.preview(caller, dto([A]))).rejects.toBeInstanceOf(ConflictException);
  });

  it('403s a staff card for a role without STAFF_HR_READ', async () => {
    template.document_kind = 'STAFF_ID_CARD';
    const { svc } = setup('STAFF_ID_CARD');
    // ACCOUNTANT may print (DOCUMENT_PRINT) but must not read staff HR data.
    await expect(
      svc.create({ ...caller, role: 'ACCOUNTANT' }, dto([A], 'STAFF')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a subject the resolver did not return (another tenant)', async () => {
    const { svc } = setup();
    await expect(svc.create(caller, dto(['foreign']))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('names the template value and the ceiling in batch errors', async () => {
    template.batch_size = 500;
    const { svc } = setup();
    await expect(svc.preview(caller, dto([A]))).rejects.toThrow(/500 exceeds the maximum of 200/);
  });

  it('404s a template that is not in the caller tenant', async () => {
    template = null;
    const { svc } = setup();
    await expect(svc.preview(caller, dto([A]))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('increments copy numbers across jobs, locks in sorted order, never stores the raw token', async () => {
    const { svc, manager } = setup();
    const first = await svc.create(caller, dto([B, A]));
    const second = await svc.create(caller, dto([A]));

    expect(first.items.map((i: any) => i.subject_id)).toEqual([A, B]);
    expect(second.items[0]).toMatchObject({ subject_id: A, copy_number: 2 });

    const lockKeys = manager.query.mock.calls
      .filter((c) => (c[0] as string).includes('advisory'))
      .map((c) => (c[1] as string[])[0]);
    expect(lockKeys.slice(0, 2)).toEqual([
      // No context for an ID card: the context part of the key is empty.
      `${TENANT}:STUDENT:${A}:STUDENT_ID_CARD::`,
      `${TENANT}:STUDENT:${B}:STUDENT_ID_CARD::`,
    ]);

    // Only the hash is persisted, so the raw token must appear in no saved row.
    const token = (first.items[0] as any).verify_url.slice('/v/'.length);
    expect(JSON.stringify(manager.save.mock.calls)).not.toContain(token);
  });

  it('copy 1 prints no label; copy 2 uses the template label text', async () => {
    const { svc, manager } = setup();
    manager.findOneByOrFail.mockResolvedValue({
      id: 'v1',
      definition: { copyLabel: { text: 'Copy {n}' } },
    } as any);
    const first = await svc.create(caller, dto([A]));
    const second = await svc.create(caller, dto([A]));
    expect((first.items[0] as any).values['print.copyLabel']).toBe('');
    expect((second.items[0] as any).values['print.copyLabel']).toBe('Copy 2');
  });

  describe('context', () => {
    it('400s an admit card without an exam', async () => {
      template.document_kind = 'EXAM_ADMIT_CARD';
      const { svc } = setup('EXAM_ADMIT_CARD');
      await expect(svc.create(caller, dto([A]))).rejects.toBeInstanceOf(BadRequestException);
    });

    it('400s a context on a kind that takes none', async () => {
      template.document_kind = 'TESTIMONIAL';
      const { svc } = setup('TESTIMONIAL');
      const withExam = { ...dto([A]), context_type: 'EXAM', context_id: B };
      await expect(
        svc.create({ ...caller, channel: 'CERTIFICATE' }, withExam),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('keys the copy lock and query by exam, so exam B is not copy 2 of exam A', async () => {
      template.document_kind = 'EXAM_ADMIT_CARD';
      const { svc, manager } = setup('EXAM_ADMIT_CARD');
      await svc.create(caller, { ...dto([A]), context_type: 'EXAM', context_id: B });
      const lock = manager.query.mock.calls.find((c) => (c[0] as string).includes('advisory'));
      expect((lock![1] as string[])[0]).toBe(`${TENANT}:STUDENT:${A}:EXAM_ADMIT_CARD:EXAM:${B}`);
      const copyQuery = manager.query.mock.calls.find((c) =>
        (c[0] as string).includes('max(copy_number)'),
      );
      expect(copyQuery![0]).toContain('context_id IS NOT DISTINCT FROM');
      expect(copyQuery![1]).toEqual([TENANT, 'STUDENT', A, 'EXAM_ADMIT_CARD', 'EXAM', B]);
    });
  });

  describe('channel (D6/D40)', () => {
    it('403s a testimonial on the document channel, naming CERTIFICATE_ISSUE', async () => {
      template.document_kind = 'TESTIMONIAL';
      const { svc } = setup('TESTIMONIAL');
      // ACCOUNTANT has DOCUMENT_PRINT; this is what stops it printing a TC.
      await expect(svc.create({ ...caller, role: 'ACCOUNTANT' }, dto([A]))).rejects.toThrow(
        /Requires permission\(s\): CERTIFICATE_ISSUE/,
      );
    });

    it('403s before the subject_type check: ACCOUNTANT + TC template + wrong subject type', async () => {
      template.document_kind = 'TRANSFER_CERTIFICATE';
      const { svc } = setup('TRANSFER_CERTIFICATE');
      // Permission is checked first, so the wrong subject_type must not turn this into a 400.
      await expect(
        svc.create({ ...caller, role: 'ACCOUNTANT' }, dto([A], 'STAFF')),
      ).rejects.toThrow(/CERTIFICATE_ISSUE/);
    });

    it('400s an ID card on the certificate channel', async () => {
      const { svc } = setup();
      await expect(svc.create({ ...caller, channel: 'CERTIFICATE' }, dto([A]))).rejects.toThrow(
        /Not a certificate/,
      );
    });
  });

  describe('serials', () => {
    const rows = (...r: any[]) => r;
    it('numbers a bulk job in request order under one kind-year lock', async () => {
      template.document_kind = 'TESTIMONIAL';
      template.batch_size = 5;
      const { svc, manager } = setup('TESTIMONIAL');
      manager.query.mockImplementation(async (sql: string) =>
        sql.includes('max(serial_no)') ? [{ n: 9 }] : [],
      );
      const res = await svc.create({ ...caller, channel: 'CERTIFICATE' }, dto([C, A, B]));
      const y = Number(todayInSchoolTz().slice(0, 4));
      // Request order, consecutive from the max + 1.
      expect(res.items.map((i: any) => [i.subject_id, i.serial_no])).toEqual([
        [C, `TSM-${y}-00009`],
        [A, `TSM-${y}-00010`],
        [B, `TSM-${y}-00011`],
      ]);
      const locks = manager.query.mock.calls.filter((c) => (c[0] as string).includes('advisory'));
      expect(locks).toHaveLength(1);
      expect((locks[0][1] as string[])[0]).toMatch(
        new RegExp(`^${TENANT}:SERIAL:TESTIMONIAL:\\d{4}$`),
      );
    });

    function reprintSetup(stored: any[]) {
      const original = {
        id: 'item1',
        document_kind: 'TESTIMONIAL',
        subject_type: 'STUDENT',
        subject_id: A,
        subject_label: 'L',
        serial_no: 1,
        serial_year: 2026,
        context_type: null,
        context_id: null,
        revoked_at: null,
        data_snapshot: {
          values: { 'print.serial_no': 'TSM-2026-00001', 'print.issue_date': '2026-01-01' },
          photoKey: null,
          issuedAt: '2026-01-01T00:00:00Z',
        },
      };
      const { svc, manager } = setup('TESTIMONIAL');
      manager.findOne.mockResolvedValue({
        id: 'j1',
        tenant_id: TENANT,
        document_kind: 'TESTIMONIAL',
        template_version_id: 'v1',
      } as any);
      (manager as any).find = vi.fn(async () => [original]);
      const q = manager.query.getMockImplementation()!;
      manager.query.mockImplementation(async (sql: string, p: any[]) =>
        sql.includes('FROM print_job_items') && sql.includes('serial_no = $4') ? stored : q(sql, p),
      );
      return { svc, manager };
    }
    const stored = (subject: string) =>
      rows({
        subject_type: 'STUDENT',
        subject_id: subject,
        context_type: null,
        context_id: null,
        copy_number: 1,
      });

    it('reprint keeps the serial and labels copy 2 as DUPLICATE', async () => {
      const { svc, manager } = reprintSetup(stored(A));
      const res = await svc.reprint({ ...caller, channel: 'CERTIFICATE' }, 'j1', ['item1']);
      expect(res.items[0]).toMatchObject({ copy_number: 2, serial_no: 'TSM-2026-00001' });
      expect((res.items[0] as any).values['print.copyLabel']).toBe(
        'প্রতিলিপি / DUPLICATE (copy 2)',
      );
      const lock = manager.query.mock.calls.find((c) => (c[0] as string).includes('advisory'));
      expect((lock![1] as string[])[0]).toBe(`${TENANT}:SERIAL:TESTIMONIAL:2026:1`);
    });

    it('409s and inserts nothing when the serial belongs to a different student', async () => {
      const { svc, manager } = reprintSetup(stored(B));
      await expect(
        svc.reprint({ ...caller, channel: 'CERTIFICATE' }, 'j1', ['item1']),
      ).rejects.toBeInstanceOf(ConflictException);
      // Only the reprint job row was saved; no item.
      expect(
        manager.save.mock.calls.filter((c) => (c[0] as any).document_kind && (c[0] as any).job_id),
      ).toHaveLength(0);
    });
  });

  it('family create: job CONFIRMED, items OK, no role check', async () => {
    template.document_kind = 'TESTIMONIAL';
    const { svc, manager } = setup('TESTIMONIAL');
    // A parent has no staff role at all; assertLinked already vouched for them.
    const res = await svc.create({ ...caller, role: 'PARENT' }, dto([A]), { family: true });
    const saved = manager.save.mock.calls.map((c) => c[0] as any);
    expect(saved.find((x) => x.status)).toMatchObject({ status: 'CONFIRMED' });
    expect(saved.find((x) => x.status).confirmed_at).toBeInstanceOf(Date);
    expect(saved.find((x) => x.job_id)).toMatchObject({ outcome: 'OK' });
    expect(res.items).toHaveLength(1);
  });

  describe('issue_values (D3, D43)', () => {
    const text = (extra: object) => ({ type: 'TEXT', x: 0, y: 0, w: 10, h: 5, ...extra });
    const withDef = (manager: any, elements: object[]) =>
      manager.findOneByOrFail.mockResolvedValue({
        id: 'v1',
        version: 1,
        definition: { front: { elements } },
      });
    const cert = { ...caller, channel: 'CERTIFICATE' as const };
    const issueDto = (issue_values?: Record<string, string>) => ({
      ...dto([A]),
      issue_values,
    });
    const setupTestimonial = (elements: object[]) => {
      template.document_kind = 'TESTIMONIAL';
      const s = setup('TESTIMONIAL');
      withDef(s.manager, elements);
      return s;
    };
    const bound = [text({ field: 'issue.conduct' })];

    it('create stores the trimmed text in the item values', async () => {
      const { svc } = setupTestimonial(bound);
      const res = await svc.create(cert, issueDto({ 'issue.conduct': '  Satisfactory ' }));
      expect((res.items[0] as any).values['issue.conduct']).toBe('Satisfactory');
    });

    it('a {{placeholder}}-only binding also requires the value and carries it', async () => {
      const { svc } = setupTestimonial([text({ text: 'He is of {{issue.conduct}} conduct.' })]);
      await expect(svc.create(cert, issueDto())).rejects.toMatchObject({
        response: { message: ['issue.conduct: required'] },
      });
      const res = await svc.create(cert, issueDto({ 'issue.conduct': 'good' }));
      expect((res.items[0] as any).values['issue.conduct']).toBe('good');
    });

    it('create without the value is a 400 naming the field', async () => {
      const { svc } = setupTestimonial(bound);
      const err = await svc.create(cert, issueDto()).catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.getResponse().message).toEqual(['issue.conduct: required']);
    });

    it('create with a blank value is a 400', async () => {
      const { svc } = setupTestimonial(bound);
      await expect(svc.create(cert, issueDto({ 'issue.conduct': '   ' }))).rejects.toMatchObject({
        response: { message: ['issue.conduct: required'] },
      });
    });

    it('create with a key the template does not place is a 400', async () => {
      const { svc } = setupTestimonial(bound);
      await expect(
        svc.create(cert, issueDto({ 'issue.conduct': 'ok', 'issue.event_name': 'x' })),
      ).rejects.toMatchObject({
        response: { message: ['issue.event_name: not an issue field of this template'] },
      });
    });

    it('create with 121 characters is a 400', async () => {
      const { svc } = setupTestimonial(bound);
      await expect(
        svc.create(cert, issueDto({ 'issue.conduct': 'a'.repeat(121) })),
      ).rejects.toMatchObject({
        response: { message: ['issue.conduct: longer than 120 characters'] },
      });
    });

    it('preview without values is 200 and leaves the sample to the catalog', async () => {
      const { svc } = setupTestimonial(bound);
      const res = await svc.preview(cert, issueDto());
      expect((res.items[0] as any).values['issue.conduct']).toBeUndefined();
    });

    it('preview echoes typed values; an unknown key is still a 400', async () => {
      const { svc } = setupTestimonial(bound);
      const res = await svc.preview(cert, issueDto({ 'issue.conduct': 'typed' }));
      expect((res.items[0] as any).values['issue.conduct']).toBe('typed');
      await expect(svc.preview(cert, issueDto({ 'issue.nope': 'x' }))).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('audit records the keys, not the text', async () => {
      const { svc } = setupTestimonial(bound);
      const audit = (svc as any).audit.record as ReturnType<typeof vi.fn>;
      await svc.create(cert, issueDto({ 'issue.conduct': 'secret words' }));
      const nv = (audit.mock.calls.at(-1)![0] as any).new_values;
      expect(nv.issue_keys).toEqual(['issue.conduct']);
      expect(JSON.stringify(nv)).not.toContain('secret words');
    });

    it('a template with no issue field refuses any key', async () => {
      const { svc } = setupTestimonial([text({ field: 'student.name' })]);
      await expect(svc.create(cert, issueDto({ 'issue.conduct': 'x' }))).rejects.toMatchObject({
        response: { message: ['issue.conduct: not an issue field of this template'] },
      });
    });
  });
});

import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { todayInSchoolTz } from '../../../common/time';
import { RESOLVERS } from '../catalog/field-resolver';
import { PrintCaller, PrintJobsService } from './print-jobs.service';

/**
 * [48.2.04] Serial numbers and exam-scoped copy numbers against a real database.
 * Resolvers are stubbed: what is under test is the lock + allocator, not the data.
 */
describe('PrintJobsService serials (integration)', () => {
  let ds: DataSource;
  let svc: PrintJobsService;
  let tenantId: string;
  let userId: string;
  let serialPrefix: string | undefined;
  const templates: Record<string, string> = {};
  const year = () => Number(todayInSchoolTz().slice(0, 4));
  const certCaller = () => ({ tenantId, userId, role: 'ADMIN', channel: 'CERTIFICATE' as const });
  const docCaller = () => ({ tenantId, userId, role: 'ADMIN' });

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get(DataSource);
    svc = new PrintJobsService(
      ds,
      {} as any,
      { record: async () => undefined } as any,
      { documentsSettings: async () => ({ serialPrefix }) } as any,
    );
  });

  async function seedTenant() {
    const q = async (sql: string, p: unknown[]) => (await ds.query(sql, p))[0].id as string;
    const tid = await q(`INSERT INTO schools (name, slug) VALUES ($1, $2) RETURNING id`, [
      `PS ${randomUUID()}`,
      `ps-${randomUUID()}`,
    ]);
    const uid = await q(`INSERT INTO users (full_name, email) VALUES ('Clerk', $1) RETURNING id`, [
      `ps-${randomUUID()}@example.com`,
    ]);
    const tpl: Record<string, string> = {};
    for (const kind of [
      'TESTIMONIAL',
      'CHARACTER_CERTIFICATE',
      'EXAM_ADMIT_CARD',
      'STUDENT_ID_CARD',
    ]) {
      const t = await q(
        `INSERT INTO print_templates (tenant_id, document_kind, name, batch_size, draft)
         VALUES ($1, $2, $2, 50, '{}'::jsonb) RETURNING id`,
        [tid, kind],
      );
      const v = await q(
        `INSERT INTO print_template_versions (tenant_id, template_id, version, definition)
         VALUES ($1, $2, 1, '{}'::jsonb) RETURNING id`,
        [tid, t],
      );
      await ds.query(`UPDATE print_templates SET current_version_id = $1 WHERE id = $2`, [v, t]);
      tpl[kind] = t;
    }
    return { tid, uid, tpl };
  }

  beforeEach(async () => {
    serialPrefix = undefined;
    const t = await seedTenant();
    tenantId = t.tid;
    userId = t.uid;
    Object.assign(templates, t.tpl);
    for (const kind of [
      'TESTIMONIAL',
      'CHARACTER_CERTIFICATE',
      'EXAM_ADMIT_CARD',
      'STUDENT_ID_CARD',
    ] as const) {
      vi.spyOn(RESOLVERS[kind]!, 'resolve').mockImplementation(
        async (_t, ids) =>
          new Map(ids.map((i) => [i, { label: 'S-' + i.slice(0, 4), values: {}, photoKey: null }])),
      );
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  afterAll(async () => {
    await ds.destroy();
  });

  const uuids = (n: number) => Array.from({ length: n }, () => randomUUID());
  const issue = (
    kind: string,
    ids: string[],
    caller: PrintCaller = certCaller(),
    extra: object = {},
  ) =>
    svc.create(caller, {
      template_id: templates[kind],
      subject_type: 'STUDENT',
      subject_ids: ids,
      ...extra,
    } as any);
  const serialsOf = (res: { items: any[] }) => res.items.map((i) => i.serial_no as string);

  it('two concurrent issues for different students never share a serial', async () => {
    // This is the legal-document guarantee: a serial identifies exactly one certificate.
    const [a, b] = await Promise.all([
      issue('TESTIMONIAL', uuids(1)),
      issue('TESTIMONIAL', uuids(1)),
    ]);
    expect([...serialsOf(a), ...serialsOf(b)].sort()).toEqual([
      `TSM-${year()}-00001`,
      `TSM-${year()}-00002`,
    ]);
  });

  it('two parallel bulk jobs of 20 get 40 distinct serials, 20 consecutive each', async () => {
    const [a, b] = await Promise.all([
      issue('TESTIMONIAL', uuids(20)),
      issue('TESTIMONIAL', uuids(20)),
    ]);
    const nums = (r: { items: any[] }) => r.items.map((i) => Number(i.serial_no.split('-').pop()));
    const all = [...nums(a), ...nums(b)];
    expect(new Set(all).size).toBe(40);
    for (const n of [nums(a), nums(b)]) {
      // In request order and consecutive: the lock was held for the whole job.
      expect(n).toEqual(Array.from({ length: 20 }, (_, i) => n[0] + i));
    }
  });

  it('a second NEW issue for the same student gets a new serial, copy 1', async () => {
    const [s] = uuids(1);
    const first = await issue('TESTIMONIAL', [s]);
    const second = await issue('TESTIMONIAL', [s]);
    expect(serialsOf(first)).toEqual([`TSM-${year()}-00001`]);
    expect(serialsOf(second)).toEqual([`TSM-${year()}-00002`]);
    expect(second.items[0].copy_number).toBe(1);
  });

  describe('reprint', () => {
    it('two parallel reprints get copies 2 and 3 of the same serial; copy 1 stays valid', async () => {
      const first = await issue('TESTIMONIAL', uuids(1));
      const itemId = first.items[0].item_id as string;
      const [r1, r2] = await Promise.all([
        svc.reprint(certCaller(), first.job_id, [itemId]),
        svc.reprint(certCaller(), first.job_id, [itemId]),
      ]);
      const copies = [r1, r2].map((r) => r.items[0] as any);
      expect(copies.map((c) => c.copy_number).sort()).toEqual([2, 3]);
      for (const c of copies) {
        expect(c.serial_no).toBe(`TSM-${year()}-00001`);
        expect(c.values['print.copyLabel']).toMatch(/^প্রতিলিপি \/ DUPLICATE \(copy [23]\)$/);
      }
      const [orig] = await ds.query(
        `SELECT revoked_at, copy_number FROM print_job_items WHERE id = $1`,
        [itemId],
      );
      expect(orig).toMatchObject({ revoked_at: null, copy_number: 1 });
    });

    it('refuses (409) and inserts nothing when stored rows of the serial belong to another student', async () => {
      // The DB index has no subject column, so the same-student rule lives in the service.
      const first = await issue('TESTIMONIAL', uuids(1));
      const itemId = first.items[0].item_id as string;
      // Corrupt on purpose: a second copy of the same serial under a different student.
      await ds.query(
        `INSERT INTO print_job_items (tenant_id, job_id, document_kind, subject_type, subject_id, subject_label,
           copy_number, serial_no, serial_year, data_snapshot, verify_token_hash)
         SELECT tenant_id, job_id, document_kind, subject_type, $2, 'Other', 2, serial_no, serial_year,
           data_snapshot, repeat('a', 64) FROM print_job_items WHERE id = $1`,
        [itemId, randomUUID()],
      );
      const before = await ds.query(`SELECT count(*)::int AS n FROM print_job_items`);
      await expect(svc.reprint(certCaller(), first.job_id, [itemId])).rejects.toBeInstanceOf(
        ConflictException,
      );
      const after = await ds.query(`SELECT count(*)::int AS n FROM print_job_items`);
      expect(after[0].n).toBe(before[0].n);
    });
  });

  it('prefix changes the printed text but not the numbering', async () => {
    serialPrefix = 'DAHS';
    const first = await issue('TESTIMONIAL', uuids(1));
    expect(serialsOf(first)).toEqual([`DAHS-TSM-${year()}-00001`]);
    serialPrefix = undefined;
    const second = await issue('TESTIMONIAL', uuids(1));
    expect(serialsOf(second)).toEqual([`TSM-${year()}-00002`]);
  });

  it('the year follows the Dhaka calendar: 18:30 UTC on 31 Dec is already 1 Jan', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-12-31T18:30:00Z'));
    const res = await issue('TESTIMONIAL', uuids(1));
    expect(serialsOf(res)).toEqual(['TSM-2027-00001']);
  });

  it('counts per kind and per tenant', async () => {
    await issue('TESTIMONIAL', uuids(3));
    const chr = await issue('CHARACTER_CERTIFICATE', uuids(1));
    expect(serialsOf(chr)).toEqual([`CHR-${year()}-00001`]);
    const next = await issue('TESTIMONIAL', uuids(1));
    expect(serialsOf(next)).toEqual([`TSM-${year()}-00004`]);

    // Another school starts again at 1.
    const other = await seedTenant();
    const res = await svc.create(
      { tenantId: other.tid, userId: other.uid, role: 'ADMIN', channel: 'CERTIFICATE' },
      {
        template_id: other.tpl.TESTIMONIAL,
        subject_type: 'STUDENT',
        subject_ids: uuids(1),
      } as any,
    );
    expect(serialsOf(res)).toEqual([`TSM-${year()}-00001`]);
  });

  describe('admit cards are counted per exam', () => {
    const examA = randomUUID();
    const examB = randomUUID();
    const admit = (student: string, exam: string) =>
      issue('EXAM_ADMIT_CARD', [student], docCaller(), { context_type: 'EXAM', context_id: exam });

    it('the same student in two exams gets copy 1 in each; a reprint in A is copy 2 in A only', async () => {
      const [s] = uuids(1);
      const a1 = await admit(s, examA);
      const b1 = await admit(s, examB);
      expect(a1.items[0].copy_number).toBe(1);
      expect(b1.items[0].copy_number).toBe(1);

      const re = await svc.reprint(docCaller(), a1.job_id, [a1.items[0].item_id as string]);
      expect(re.items[0].copy_number).toBe(2);
      const b2 = await admit(s, examB);
      expect(b2.items[0].copy_number).toBe(2);
      const a3 = await admit(s, examA);
      expect(a3.items[0].copy_number).toBe(3);
    });

    it('parallel creates for exam A and exam B of one student do not collide', async () => {
      const [s] = uuids(1);
      const [a, b] = await Promise.all([admit(s, examA), admit(s, examB)]);
      expect([a.items[0].copy_number, b.items[0].copy_number]).toEqual([1, 1]);
    });
  });

  it('ID-card copy numbering is unchanged: copy 1, 2 for the same student, no context', async () => {
    const [s] = uuids(1);
    const [a, b] = await Promise.all([
      issue('STUDENT_ID_CARD', [s], docCaller()),
      issue('STUDENT_ID_CARD', [s], docCaller()),
    ]);
    expect([a.items[0].copy_number, b.items[0].copy_number].sort()).toEqual([1, 2]);
    // Copy 1 prints no label (D44), copy 2 says "Copy 2".
    const byCopy = [a, b]
      .map((r) => r.items[0] as any)
      .sort((x, y) => x.copy_number - y.copy_number);
    expect(byCopy[0].values['print.copyLabel']).toBe('');
    expect(byCopy[1].values['print.copyLabel']).toBe('Copy 2');
  });
});

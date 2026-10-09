import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { PrintJobsService } from './print-jobs.service';
import { PrintHistoryService } from './print-history.service';
import { PublicVerifyService } from '../verify/public-verify.service';

describe('print history (integration)', () => {
  let ds: DataSource;
  let jobs: PrintJobsService;
  let history: PrintHistoryService;
  let verify: PublicVerifyService;
  let tenantId: string;
  let userId: string;
  let studentA: string;
  let studentB: string;
  let templateId: string;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get(DataSource);
    const audit: any = { record: async () => undefined };
    jobs = new PrintJobsService(ds, { get: async (k: string) => ({ body: k }) } as any, audit, {
      documentsSettings: async () => ({}),
    } as any);
    history = new PrintHistoryService(ds, audit);
    verify = new PublicVerifyService(ds);
  });

  // The suite's setup wipes tenant data before every test, so seed per test.
  beforeEach(async () => {
    const q = async (sql: string, p: unknown[]) => (await ds.query(sql, p))[0].id as string;
    tenantId = await q(
      `INSERT INTO schools (name, name_bn, slug) VALUES ($1, 'বিদ্যালয়', $2) RETURNING id`,
      [`PH ${randomUUID()}`, `ph-${randomUUID()}`],
    );
    userId = await q(`INSERT INTO users (full_name, email) VALUES ('Printer', $1) RETURNING id`, [
      `ph-${randomUUID()}@example.com`,
    ]);
    const year = await q(
      `INSERT INTO academic_years (name, start_date, end_date, tenant_id)
       VALUES ('2027', '2027-01-01', '2027-12-31', $1) RETURNING id`,
      [tenantId],
    );
    const cls = await q(
      `INSERT INTO classes (name, academic_year_id, tenant_id) VALUES ('Class 8', $1, $2) RETURNING id`,
      [year, tenantId],
    );
    const section = await q(
      `INSERT INTO class_sections (class_id, section_name, tenant_id) VALUES ($1, 'A', $2) RETURNING id`,
      [cls, tenantId],
    );
    const student = async (name: string, reg: string, roll: number) => {
      const id = await q(
        `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [name, reg, roll, section, tenantId],
      );
      await ds.query(
        `INSERT INTO enrollments (student_id, class_id, section_id, academic_year_id, tenant_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, cls, section, year, tenantId],
      );
      return id;
    };
    studentA = await student('Rahim', 'R-1', 1);
    studentB = await student('Karim', 'R-2', 2);
    templateId = await q(
      `INSERT INTO print_templates (tenant_id, document_kind, name, batch_size, draft)
       VALUES ($1, 'STUDENT_ID_CARD', 'Classic', 10, '{}'::jsonb) RETURNING id`,
      [tenantId],
    );
    const versionId = await q(
      `INSERT INTO print_template_versions (tenant_id, template_id, version, definition)
       VALUES ($1, $2, 1, '{}'::jsonb) RETURNING id`,
      [tenantId, templateId],
    );
    await ds.query(`UPDATE print_templates SET current_version_id = $1 WHERE id = $2`, [
      versionId,
      templateId,
    ]);
  });

  afterAll(async () => {
    await ds.destroy();
  });

  const admin = () => ({ tenantId, userId, role: 'ADMIN' });
  const create = () =>
    jobs.create(admin(), {
      template_id: templateId,
      subject_type: 'STUDENT',
      subject_ids: [studentA, studentB],
    } as any);
  const tokenOf = (verifyUrl: unknown) => String(verifyUrl).replace('/v/', '');
  const itemFor = (items: any[], subjectId: string) =>
    items.find((i) => i.subject_id === subjectId);

  it('create -> confirm one failed -> reprint it -> history shows copies 1,1,2 -> revoke -> verify shows REVOKED', async () => {
    const original = await create();
    const a = itemFor(original.items, studentA);
    const b = itemFor(original.items, studentB);

    // Confirm: A failed, B printed fine. Confirming again is a 409.
    await jobs.confirm(admin(), original.job_id, [a.item_id]);
    await expect(jobs.confirm(admin(), original.job_id, [])).rejects.toBeInstanceOf(
      ConflictException,
    );
    const outcomes = await ds.query(`SELECT id, outcome FROM print_job_items WHERE job_id = $1`, [
      original.job_id,
    ]);
    expect(outcomes.find((r: any) => r.id === a.item_id).outcome).toBe('FAILED');
    expect(outcomes.find((r: any) => r.id === b.item_id).outcome).toBe('OK');

    // Reprint A: copy 2, a new token, same version, and the data is otherwise identical.
    const again = await jobs.reprint(admin(), original.job_id, [a.item_id]);
    const a2 = again.items[0] as any;
    expect(a2.copy_number).toBe(2);
    expect(tokenOf(a2.verify_url)).not.toBe(tokenOf(a.verify_url));
    expect(again.version.id).toBe(original.version.id);
    const strip = (v: Record<string, unknown>) => {
      const { 'print.copyLabel': _l, 'print.verify_qr': _q, ...rest } = v;
      return rest;
    };
    expect(strip(a2.values)).toEqual(strip(a.values));
    expect(a2.values['print.copyLabel']).toBe('Copy 2');
    const [reprintJob] = await ds.query(`SELECT reprint_of_job_id FROM print_jobs WHERE id = $1`, [
      again.job_id,
    ]);
    expect(reprintJob.reprint_of_job_id).toBe(original.job_id);

    // History: three rows, copies 1, 1, 2 — and no row ever carries the snapshot.
    const list = await history.list(admin(), {} as any);
    expect(list.total).toBe(3);
    expect(list.data.map((r: any) => r.copy_number).sort()).toEqual([1, 1, 2]);
    expect(list.data.every((r: any) => !('data_snapshot' in r))).toBe(true);
    expect(list.data[0].printed_by_name).toBe('Printer');
    expect(list.data[0].template_name).toBe('Classic');

    // The single item does return the snapshot and the definition.
    const detail = await history.getItem(admin(), a2.item_id);
    expect(detail.data_snapshot.copyNumber).toBe(2);
    expect(detail.template_definition).toEqual({});

    // Revoke B. Before: VALID. After: REVOKED. A second revoke is a 409.
    expect((await verify.verify(tokenOf(b.verify_url))).status).toBe('VALID');
    await history.revoke(admin(), b.item_id, 'Lost card');
    const revoked = await verify.verify(tokenOf(b.verify_url));
    expect(revoked.status).toBe('REVOKED');
    expect(revoked.revoked_at).toBeTruthy();
    await expect(history.revoke(admin(), b.item_id, 'again')).rejects.toBeInstanceOf(
      ConflictException,
    );

    // The other copy is untouched, and a revoked document can't be reprinted.
    expect((await verify.verify(tokenOf(a2.verify_url))).status).toBe('VALID');
    await expect(jobs.reprint(admin(), original.job_id, [b.item_id])).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('public verify shows only the allowlisted fields, and an unknown token is a 404', async () => {
    const { items } = await create();
    const res = await verify.verify(tokenOf(items[0].verify_url));
    expect(Object.keys(res).sort()).toEqual(
      [
        'copy_number',
        'document_kind',
        'holder_name',
        'issued_at',
        'school_name',
        'school_name_bn',
        'serial',
        'status',
      ].sort(),
    );
    expect(res.school_name_bn).toBe('বিদ্যালয়');
    await expect(verify.verify('not-a-real-token')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('filters narrow the list', async () => {
    const { items } = await create();
    await jobs.confirm(admin(), (await ds.query(`SELECT id FROM print_jobs LIMIT 1`))[0].id, [
      itemFor(items, studentA).item_id,
    ]);
    const only = async (q: object) => (await history.list(admin(), q as any)).total;
    expect(await only({})).toBe(2);
    expect(await only({ q: 'rah' })).toBe(1); // case-insensitive contains on the label
    expect(await only({ subject_id: studentB })).toBe(1);
    expect(await only({ outcome: 'FAILED' })).toBe(1);
    expect(await only({ status: 'CONFIRMED' })).toBe(2);
    expect(await only({ revoked: true })).toBe(0);
    expect(await only({ document_kind: 'STAFF_ID_CARD' })).toBe(0);
    expect(await only({ from: '2999-01-01' })).toBe(0);
    // A date-only `to` covers the whole of today.
    expect(await only({ to: new Date().toISOString().slice(0, 10) })).toBe(2);
    expect(await only({ q: '100%' })).toBe(0); // % is literal, not a wildcard
  });

  it('a subject history is limited to that subject', async () => {
    await create();
    const rows = await history.subjectHistory(admin(), 'STUDENT', studentA);
    expect(rows).toHaveLength(1);
    expect(rows[0].subject_id).toBe(studentA);
  });

  it("another tenant can't confirm, reprint, read or revoke this tenant's print data", async () => {
    const { job_id, items } = await create();
    const otherTenant = (
      await ds.query(`INSERT INTO schools (name, slug) VALUES ($1, $2) RETURNING id`, [
        `Other ${randomUUID()}`,
        `other-${randomUUID()}`,
      ])
    )[0].id as string;
    const intruder = { tenantId: otherTenant, userId, role: 'ADMIN' };
    await expect(jobs.confirm(intruder, job_id, [])).rejects.toBeInstanceOf(NotFoundException);
    await expect(jobs.reprint(intruder, job_id, [items[0].item_id])).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(history.getItem(intruder, items[0].item_id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(history.revoke(intruder, items[0].item_id, 'x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect((await history.list(intruder, {} as any)).total).toBe(0);
  });

  describe('register (D33)', () => {
    let jobId: string;
    const item = async (o: {
      kind: string;
      label?: string;
      serialNo?: number | null;
      serialYear?: number | null;
      revoke?: string;
      tenant?: string;
      job?: string;
    }) => {
      const no = o.serialNo ?? null;
      const serial =
        no === null ? null : `${o.kind}-${o.serialYear}-${String(no).padStart(5, '0')}`;
      await ds.query(
        `INSERT INTO print_job_items
           (tenant_id, job_id, document_kind, subject_type, subject_id, subject_label, copy_number,
            serial_no, serial_year, data_snapshot, verify_token_hash, revoked_at, revoke_reason)
         VALUES ($1, $2, $3, 'STUDENT', $4, $5, 1, $6, $7, $8::jsonb, $9, $10, $11)`,
        [
          o.tenant ?? tenantId,
          o.job ?? jobId,
          o.kind,
          randomUUID(),
          o.label ?? 'Someone',
          no,
          o.serialYear ?? null,
          JSON.stringify({ values: { 'print.serial_no': serial, 'student.class': 'Class 10' } }),
          randomUUID().replace(/-/g, '').padEnd(64, '0'),
          o.revoke ? new Date() : null,
          o.revoke ?? null,
        ],
      );
    };

    // Serial rows are inserted directly: the issuing flow lands in a later ticket.
    beforeEach(async () => {
      const [{ id: versionId }] = await ds.query(
        `SELECT id FROM print_template_versions WHERE template_id = $1`,
        [templateId],
      );
      [{ id: jobId }] = await ds.query(
        `INSERT INTO print_jobs (tenant_id, template_version_id, document_kind, item_count)
         VALUES ($1, $2, 'STUDENT_ID_CARD', 1) RETURNING id`,
        [tenantId, versionId],
      );
    });

    it('lists only serial rows: newest year, then kind, then serial descending; no snapshot', async () => {
      await item({ kind: 'STUDENT_ID_CARD' });
      await item({ kind: 'ADMIT_CARD' });
      await item({ kind: 'TESTIMONIAL', serialNo: 1, serialYear: 2025 });
      await item({ kind: 'TESTIMONIAL', serialNo: 8, serialYear: 2026 });
      await item({ kind: 'TESTIMONIAL', serialNo: 9, serialYear: 2026 });
      await item({ kind: 'CHARACTER_CERTIFICATE', serialNo: 3, serialYear: 2026 });
      const res = await history.register(admin(), {} as any);
      expect(res.data.map((r: any) => r.serial)).toEqual([
        'CHARACTER_CERTIFICATE-2026-00003',
        'TESTIMONIAL-2026-00009',
        'TESTIMONIAL-2026-00008',
        'TESTIMONIAL-2025-00001',
      ]);
      expect(res.total).toBe(4);
      expect(res.data.every((r: any) => !('data_snapshot' in r))).toBe(true);
      expect(res.data[0].class_name).toBe('Class 10');
      expect((await history.register(admin(), { year: 2025 } as any)).total).toBe(1);
      expect((await history.register(admin(), { document_kind: 'TESTIMONIAL' } as any)).total).toBe(
        3,
      );
    });

    it('status=REVOKED lists only revoked copies with their reason; VALID the rest', async () => {
      await item({ kind: 'TESTIMONIAL', serialNo: 1, serialYear: 2026 });
      await item({ kind: 'TESTIMONIAL', serialNo: 2, serialYear: 2026, revoke: 'Wrong name' });
      const revoked = await history.register(admin(), { status: 'REVOKED' } as any);
      expect(revoked.data).toHaveLength(1);
      expect(revoked.data[0].revoke_reason).toBe('Wrong name');
      expect(revoked.data[0].revoked_at).toBeTruthy();
      expect((await history.register(admin(), { status: 'VALID' } as any)).total).toBe(1);
      expect((await history.register(admin(), {} as any)).total).toBe(2);
    });

    it('q finds by serial text or by name', async () => {
      await item({ kind: 'TESTIMONIAL', serialNo: 9, serialYear: 2026, label: 'Rahim Uddin' });
      await item({ kind: 'TESTIMONIAL', serialNo: 10, serialYear: 2026, label: 'Karim' });
      const bySerial = await history.register(admin(), { q: '00009' } as any);
      expect(bySerial.data.map((r: any) => r.subject_label)).toEqual(['Rahim Uddin']);
      const byName = await history.register(admin(), { q: 'RAHIM' } as any);
      expect(byName.total).toBe(1);
      expect((await history.register(admin(), { q: '%' } as any)).total).toBe(0);
    });

    it("never shows another tenant's serials", async () => {
      await item({ kind: 'TESTIMONIAL', serialNo: 1, serialYear: 2026 });
      const other = (
        await ds.query(`INSERT INTO schools (name, slug) VALUES ($1, $2) RETURNING id`, [
          `Other ${randomUUID()}`,
          `other-${randomUUID()}`,
        ])
      )[0].id as string;
      const intruder = { tenantId: other, userId, role: 'ADMIN' };
      expect((await history.register(intruder, {} as any)).total).toBe(0);
      expect(await history.registerCsvRows(intruder, {} as any)).toHaveLength(0);
    });

    it('CSV rows equal the list rows for the same filter; 10 001 rows is refused', async () => {
      await item({ kind: 'TESTIMONIAL', serialNo: 1, serialYear: 2026 });
      await item({ kind: 'TESTIMONIAL', serialNo: 2, serialYear: 2026, revoke: 'x' });
      const q = { document_kind: 'TESTIMONIAL' } as any;
      expect(await history.registerCsvRows(admin(), q)).toEqual(
        (await history.register(admin(), q)).data,
      );

      await ds.query(
        `INSERT INTO print_job_items
           (tenant_id, job_id, document_kind, subject_type, subject_id, subject_label, copy_number,
            serial_no, serial_year, data_snapshot, verify_token_hash)
         SELECT $1, $2, 'STUDY_CERTIFICATE', 'STUDENT', gen_random_uuid(), 'Bulk', 1,
                g, 2026, '{}'::jsonb, md5(g::text) || md5(g::text || 'x')
           FROM generate_series(1, 10001) g`,
        [tenantId, jobId],
      );
      await expect(history.registerCsvRows(admin(), {} as any)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });
});

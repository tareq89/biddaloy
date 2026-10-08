import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';

/**
 * [32.1.2] Verifies the print migration's DB-level guarantees: immutable
 * template versions, one default template per (tenant, kind), unique copy
 * numbers, the batch-size CHECK, and RESTRICT on template delete. Raw SQL
 * on purpose — these are constraints, not repository behaviour.
 */
describe('PrintModule migration (integration)', () => {
  let ds: DataSource;
  let tenantId: string;

  const insertTemplate = async (opts: { isDefault?: boolean; batchSize?: number } = {}) => {
    const rows = await ds.query(
      `INSERT INTO print_templates (tenant_id, document_kind, name, is_default, batch_size, draft)
       VALUES ($1, 'STUDENT_ID_CARD', $2, $3, $4, '{}'::jsonb) RETURNING id`,
      [tenantId, `t-${randomUUID()}`, opts.isDefault ?? false, opts.batchSize ?? 50],
    );
    return rows[0].id as string;
  };

  const insertVersion = async (templateId: string) => {
    const rows = await ds.query(
      `INSERT INTO print_template_versions (tenant_id, template_id, version, definition)
       VALUES ($1, $2, 1, '{}'::jsonb) RETURNING id`,
      [tenantId, templateId],
    );
    return rows[0].id as string;
  };

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get(DataSource);
    const rows = await ds.query(`INSERT INTO schools (name, slug) VALUES ($1, $2) RETURNING id`, [
      `Print School ${randomUUID()}`,
      `print-${randomUUID()}`,
    ]);
    tenantId = rows[0].id;
  });

  afterAll(async () => {
    await ds.query(`DELETE FROM print_job_items WHERE tenant_id = $1`, [tenantId]);
    await ds.query(`DELETE FROM print_jobs WHERE tenant_id = $1`, [tenantId]);
    await ds.query(`UPDATE print_templates SET current_version_id = NULL WHERE tenant_id = $1`, [
      tenantId,
    ]);
    await ds.query(`DELETE FROM print_template_versions WHERE tenant_id = $1`, [tenantId]);
    await ds.query(`DELETE FROM print_templates WHERE tenant_id = $1`, [tenantId]);
    await ds.query(`DELETE FROM schools WHERE id = $1`, [tenantId]);
    await ds.destroy();
  });

  it('rejects an UPDATE on print_template_versions', async () => {
    const versionId = await insertVersion(await insertTemplate());
    await expect(
      ds.query(`UPDATE print_template_versions SET version = 2 WHERE id = $1`, [versionId]),
    ).rejects.toThrow(/immutable/);
  });

  it('rejects two default templates for the same (tenant, kind)', async () => {
    await insertTemplate({ isDefault: true });
    await expect(insertTemplate({ isDefault: true })).rejects.toThrow(
      /UQ_print_templates_default_per_kind/,
    );
  });

  it('rejects batch_size 201', async () => {
    await expect(insertTemplate({ batchSize: 201 })).rejects.toThrow(
      /CHK_print_templates_batch_size/,
    );
  });

  it('rejects a duplicate copy_number for the same subject and kind', async () => {
    const versionId = await insertVersion(await insertTemplate());
    const [job] = await ds.query(
      `INSERT INTO print_jobs (tenant_id, template_version_id, document_kind, item_count)
       VALUES ($1, $2, 'STUDENT_ID_CARD', 2) RETURNING id`,
      [tenantId, versionId],
    );
    const subjectId = randomUUID();
    const insertItem = () =>
      ds.query(
        `INSERT INTO print_job_items
           (tenant_id, job_id, document_kind, subject_type, subject_id, subject_label,
            copy_number, data_snapshot, verify_token_hash)
         VALUES ($1, $2, 'STUDENT_ID_CARD', 'STUDENT', $3, 'Someone', 1, '{}'::jsonb, $4)`,
        [tenantId, job.id, subjectId, randomUUID().replace(/-/g, '').padEnd(64, '0')],
      );
    await insertItem();
    await expect(insertItem()).rejects.toThrow(/UQ_print_job_items_copy/);
  });

  describe('print_job_items serials and exam context (Epic 48 D7, D24, D41)', () => {
    let jobId: string;
    let otherTenantId: string;
    let otherJobId: string;

    // Rebuilt per test: test/setup.ts truncates the print tables between tests.
    beforeEach(async () => {
      const versionId = await insertVersion(await insertTemplate());
      [{ id: jobId }] = await ds.query(
        `INSERT INTO print_jobs (tenant_id, template_version_id, document_kind, item_count)
         VALUES ($1, $2, 'STUDENT_ID_CARD', 1) RETURNING id`,
        [tenantId, versionId],
      );
      [{ id: otherTenantId }] = await ds.query(
        `INSERT INTO schools (name, slug) VALUES ($1, $2) RETURNING id`,
        [`Other ${randomUUID()}`, `other-${randomUUID()}`],
      );
      const [tpl] = await ds.query(
        `INSERT INTO print_templates (tenant_id, document_kind, name, batch_size, draft)
         VALUES ($1, 'STUDENT_ID_CARD', 'x', 50, '{}'::jsonb) RETURNING id`,
        [otherTenantId],
      );
      const [ver] = await ds.query(
        `INSERT INTO print_template_versions (tenant_id, template_id, version, definition)
         VALUES ($1, $2, 1, '{}'::jsonb) RETURNING id`,
        [otherTenantId, tpl.id],
      );
      [{ id: otherJobId }] = await ds.query(
        `INSERT INTO print_jobs (tenant_id, template_version_id, document_kind, item_count)
         VALUES ($1, $2, 'STUDENT_ID_CARD', 1) RETURNING id`,
        [otherTenantId, ver.id],
      );
    });

    afterEach(async () => {
      await ds.query(`DELETE FROM print_job_items WHERE tenant_id = $1`, [otherTenantId]);
      await ds.query(`DELETE FROM print_jobs WHERE tenant_id = $1`, [otherTenantId]);
      await ds.query(`DELETE FROM print_template_versions WHERE tenant_id = $1`, [otherTenantId]);
      await ds.query(`DELETE FROM print_templates WHERE tenant_id = $1`, [otherTenantId]);
      await ds.query(`DELETE FROM schools WHERE id = $1`, [otherTenantId]);
    });

    const item = (o: {
      kind: string;
      subjectId: string;
      copy?: number;
      serialNo?: number | null;
      serialYear?: number | null;
      contextId?: string | null;
      contextType?: string | null;
      tenant?: string;
      job?: string;
    }) =>
      ds.query(
        `INSERT INTO print_job_items
           (tenant_id, job_id, document_kind, subject_type, subject_id, subject_label,
            copy_number, serial_no, serial_year, context_type, context_id,
            data_snapshot, verify_token_hash)
         VALUES ($1, $2, $3, 'STUDENT', $4, 'Someone', $5, $6, $7, $8, $9, '{}'::jsonb, $10)`,
        [
          o.tenant ?? tenantId,
          o.job ?? jobId,
          o.kind,
          o.subjectId,
          o.copy ?? 1,
          o.serialNo ?? null,
          o.serialYear ?? null,
          o.contextType === undefined ? (o.contextId ? 'EXAM' : null) : o.contextType,
          o.contextId ?? null,
          randomUUID().replace(/-/g, '').padEnd(64, '0'),
        ],
      );

    it('still rejects a duplicate copy 1 for the same student and kind without context', async () => {
      const subjectId = randomUUID();
      await item({ kind: 'STUDENT_ID_CARD', subjectId });
      await expect(item({ kind: 'STUDENT_ID_CARD', subjectId })).rejects.toThrow(
        /UQ_print_job_items_copy/,
      );
    });

    it('accepts copy 1 of an admit card for two different exams', async () => {
      const subjectId = randomUUID();
      await item({ kind: 'EXAM_ADMIT_CARD', subjectId, contextId: randomUUID() });
      await item({ kind: 'EXAM_ADMIT_CARD', subjectId, contextId: randomUUID() });
    });

    it('rejects copy 1 twice for the same student, kind and exam', async () => {
      const subjectId = randomUUID();
      const contextId = randomUUID();
      await item({ kind: 'EXAM_ADMIT_CARD', subjectId, contextId });
      await expect(item({ kind: 'EXAM_ADMIT_CARD', subjectId, contextId })).rejects.toThrow(
        /UQ_print_job_items_copy/,
      );
    });

    it('accepts two study certificates for one student with different serials', async () => {
      const subjectId = randomUUID();
      await item({ kind: 'STUDY_CERTIFICATE', subjectId, serialNo: 1, serialYear: 2026 });
      await item({ kind: 'STUDY_CERTIFICATE', subjectId, serialNo: 2, serialYear: 2026 });
    });

    it('rejects the same serial as copy 1 for a different student, accepts a reprint, a new year and another tenant', async () => {
      const serial = { kind: 'TESTIMONIAL', serialNo: 7, serialYear: 2026 };
      await item({ ...serial, subjectId: randomUUID() });
      // D7: a serial can never be issued twice as copy 1, even for someone else.
      await expect(item({ ...serial, subjectId: randomUUID() })).rejects.toThrow(
        /UQ_print_job_items_serial_copy/,
      );
      // A reprint of the same serial takes the next copy number.
      await item({ ...serial, subjectId: randomUUID(), copy: 2 });
      // D24: the sequence resets yearly and per tenant.
      await item({ ...serial, serialYear: 2027, subjectId: randomUUID() });
      await item({
        ...serial,
        subjectId: randomUUID(),
        tenant: otherTenantId,
        job: otherJobId,
      });
    });

    it('rejects half-filled pairs and an out-of-range serial', async () => {
      const subjectId = randomUUID();
      await expect(item({ kind: 'TESTIMONIAL', subjectId, serialNo: 1 })).rejects.toThrow(
        /CK_print_job_items_serial_pair/,
      );
      await expect(
        item({ kind: 'EXAM_ADMIT_CARD', subjectId, contextId: randomUUID(), contextType: null }),
      ).rejects.toThrow(/CK_print_job_items_context_pair/);
      await expect(
        item({ kind: 'TESTIMONIAL', subjectId, serialNo: 100000, serialYear: 2026 }),
      ).rejects.toThrow(/CK_print_job_items_serial_range/);
    });
  });

  it('rejects deleting a template that has a version (RESTRICT)', async () => {
    const templateId = await insertTemplate();
    await insertVersion(templateId);
    await expect(
      ds.query(`DELETE FROM print_templates WHERE id = $1`, [templateId]),
    ).rejects.toThrow(/FK_print_template_versions_template/);
  });
});

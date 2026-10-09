import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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

  it('rejects deleting a template that has a version (RESTRICT)', async () => {
    const templateId = await insertTemplate();
    await insertVersion(templateId);
    await expect(
      ds.query(`DELETE FROM print_templates WHERE id = $1`, [templateId]),
    ).rejects.toThrow(/FK_print_template_versions_template/);
  });
});

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { PrintJobsService } from './print-jobs.service';
import { PrintHistoryService } from './print-history.service';
import { hashSecret } from '../../auth/token-hash.util';
import { PublicVerifyService } from '../verify/public-verify.service';

/** ACR printing + the privacy gates around it (service level; role guards sit in the controller). */
describe('ACR print (integration)', () => {
  let ds: DataSource;
  let jobs: PrintJobsService;
  let history: PrintHistoryService;
  let verify: PublicVerifyService;
  let tenantId: string;
  let adminId: string; // prints
  let subjectId: string; // the staff member who was assessed
  let templateId: string;
  let doneId: string; // COMPLETED assessment of subjectId
  let draftId: string; // INCOMPLETE assessment of a third user
  let ownId: string; // COMPLETED assessment OF adminId
  let otherTenantAcr: string;

  const q = async (sql: string, p: unknown[]) => (await ds.query(sql, p))[0].id as string;
  const admin = () => ({ tenantId, userId: adminId, role: 'ADMIN' });
  const dto = (ids: string[]) =>
    ({ template_id: templateId, subject_type: 'ACR', subject_ids: ids }) as any;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get(DataSource);
    const audit: any = { record: async () => undefined };
    jobs = new PrintJobsService(ds, { get: async (k: string) => ({ body: k }) } as any, audit);
    history = new PrintHistoryService(ds, audit);
    verify = new PublicVerifyService(ds);
  });

  afterAll(async () => {
    await ds.destroy();
  });

  /** One tenant with a 25-criterion form and a completed ACR for `userId`. */
  async function seedTenant(label: string) {
    const t = await q(`INSERT INTO schools (name, slug) VALUES ($1, $2) RETURNING id`, [
      `${label} ${randomUUID()}`,
      `${label}-${randomUUID()}`,
    ]);
    const user = (name: string) =>
      q(`INSERT INTO users (full_name, email) VALUES ($1, $2) RETURNING id`, [
        name,
        `acr-${randomUUID()}@example.com`,
      ]);
    const year = await q(
      `INSERT INTO academic_years (name, start_date, end_date, tenant_id)
       VALUES ('2026', '2026-01-01', '2026-12-31', $1) RETURNING id`,
      [t],
    );
    const assessor = await user('Assessor');
    const form = await q(
      `INSERT INTO acr_form_versions (tenant_id, version, created_by) VALUES ($1, 1, $2) RETURNING id`,
      [t, assessor],
    );
    const criteria: string[] = [];
    for (let i = 1; i <= 25; i++) {
      criteria.push(
        await q(
          `INSERT INTO acr_criteria (tenant_id, form_version_id, block, code, label_en, label_bn, sort_order)
           VALUES ($1, $2, 'BLOCK_2', $3, $4, $5, $6) RETURNING id`,
          [t, form, `B2_${i}`, `Criterion ${i}`, `মানদণ্ড ${i}`, i],
        ),
      );
    }
    const assessment = async (userId: string, status: string) => {
      const id = await q(
        `INSERT INTO acr_assessments (tenant_id, user_id, academic_year_id, form_version_id, status, total,
                                      assessed_by, completed_at)
         VALUES ($1, $2, $3, $4, $5::varchar, 82, $6, CASE WHEN $5::varchar = 'COMPLETED' THEN now() END) RETURNING id`,
        [t, userId, year, form, status, assessor],
      );
      for (const c of criteria) {
        await ds.query(
          `INSERT INTO acr_scores (tenant_id, assessment_id, criterion_id, score) VALUES ($1, $2, $3, 3)`,
          [t, id, c],
        );
      }
      return id;
    };
    return { t, user, assessment };
  }

  beforeEach(async () => {
    const a = await seedTenant('acr');
    tenantId = a.t;
    adminId = await a.user('Admin Printer');
    subjectId = await a.user('Fatema Subject');
    doneId = await a.assessment(subjectId, 'COMPLETED');
    draftId = await a.assessment(await a.user('Draft Person'), 'INCOMPLETE');
    ownId = await a.assessment(adminId, 'COMPLETED');
    templateId = await q(
      `INSERT INTO print_templates (tenant_id, document_kind, name, batch_size, draft)
       VALUES ($1, 'ACR_ASSESSMENT', 'ACR A4', 10, '{}'::jsonb) RETURNING id`,
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
    const b = await seedTenant('acr-other');
    otherTenantAcr = await b.assessment(await b.user('Other Staff'), 'COMPLETED');
  });

  it('ADMIN prints a completed ACR: total and every criterion land in the values, rows carry tenant_id, no verify QR', async () => {
    const res = await jobs.create(admin(), dto([doneId]));
    const item = res.items[0] as any;
    expect(item.values['acr.total']).toBe('82');
    expect(item.values).not.toHaveProperty('print.verify_qr');
    expect(item.verify_url).toBeUndefined();
    expect(item.values['staff.name']).toBe('Fatema Subject');
    for (let i = 1; i <= 25; i++) {
      expect(item.values[`acr.criterion.${i}.label`]).toBe(`Criterion ${i}`);
      expect(item.values[`acr.criterion.${i}.score`]).toBe('3');
    }
    const [job] = await ds.query(`SELECT tenant_id FROM print_jobs WHERE id = $1`, [res.job_id]);
    const [row] = await ds.query(`SELECT tenant_id FROM print_job_items WHERE id = $1`, [
      item.item_id,
    ]);
    expect(job.tenant_id).toBe(tenantId);
    expect(row.tenant_id).toBe(tenantId);
  });

  it('preview also resolves for ADMIN', async () => {
    const res = await jobs.preview(admin(), dto([doneId]));
    expect(res.items[0].values['acr.total']).toBe('82');
  });

  it('ACCOUNTANT (DOCUMENT_PRINT but no ACR_READ) is refused with 403', async () => {
    const acct = { tenantId, userId: randomUUID(), role: 'ACCOUNTANT' };
    await expect(jobs.preview(acct, dto([doneId]))).rejects.toThrow(/ACR_READ/);
    await expect(jobs.create(acct, dto([doneId]))).rejects.toThrow(/ACR_READ/);
  });

  it('the subject themself gets 404 (preview and create)', async () => {
    const self = { tenantId, userId: subjectId, role: 'ADMIN' };
    await expect(jobs.preview(self, dto([doneId]))).rejects.toThrow(/Subject not found/);
    await expect(jobs.create(self, dto([doneId]))).rejects.toThrow(/Subject not found/);
  });

  it('an INCOMPLETE ACR is refused with 409', async () => {
    await expect(jobs.create(admin(), dto([draftId]))).rejects.toThrow(/not completed/);
  });

  it("another tenant's ACR is a 404", async () => {
    await expect(jobs.create(admin(), dto([otherTenantAcr]))).rejects.toThrow(/Subject not found/);
  });

  it('a reprint by the subject (or of a now-own ACR) is a 404', async () => {
    const res = await jobs.create(admin(), dto([doneId]));
    const self = { tenantId, userId: subjectId, role: 'ADMIN' };
    await expect(jobs.reprint(self, res.job_id, [(res.items[0] as any).item_id])).rejects.toThrow(
      /Subject not found/,
    );
    // The legitimate printer can still reprint.
    await expect(
      jobs.reprint(admin(), res.job_id, [(res.items[0] as any).item_id]),
    ).resolves.toBeTruthy();
  });

  it('a reprint is refused (409) once the ACR was reopened and completed again', async () => {
    const res = await jobs.create(admin(), dto([doneId]));
    const itemId = (res.items[0] as any).item_id;
    await ds.query(
      `UPDATE acr_assessments SET completed_at = now() + interval '1 minute' WHERE id = $1`,
      [doneId],
    );
    await expect(jobs.reprint(admin(), res.job_id, [itemId])).rejects.toThrow(/changed after/);
  });

  describe('history and public verify', () => {
    let itemId: string;
    let token: string;
    beforeEach(async () => {
      const res = await jobs.create(admin(), dto([doneId]));
      itemId = (res.items[0] as any).item_id;
      // ACR hands out no verify URL; plant a known token to prove the public page still refuses it.
      expect((res.items[0] as any).verify_url).toBeUndefined();
      token = 'known-acr-token';
      await ds.query(`UPDATE print_job_items SET verify_token_hash = $1 WHERE id = $2`, [
        hashSecret(token),
        itemId,
      ]);
    });
    const exec = () => ({ tenantId, userId: randomUUID(), role: 'EXECUTIVE' });
    const query = (over = {}) => ({ page: 1, limit: 50, ...over }) as any;

    it('EXECUTIVE (PRINT_HISTORY_READ, no ACR_READ) neither lists nor opens ACR rows', async () => {
      const list = await history.list(exec(), query());
      expect(list.data.filter((r: any) => r.document_kind === 'ACR_ASSESSMENT')).toHaveLength(0);
      await expect(history.getItem(exec(), itemId)).rejects.toThrow(/not found/);
      expect(await history.subjectHistory(exec(), 'ACR', doneId)).toHaveLength(0);
      await expect(history.revoke(exec(), itemId, 'x')).rejects.toThrow(/not found/);
    });

    it('ADMIN sees the row; the subject themself sees nothing and cannot revoke', async () => {
      const list = await history.list(admin(), query());
      expect(list.data.map((r: any) => r.item_id)).toContain(itemId);
      expect((await history.getItem(admin(), itemId)).data_snapshot).toBeTruthy();

      const self = { tenantId, userId: subjectId, role: 'ADMIN' };
      const mine = await history.list(self, query());
      expect(mine.data.map((r: any) => r.item_id)).not.toContain(itemId);
      await expect(history.getItem(self, itemId)).rejects.toThrow(/not found/);
      expect(await history.subjectHistory(self, 'ACR', doneId)).toHaveLength(0);
      await expect(history.revoke(self, itemId, 'x')).rejects.toThrow(/not found/);
      // still unrevoked
      const [row] = await ds.query(`SELECT revoked_at FROM print_job_items WHERE id = $1`, [
        itemId,
      ]);
      expect(row.revoked_at).toBeNull();
    });

    it('the public verify page 404s for an ACR token', async () => {
      await expect(verify.verify(token)).rejects.toThrow(/could not find/);
    });
  });
});

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { RESOLVERS } from '../catalog/field-resolver';
import { PrintJobsService } from './print-jobs.service';

describe('PrintJobsService (integration)', () => {
  let ds: DataSource;
  let svc: PrintJobsService;
  let tenantId: string;
  let userId: string;
  let studentId: string;
  let templateId: string;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get(DataSource);
    svc = new PrintJobsService(
      ds,
      { get: async (k: string) => ({ body: k }) } as any,
      { record: async () => undefined } as any,
    );
  });

  // The suite's setup wipes tenant data before every test, so seed per test.
  beforeEach(async () => {
    const q = async (sql: string, p: unknown[]) => (await ds.query(sql, p))[0].id as string;
    tenantId = await q(`INSERT INTO schools (name, slug) VALUES ($1, $2) RETURNING id`, [
      `PJ ${randomUUID()}`,
      `pj-${randomUUID()}`,
    ]);
    userId = await q(`INSERT INTO users (full_name, email) VALUES ('Printer', $1) RETURNING id`, [
      `pj-${randomUUID()}@example.com`,
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
    studentId = await q(
      `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id)
       VALUES ('Rahim', 'R-1', 1, $1, $2) RETURNING id`,
      [section, tenantId],
    );
    await ds.query(
      `INSERT INTO enrollments (student_id, class_id, section_id, academic_year_id, tenant_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [studentId, cls, section, year, tenantId],
    );
    templateId = await q(
      `INSERT INTO print_templates (tenant_id, document_kind, name, batch_size, draft)
       VALUES ($1, 'STUDENT_ID_CARD', 'T', 10, '{}'::jsonb) RETURNING id`,
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

  const dto = () =>
    ({ template_id: templateId, subject_type: 'STUDENT', subject_ids: [studentId] }) as any;
  const caller = () => ({ tenantId, userId, role: 'ADMIN' });

  it('two concurrent creates for the same student get copy numbers 1 and 2', async () => {
    const [a, b] = await Promise.all([svc.create(caller(), dto()), svc.create(caller(), dto())]);
    const copies = [a.items[0].copy_number, b.items[0].copy_number].sort();
    expect(copies).toEqual([1, 2]);
  });

  it('commits the job and items with a snapshot matching the DB, and never stores the raw token', async () => {
    const res = await svc.create(caller(), dto());
    const item = res.items[0] as any;

    // Committed before we could render: readable from a different connection.
    const [row] = await ds.query(`SELECT * FROM print_job_items WHERE id = $1 AND job_id = $2`, [
      item.item_id,
      res.job_id,
    ]);
    expect(row.copy_number).toBe(1);
    expect(row.data_snapshot.values['student.name']).toBe('Rahim');
    expect(row.data_snapshot.values['student.class']).toBe('Class 8');
    expect(row.data_snapshot.copyNumber).toBe(1);

    // Only the hash is stored; the raw token is only in the create response.
    const token = item.verify_url.slice('/v/'.length);
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row.verify_token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('picks one ACTIVE enrollment deterministically when a student has two (current year wins)', async () => {
    const q = async (sql: string, p: unknown[]) => (await ds.query(sql, p))[0].id as string;
    const year2 = await q(
      `INSERT INTO academic_years (name, start_date, end_date, tenant_id, is_current)
       VALUES ('2028', '2028-01-01', '2028-12-31', $1, true) RETURNING id`,
      [tenantId],
    );
    const cls9 = await q(
      `INSERT INTO classes (name, academic_year_id, tenant_id) VALUES ('Class 9', $1, $2) RETURNING id`,
      [year2, tenantId],
    );
    await ds.query(
      `INSERT INTO enrollments (student_id, class_id, academic_year_id, tenant_id)
       VALUES ($1, $2, $3, $4)`,
      [studentId, cls9, year2, tenantId],
    );
    const out = await RESOLVERS.STUDENT_ID_CARD.resolve(tenantId, [studentId], ds.manager);
    expect(out.size).toBe(1);
    expect(out.get(studentId)!.values['student.class']).toBe('Class 9');
    expect(out.get(studentId)!.values['card.valid_until']).toBe('2028-12-31');
  });

  it('resolves staff-role members only, not a PARENT of the same tenant', async () => {
    const q = async (sql: string, p: unknown[]) => (await ds.query(sql, p))[0].id as string;
    const parentId = await q(
      `INSERT INTO users (full_name, email) VALUES ('Parent', $1) RETURNING id`,
      [`pj-${randomUUID()}@example.com`],
    );
    await ds.query(`INSERT INTO user_tenants (user_id, tenant_id, role) VALUES ($1, $2, 'ADMIN')`, [
      userId,
      tenantId,
    ]);
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role) VALUES ($1, $2, 'PARENT')`,
      [parentId, tenantId],
    );
    const out = await RESOLVERS.STAFF_ID_CARD.resolve(tenantId, [userId, parentId], ds.manager);
    expect([...out.keys()]).toEqual([userId]);
  });

  describe('photo key binding', () => {
    const current = () => `tenants/${tenantId}/students/current.jpg`;
    const asAdmin = () => caller();

    it('serves the current key, rejects any other key, rejects a foreign-tenant key', async () => {
      await ds.query(`UPDATE students SET photo_key = $1 WHERE id = $2`, [current(), studentId]);
      await expect(svc.photo(asAdmin(), 'STUDENT', studentId, current())).resolves.toBeTruthy();
      // A real key of the same tenant that is not this student's photo.
      await expect(
        svc.photo(asAdmin(), 'STUDENT', studentId, `tenants/${tenantId}/logo/x.png`),
      ).rejects.toThrow(/Photo not found/);
      // A key that belongs to another tenant.
      await expect(
        svc.photo(asAdmin(), 'STUDENT', studentId, `tenants/${randomUUID()}/students/a.jpg`),
      ).rejects.toThrow(/Invalid photo key/);
    });

    it('still serves an old key once a job snapshot froze it, after the photo is replaced', async () => {
      await ds.query(`UPDATE students SET photo_key = $1 WHERE id = $2`, [current(), studentId]);
      await svc.create(caller(), dto()); // snapshot freezes photoKey = current()
      const replaced = `tenants/${tenantId}/students/new.jpg`;
      await ds.query(`UPDATE students SET photo_key = $1 WHERE id = $2`, [replaced, studentId]);
      await expect(svc.photo(asAdmin(), 'STUDENT', studentId, current())).resolves.toBeTruthy();
      await expect(svc.photo(asAdmin(), 'STUDENT', studentId, replaced)).resolves.toBeTruthy();
    });

    it('rejects a photo request for a subject of another tenant', async () => {
      await ds.query(`UPDATE students SET photo_key = $1 WHERE id = $2`, [current(), studentId]);
      const other = { tenantId: randomUUID(), userId, role: 'ADMIN' };
      await expect(
        svc.photo(other, 'STUDENT', studentId, `tenants/${other.tenantId}/x.jpg`),
      ).rejects.toThrow(/Subject not found/);
    });
  });
});

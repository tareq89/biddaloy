import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { PrintJobsService } from '../jobs/print-jobs.service';
import { FamilyAdmitCardService } from './family-admit-card.service';

describe('FamilyAdmitCardService (integration)', () => {
  let ds: DataSource;
  let service: FamilyAdmitCardService;
  let withhold = false;
  const getDueSnapshots = vi.fn();

  let tenantId: string;
  let userId: string;
  let examId: string;
  let studentId: string;
  let planId: string;
  let sittingId: string;
  let roomId: string;
  let cls: string;
  let year: string;

  const q = async (sql: string, p: unknown[]) => (await ds.query(sql, p))[0].id as string;
  const parent = () => ({ id: tenantId, role: 'PARENT' });
  const itemCount = async () =>
    Number((await ds.query(`SELECT count(*) FROM print_job_items`, []))[0].count);

  beforeAll(async () => {
    ds = (await createTestModule(ALL_ENTITIES, [])).get(DataSource);
    const settings: any = {
      documentsSettings: async () => ({ withholdAdmitCardForDues: withhold }),
    };
    const jobs = new PrintJobsService(
      ds,
      { get: async (k: string) => ({ body: k }) } as any,
      { record: async () => undefined } as any,
      settings,
    );
    service = new FamilyAdmitCardService(ds, jobs, { getDueSnapshots } as any, settings);
  });

  afterAll(async () => {
    await ds.destroy();
  });

  /** A published default EXAM_ADMIT_CARD template (kind configurable, to prove lookup is by kind). */
  const template = async (kind = 'EXAM_ADMIT_CARD', isDefault = true) => {
    const id = await q(
      `INSERT INTO print_templates (tenant_id, document_kind, name, batch_size, draft, is_default)
       VALUES ($1, $2, $3, 10, '{}'::jsonb, $4) RETURNING id`,
      [tenantId, kind, `T-${randomUUID()}`, isDefault],
    );
    const v = await q(
      `INSERT INTO print_template_versions (tenant_id, template_id, version, definition)
       VALUES ($1, $2, 1, '{}'::jsonb) RETURNING id`,
      [tenantId, id],
    );
    await ds.query(`UPDATE print_templates SET current_version_id = $1 WHERE id = $2`, [v, id]);
    return id;
  };

  const seed = async () => {
    const t = await q(`INSERT INTO schools (name, slug) VALUES ($1, $2) RETURNING id`, [
      `FA ${randomUUID()}`,
      `fa-${randomUUID()}`,
    ]);
    return t;
  };

  beforeEach(async () => {
    withhold = false;
    getDueSnapshots.mockReset();
    tenantId = await seed();
    userId = await q(`INSERT INTO users (full_name, email) VALUES ('Mum', $1) RETURNING id`, [
      `fa-${randomUUID()}@example.com`,
    ]);
    year = await q(
      `INSERT INTO academic_years (name, start_date, end_date, tenant_id)
       VALUES ('2027', '2027-01-01', '2027-12-31', $1) RETURNING id`,
      [tenantId],
    );
    cls = await q(
      `INSERT INTO classes (name, academic_year_id, tenant_id) VALUES ('Class 8', $1, $2) RETURNING id`,
      [year, tenantId],
    );
    examId = await q(
      `INSERT INTO exams (academic_year_id, class_id, name, kind, status, tenant_id)
       VALUES ($1, $2, 'Half-Yearly', 'TERM', 'PROCESSED', $3) RETURNING id`,
      [year, cls, tenantId],
    );
    const subject = await q(
      `INSERT INTO subjects (tenant_id, name_en, code) VALUES ($1, 'Maths', 'M') RETURNING id`,
      [tenantId],
    );
    sittingId = await q(
      `INSERT INTO exam_schedules (tenant_id, exam_id, subject_id, date, starts_at, ends_at)
       VALUES ($1, $2, $3, '2027-03-01', '10:00', '13:00') RETURNING id`,
      [tenantId, examId, subject],
    );
    roomId = await q(`INSERT INTO rooms (tenant_id, room_no) VALUES ($1, '101') RETURNING id`, [
      tenantId,
    ]);
    planId = await q(
      `INSERT INTO seat_plans (tenant_id, name, status, seat_order_mode)
       VALUES ($1, 'Plan', 'PUBLISHED', 'SEQUENTIAL') RETURNING id`,
      [tenantId],
    );
    const section = await q(
      `INSERT INTO class_sections (class_id, section_name, tenant_id) VALUES ($1, 'A', $2) RETURNING id`,
      [cls, tenantId],
    );
    studentId = await q(
      `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id)
       VALUES ('Rahim', $1, 1, $2, $3) RETURNING id`,
      [`R-${randomUUID()}`, section, tenantId],
    );
    await ds.query(
      `INSERT INTO enrollments (student_id, class_id, section_id, academic_year_id, tenant_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [studentId, cls, section, year, tenantId],
    );
    await ds.query(
      `INSERT INTO seat_allocations (tenant_id, seat_plan_id, exam_schedule_id, student_id, room_id, seat_number)
       VALUES ($1, $2, $3, $4, $5, 'A-1')`,
      [tenantId, planId, sittingId, studentId, roomId],
    );
  });

  it('prints a CONFIRMED/OK copy for the exam; the second print is copy 2', async () => {
    await template();
    const first = await service.print(parent(), userId, studentId, examId);
    expect(first.items).toHaveLength(1);
    expect(first.items[0].copy_number).toBe(1);
    const second = await service.print(parent(), userId, studentId, examId);
    expect(second.items[0].copy_number).toBe(2);

    const [job] = await ds.query(`SELECT status, batch_label FROM print_jobs WHERE id = $1`, [
      first.job_id,
    ]);
    expect(job).toMatchObject({ status: 'CONFIRMED', batch_label: 'portal' });
    const [item] = await ds.query(
      `SELECT outcome, context_type, context_id FROM print_job_items WHERE id = $1`,
      [first.items[0].item_id],
    );
    expect(item).toMatchObject({ outcome: 'OK', context_type: 'EXAM', context_id: examId });
  });

  it('rewrites the photo to the family-readable student photo route', async () => {
    await template();
    await ds.query(`UPDATE students SET photo_key = $1 WHERE id = $2`, [
      `tenants/${tenantId}/students/${studentId}/p.jpg`,
      studentId,
    ]);
    const res = await service.print(parent(), userId, studentId, examId);
    expect(res.items[0].photo_url).toBe(`/students/${studentId}/photo`);
  });

  describe('D9 dues block', () => {
    it('setting ON + the student owes: 409 ADMIT_CARD_WITHHELD and no job row', async () => {
      await template();
      withhold = true;
      getDueSnapshots.mockResolvedValue(new Map([[studentId, { total_due: 500 }]]));
      await expect(service.print(parent(), userId, studentId, examId)).rejects.toMatchObject({
        response: { details: { code: 'ADMIT_CARD_WITHHELD' } },
      });
      expect(await itemCount()).toBe(0);
      expect((await ds.query(`SELECT 1 FROM print_jobs`, [])).length).toBe(0);
    });

    it('setting ON + nothing owed: prints', async () => {
      await template();
      withhold = true;
      getDueSnapshots.mockResolvedValue(new Map([[studentId, { total_due: 0 }]]));
      const res = await service.print(parent(), userId, studentId, examId);
      expect(res.items).toHaveLength(1);
    });

    it('setting OFF + the same fee: prints, and dues are never read', async () => {
      await template();
      getDueSnapshots.mockResolvedValue(new Map([[studentId, { total_due: 500 }]]));
      const res = await service.print(parent(), userId, studentId, examId);
      expect(res.items).toHaveLength(1);
      expect(getDueSnapshots).not.toHaveBeenCalled();
    });
  });

  it('404s while the seat plan is still DRAFT', async () => {
    await template();
    await ds.query(`UPDATE seat_plans SET status = 'DRAFT' WHERE id = $1`, [planId]);
    await expect(service.print(parent(), userId, studentId, examId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('404s when the student has no seat in the plan', async () => {
    await template();
    await ds.query(`DELETE FROM seat_allocations WHERE student_id = $1`, [studentId]);
    await expect(service.print(parent(), userId, studentId, examId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('409 NO_ADMIT_CARD_TEMPLATE without a default admit-card template', async () => {
    await template('EXAM_ADMIT_CARD', false); // exists but is not the default
    await expect(service.print(parent(), userId, studentId, examId)).rejects.toMatchObject({
      response: { details: { code: 'NO_ADMIT_CARD_TEMPLATE' } },
    });
    expect(await itemCount()).toBe(0);
  });

  it('only a non-admit default present (staff card / TC): 409, never printed', async () => {
    await template('STUDENT_ID_CARD');
    await template('TRANSFER_CERTIFICATE');
    await expect(service.print(parent(), userId, studentId, examId)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(await itemCount()).toBe(0);
  });

  it('403 FAMILY_ONLY for a staff role, before anything is read', async () => {
    await template();
    await expect(
      service.print({ id: tenantId, role: 'TEACHER' }, userId, studentId, examId),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(await itemCount()).toBe(0);
  });

  it("another tenant's student/exam ids 404 and write nothing", async () => {
    await template();
    const other = await seed();
    await expect(
      service.print({ id: other, role: 'PARENT' }, userId, studentId, examId),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(await itemCount()).toBe(0);
  });
});

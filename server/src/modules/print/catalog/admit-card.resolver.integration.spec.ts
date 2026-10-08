import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { NotFoundException } from '@nestjs/common';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { AdmitCardResolver } from './admit-card.resolver';

describe('AdmitCardResolver (integration)', () => {
  let ds: DataSource;
  const resolver = new AdmitCardResolver();

  let tenantId: string;
  let year: string;
  let cls: string;
  let examId: string;
  let studentId: string;
  let planId: string;
  let sittings: string[]; // exam_schedule ids, in date order
  let rooms: string[];

  const q = async (sql: string, p: unknown[]) => (await ds.query(sql, p))[0].id as string;
  const ctx = () => ({ type: 'EXAM' as const, id: examId });

  async function newTenant() {
    return q(`INSERT INTO schools (name, slug) VALUES ($1, $2) RETURNING id`, [
      `AC ${randomUUID()}`,
      `ac-${randomUUID()}`,
    ]);
  }
  async function newStudent(name: string, classId: string, tenant = tenantId, yearId = year) {
    const section = await q(
      `INSERT INTO class_sections (class_id, section_name, tenant_id) VALUES ($1, $2, $3) RETURNING id`,
      [classId, `S-${randomUUID().slice(0, 8)}`, tenant],
    );
    const id = await q(
      `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id)
       VALUES ($1, $2, 1, $3, $4) RETURNING id`,
      [name, `R-${randomUUID()}`, section, tenant],
    );
    await ds.query(
      `INSERT INTO enrollments (student_id, class_id, section_id, academic_year_id, tenant_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, classId, section, yearId, tenant],
    );
    return id;
  }
  async function allocate(sittingId: string, studentRef: string, room: string, seat: string) {
    await ds.query(
      `INSERT INTO seat_allocations (tenant_id, seat_plan_id, exam_schedule_id, student_id, room_id, seat_number)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [tenantId, planId, sittingId, studentRef, room, seat],
    );
  }
  const setPlanStatus = (status: string) =>
    ds.query(`UPDATE seat_plans SET status = $1 WHERE id = $2`, [status, planId]);

  beforeAll(async () => {
    ds = (await createTestModule(ALL_ENTITIES, [])).get(DataSource);
  });

  // The suite's setup wipes tenant data before every test, so seed per test.
  beforeEach(async () => {
    tenantId = await newTenant();
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
      `INSERT INTO exams (academic_year_id, class_id, name, kind, status, tenant_id, created_at, updated_at)
       VALUES ($1, $2, 'Half-Yearly', 'TERM', 'DRAFT', $3, NOW(), NOW()) RETURNING id`,
      [year, cls, tenantId],
    );
    const dates = ['2027-03-01', '2027-03-02', '2027-03-03'];
    sittings = [];
    for (const [i, d] of dates.entries()) {
      const subject = await q(
        `INSERT INTO subjects (tenant_id, name_en, code) VALUES ($1, $2, $3) RETURNING id`,
        [tenantId, `Subject ${i + 1}`, `S${i + 1}`],
      );
      sittings.push(
        await q(
          `INSERT INTO exam_schedules (tenant_id, exam_id, subject_id, date, starts_at, ends_at)
           VALUES ($1, $2, $3, $4, '10:00', '13:00') RETURNING id`,
          [tenantId, examId, subject, d],
        ),
      );
    }
    rooms = [];
    for (const no of ['101', '102']) {
      rooms.push(
        await q(`INSERT INTO rooms (tenant_id, room_no) VALUES ($1, $2) RETURNING id`, [
          tenantId,
          no,
        ]),
      );
    }
    planId = await q(
      `INSERT INTO seat_plans (tenant_id, name, status, seat_order_mode)
       VALUES ($1, 'Plan', 'PUBLISHED', 'SEQUENTIAL') RETURNING id`,
      [tenantId],
    );
    studentId = await newStudent('Rahim', cls);
  });

  afterAll(async () => {
    await ds.destroy();
  });

  it('gives each sitting its allocated room and seat when the plan is PUBLISHED', async () => {
    await allocate(sittings[0], studentId, rooms[0], 'A-1');
    await allocate(sittings[1], studentId, rooms[1], 'B-2');
    // Third sitting has no allocation => student not seated for it, so it is not listed.
    const v = (await resolver.resolve(tenantId, [studentId], ds.manager, undefined, ctx())).get(
      studentId,
    )!.values;
    expect(v['student.name']).toBe('Rahim');
    expect(v['exam.name']).toBe('Half-Yearly');
    expect(v['exam.year']).toBe('2027');
    expect(v['exam.sitting.1.room']).toBe('101');
    expect(v['exam.sitting.1.seat']).toBe('A-1');
    expect(v['exam.sitting.2.room']).toBe('102');
    expect(v['exam.sitting.2.seat']).toBe('B-2');
    expect(v['exam.sitting.3.subject']).toBe('');
  });

  it('lists every sitting with empty room and seat while the plan is still DRAFT', async () => {
    await allocate(sittings[0], studentId, rooms[0], 'A-1');
    await setPlanStatus('DRAFT');
    const v = (await resolver.resolve(tenantId, [studentId], ds.manager, undefined, ctx())).get(
      studentId,
    )!.values;
    expect(v['exam.sitting.3.subject']).toBe('Subject 3');
    expect(v['exam.sitting.1.room']).toBe('');
    expect(v['exam.sitting.1.seat']).toBe('');
    expect(v['seat.room']).toBe('');
  });

  it('lists only the sitting a student is allocated to (optional subject)', async () => {
    await allocate(sittings[1], studentId, rooms[0], 'A-1');
    const v = (await resolver.resolve(tenantId, [studentId], ds.manager, undefined, ctx())).get(
      studentId,
    )!.values;
    expect(v['exam.sitting.1.subject']).toBe('Subject 2');
    expect(v['exam.sitting.2.subject']).toBe('');
    expect(v['seat.room']).toBe('101');
  });

  it('never resolves a student of another class, a soft-deleted one, or another tenant', async () => {
    const otherCls = await q(
      `INSERT INTO classes (name, academic_year_id, tenant_id) VALUES ('Class 9', $1, $2) RETURNING id`,
      [year, tenantId],
    );
    const otherClassStudent = await newStudent('Other class', otherCls);
    const deleted = await newStudent('Deleted', cls);
    await ds.query(`UPDATE students SET deleted_at = NOW() WHERE id = $1`, [deleted]);

    // Cross-tenant: a student in a second tenant, enrolled in that tenant's own class.
    const t2 = await newTenant();
    const y2 = await q(
      `INSERT INTO academic_years (name, start_date, end_date, tenant_id)
       VALUES ('2027', '2027-01-01', '2027-12-31', $1) RETURNING id`,
      [t2],
    );
    const c2 = await q(
      `INSERT INTO classes (name, academic_year_id, tenant_id) VALUES ('Class 8', $1, $2) RETURNING id`,
      [y2, t2],
    );
    const foreign = await newStudent('Foreign', c2, t2, y2);

    const out = await resolver.resolve(
      tenantId,
      [studentId, otherClassStudent, deleted, foreign],
      ds.manager,
      undefined,
      ctx(),
    );
    expect([...out.keys()]).toEqual([studentId]);
  });

  it('answers 404 for an exam id from another tenant', async () => {
    const t2 = await newTenant();
    await expect(
      resolver.resolve(t2, [studentId], ds.manager, undefined, ctx()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

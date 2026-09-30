import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import {
  SEED_TENANT_ID,
  SEED_ACADEMIC_YEAR_ID,
  SEED_CLASS_1_ID,
  SEED_SECTION_1_ID,
  SEED_SECTION_2_ID,
  SEED_ADMIN_USER_ID,
} from '@test/constants';
import { StudentLifecycleService } from './student-lifecycle.service';
import { EnrollmentService } from '../enrollments/enrollments.service';
import { AuditService } from '../audit/audit.service';
import { LeaveStudentDto, ReadmitStudentDto } from './dto/student-lifecycle.dto';

/**
 * [39.2.1] Real-DB integration spec for leave / readmit. Runs against the migrated
 * schema (no synchronize) so the `IDX_enr_active_student_year` index and the
 * audit_logs write-only trigger exist.
 */

const P = '39210000-0000-4000-8000-';
const Y2_ID = `${P}000000000001`;
const Y2_CLASS_ID = `${P}000000000002`;
const Y2_SECTION_ID = `${P}000000000003`;
const TENANT_B = `${P}0000000000b0`;
const B_YEAR = `${P}0000000000b1`;
const B_CLASS = `${P}0000000000b2`;
const B_SECTION = `${P}0000000000b3`;
const CTX = { ip: '127.0.0.1', userAgent: 'vitest' };
const USER = SEED_ADMIN_USER_ID;

describe('StudentLifecycleService (integration)', () => {
  let module: TestingModule;
  let ds: DataSource;
  let service: StudentLifecycleService;
  let audit: AuditService;
  let n = 0;

  beforeAll(async () => {
    module = await createTestModule(ALL_ENTITIES, [
      StudentLifecycleService,
      EnrollmentService,
      AuditService,
    ]);
    ds = module.get(DataSource);
    service = module.get(StudentLifecycleService);
    audit = module.get(AuditService);

    await ds.query(
      `INSERT INTO academic_years (id, name, start_date, end_date, is_current, tenant_id, created_at, updated_at)
       VALUES ($1, '2027', '2027-01-01', '2027-12-31', false, $2, NOW(), NOW())`,
      [Y2_ID, SEED_TENANT_ID],
    );
    await ds.query(
      `INSERT INTO classes (id, name, academic_year_id, tenant_id, created_at, updated_at)
       VALUES ($1, 'Y2 Class', $2, $3, NOW(), NOW())`,
      [Y2_CLASS_ID, Y2_ID, SEED_TENANT_ID],
    );
    await ds.query(
      `INSERT INTO class_sections (id, section_name, class_id, tenant_id, created_at, updated_at)
       VALUES ($1, 'Y2 A', $2, $3, NOW(), NOW())`,
      [Y2_SECTION_ID, Y2_CLASS_ID, SEED_TENANT_ID],
    );
    await ds.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at) VALUES ($1, 'School B', 'lc-school-b', NOW(), NOW())`,
      [TENANT_B],
    );
    await ds.query(
      `INSERT INTO academic_years (id, name, start_date, end_date, is_current, tenant_id, created_at, updated_at)
       VALUES ($1, 'B 2026', '2026-01-01', '2026-12-31', true, $2, NOW(), NOW())`,
      [B_YEAR, TENANT_B],
    );
    await ds.query(
      `INSERT INTO classes (id, name, academic_year_id, tenant_id, created_at, updated_at)
       VALUES ($1, 'B Class', $2, $3, NOW(), NOW())`,
      [B_CLASS, B_YEAR, TENANT_B],
    );
    await ds.query(
      `INSERT INTO class_sections (id, section_name, class_id, tenant_id, created_at, updated_at)
       VALUES ($1, 'B A', $2, $3, NOW(), NOW())`,
      [B_SECTION, B_CLASS, TENANT_B],
    );
  });

  afterAll(async () => {
    if (!ds) return;
    // Reference tables are reset per file; clear what is not covered and close.
    await ds.query(`DELETE FROM student_lifecycle_events WHERE tenant_id = $1`, [TENANT_B]);
    await ds.query(`DELETE FROM class_sections WHERE tenant_id = $1`, [TENANT_B]);
    await ds.query(`DELETE FROM classes WHERE tenant_id = $1`, [TENANT_B]);
    await ds.query(`DELETE FROM academic_years WHERE tenant_id = $1`, [TENANT_B]);
    await ds.query(`DELETE FROM schools WHERE id = $1`, [TENANT_B]);
    await module.close();
  });

  /** Global beforeEach wipes students/enrollments, so seed inside each test. */
  async function seedStudent(sectionId = SEED_SECTION_1_ID, classId = SEED_CLASS_1_ID) {
    n += 1;
    const [s] = await ds.query(
      `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, registration_number, roll_number`,
      [`LC ${n}`, `LC-${n}`, n, sectionId, SEED_TENANT_ID],
    );
    const [e] = await ds.query(
      `INSERT INTO enrollments (student_id, class_id, section_id, academic_year_id, enrollment_status, tenant_id)
       VALUES ($1, $2, $3, $4, 'ACTIVE', $5) RETURNING id`,
      [s.id, classId, sectionId, SEED_ACADEMIC_YEAR_ID, SEED_TENANT_ID],
    );
    return { studentId: s.id as string, enrollmentId: e.id as string, student: s };
  }

  const leaveDto = (over: Partial<LeaveStudentDto> = {}): LeaveStudentDto => ({
    type: 'WITHDRAWN',
    occurred_on: '2026-03-01',
    reason: 'moved away',
    ...over,
  });
  const readmitDto = (
    sectionId: string,
    over: Partial<ReadmitStudentDto> = {},
  ): ReadmitStudentDto => ({
    occurred_on: '2026-04-01',
    class_section_id: sectionId,
    ...over,
  });
  const q = (sql: string, params: unknown[] = []) => ds.query(sql, params);

  it('leave commits the event and the status change together', async () => {
    const { studentId, enrollmentId } = await seedStudent();
    await service.leave(
      studentId,
      leaveDto({ destination: 'Dhaka', remark: 'r' }),
      SEED_TENANT_ID,
      USER,
      CTX,
    );

    const events = await q(`SELECT * FROM student_lifecycle_events WHERE student_id = $1`, [
      studentId,
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      enrollment_id: enrollmentId,
      academic_year_id: SEED_ACADEMIC_YEAR_ID,
      event_type: 'WITHDRAWN',
      recorded_by_user_id: USER,
      destination: 'Dhaka',
    });
    const [enr] = await q(`SELECT enrollment_status FROM enrollments WHERE id = $1`, [
      enrollmentId,
    ]);
    expect(enr.enrollment_status).toBe('INACTIVE');
    const [stu] = await q(`SELECT enrollment_status FROM students WHERE id = $1`, [studentId]);
    expect(stu.enrollment_status).toBe('INACTIVE');
    const audits = await q(
      `SELECT entity_type, action FROM audit_logs WHERE entity_id IN ($1, $2) ORDER BY entity_type`,
      [studentId, enrollmentId],
    );
    expect(audits).toEqual([
      { entity_type: 'Enrollment', action: 'UPDATE' },
      { entity_type: 'Student', action: 'UPDATE' },
    ]);
  });

  it('a failure after the event insert rolls everything back', async () => {
    const { studentId, enrollmentId } = await seedStudent();
    vi.spyOn(audit, 'record').mockRejectedValueOnce(new Error('boom'));
    await expect(service.leave(studentId, leaveDto(), SEED_TENANT_ID, USER, CTX)).rejects.toThrow(
      'boom',
    );

    expect(
      await q(`SELECT 1 FROM student_lifecycle_events WHERE student_id = $1`, [studentId]),
    ).toHaveLength(0);
    const [enr] = await q(`SELECT enrollment_status FROM enrollments WHERE id = $1`, [
      enrollmentId,
    ]);
    expect(enr.enrollment_status).toBe('ACTIVE');
    const [stu] = await q(`SELECT enrollment_status FROM students WHERE id = $1`, [studentId]);
    expect(stu.enrollment_status).toBe('ACTIVE');
  });

  it('leave twice returns 409 the second time', async () => {
    const { studentId } = await seedStudent();
    await service.leave(studentId, leaveDto(), SEED_TENANT_ID, USER, CTX);
    await expect(
      service.leave(studentId, leaveDto(), SEED_TENANT_ID, USER, CTX),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('readmit in the same year reactivates the same enrollment row', async () => {
    const { studentId, enrollmentId, student } = await seedStudent();
    await service.leave(studentId, leaveDto(), SEED_TENANT_ID, USER, CTX);
    const event = await service.readmit(
      studentId,
      readmitDto(SEED_SECTION_1_ID),
      SEED_TENANT_ID,
      USER,
      CTX,
    );

    const enrs = await q(`SELECT id, enrollment_status FROM enrollments WHERE student_id = $1`, [
      studentId,
    ]);
    expect(enrs).toEqual([{ id: enrollmentId, enrollment_status: 'ACTIVE' }]);
    const [stu] = await q(
      `SELECT enrollment_status, registration_number, roll_number FROM students WHERE id = $1`,
      [studentId],
    );
    expect(stu).toEqual({
      enrollment_status: 'ACTIVE',
      registration_number: student.registration_number,
      roll_number: student.roll_number,
    });
    expect(event).toMatchObject({ event_type: 'READMITTED', enrollment_id: enrollmentId });
  });

  it('readmit in the same year into another section moves class, section and roll', async () => {
    // occupy roll 1 in section 2 so the next free roll is 2
    await seedStudent(SEED_SECTION_2_ID, '00000000-0000-4000-8000-000000000031');
    const { studentId, enrollmentId } = await seedStudent();
    await service.leave(studentId, leaveDto(), SEED_TENANT_ID, USER, CTX);
    await service.readmit(studentId, readmitDto(SEED_SECTION_2_ID), SEED_TENANT_ID, USER, CTX);

    const [enr] = await q(
      `SELECT class_id, section_id, enrollment_status FROM enrollments WHERE id = $1`,
      [enrollmentId],
    );
    expect(enr).toEqual({
      class_id: '00000000-0000-4000-8000-000000000031',
      section_id: SEED_SECTION_2_ID,
      enrollment_status: 'ACTIVE',
    });
    const [stu] = await q(`SELECT class_section_id, roll_number FROM students WHERE id = $1`, [
      studentId,
    ]);
    expect(stu.class_section_id).toBe(SEED_SECTION_2_ID);
    expect(stu.roll_number).toBeGreaterThanOrEqual(2);
    const [{ max }] = await q(
      `SELECT MAX(roll_number) AS max FROM students WHERE class_section_id = $1 AND id <> $2`,
      [SEED_SECTION_2_ID, studentId],
    );
    expect(stu.roll_number).toBe(max + 1);
  });

  it('readmit into another year creates a new enrollment', async () => {
    const { studentId, student } = await seedStudent();
    await service.leave(studentId, leaveDto(), SEED_TENANT_ID, USER, CTX);
    const event = await service.readmit(
      studentId,
      readmitDto(Y2_SECTION_ID),
      SEED_TENANT_ID,
      USER,
      CTX,
    );

    const enrs = await q(
      `SELECT academic_year_id, enrollment_status FROM enrollments WHERE student_id = $1 ORDER BY academic_year_id`,
      [studentId],
    );
    expect(enrs).toHaveLength(2);
    expect(enrs).toContainEqual({
      academic_year_id: SEED_ACADEMIC_YEAR_ID,
      enrollment_status: 'INACTIVE',
    });
    expect(enrs).toContainEqual({ academic_year_id: Y2_ID, enrollment_status: 'ACTIVE' });
    expect(event.academic_year_id).toBe(Y2_ID);
    const creates = await q(
      `SELECT 1 FROM audit_logs WHERE entity_type = 'Enrollment' AND action = 'CREATE' AND entity_id = $1`,
      [event.enrollment_id],
    );
    expect(creates).toHaveLength(1);
    const [stu] = await q(`SELECT registration_number FROM students WHERE id = $1`, [studentId]);
    expect(stu.registration_number).toBe(student.registration_number);
  });

  it('keeps at most one ACTIVE enrollment per student and year', async () => {
    const { studentId } = await seedStudent();
    await q(
      `INSERT INTO enrollments (student_id, class_id, section_id, academic_year_id, enrollment_status, tenant_id)
       VALUES ($1, $2, $3, $4, 'ACTIVE', $5)`,
      [studentId, Y2_CLASS_ID, Y2_SECTION_ID, Y2_ID, SEED_TENANT_ID],
    );
    await service.leave(studentId, leaveDto(), SEED_TENANT_ID, USER, CTX); // closes latest year (Y2)
    await expect(
      service.readmit(studentId, readmitDto(SEED_SECTION_1_ID), SEED_TENANT_ID, USER, CTX),
    ).rejects.toBeInstanceOf(ConflictException);

    const readmits = await q(
      `SELECT 1 FROM student_lifecycle_events WHERE student_id = $1 AND event_type = 'READMITTED'`,
      [studentId],
    );
    expect(readmits).toHaveLength(0);
    const dupes = await q(
      `SELECT academic_year_id FROM enrollments WHERE student_id = $1 AND enrollment_status = 'ACTIVE'
       GROUP BY academic_year_id HAVING COUNT(*) > 1`,
      [studentId],
    );
    expect(dupes).toHaveLength(0);
  });

  it('isolates tenants', async () => {
    const { studentId } = await seedStudent();
    await expect(service.leave(studentId, leaveDto(), TENANT_B, USER, CTX)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      service.readmit(studentId, readmitDto(SEED_SECTION_1_ID), TENANT_B, USER, CTX),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.listEvents(studentId, TENANT_B)).rejects.toBeInstanceOf(NotFoundException);

    // tenant A's student cannot be readmitted into tenant B's section
    await service.leave(studentId, leaveDto(), SEED_TENANT_ID, USER, CTX);
    await expect(
      service.readmit(studentId, readmitDto(B_SECTION), SEED_TENANT_ID, USER, CTX),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a student who left is not in the fee-generation audience', async () => {
    const { studentId } = await seedStudent();
    // Same predicate as fees/fee-generation.service.ts:789 (and :869 for explicit lists).
    const audienceSql = `SELECT id FROM students WHERE tenant_id = $1 AND deleted_at IS NULL AND enrollment_status = 'ACTIVE'`;
    expect((await q(audienceSql, [SEED_TENANT_ID])).map((r: { id: string }) => r.id)).toContain(
      studentId,
    );
    await service.leave(studentId, leaveDto(), SEED_TENANT_ID, USER, CTX);
    expect((await q(audienceSql, [SEED_TENANT_ID])).map((r: { id: string }) => r.id)).not.toContain(
      studentId,
    );
  });

  it('listEvents returns newest occurred_on first', async () => {
    const { studentId } = await seedStudent();
    await service.leave(
      studentId,
      leaveDto({ occurred_on: '2026-03-01' }),
      SEED_TENANT_ID,
      USER,
      CTX,
    );
    await service.readmit(
      studentId,
      readmitDto(SEED_SECTION_1_ID, { occurred_on: '2026-05-01' }),
      SEED_TENANT_ID,
      USER,
      CTX,
    );
    const events = await service.listEvents(studentId, SEED_TENANT_ID);
    expect(events.map((e) => e.event_type)).toEqual(['READMITTED', 'WITHDRAWN']);
  });
});

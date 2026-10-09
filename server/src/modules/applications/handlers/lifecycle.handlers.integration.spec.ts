import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
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
import { ApplicationsModule } from '../applications.module';
import { AuthModule } from '../../auth/auth.module';
import { ReadmissionHandler } from './readmission.handler';
import { SectionChangeHandler } from './section-change.handler';
import { TransferCertificateHandler } from './transfer-certificate.handler';
import type { Application } from '../entities/application.entity';
import type { ApplicationEffectContext } from '../application-types';

/**
 * [52.3.3] READMISSION / SECTION_CHANGE / TRANSFER_CERTIFICATE handlers against a real DB.
 * Every call runs inside `dataSource.transaction`, the way the decision service will call it.
 */
const P = '52330000-0000-4000-8000-';
const Y2_ID = `${P}000000000001`;
const Y2_CLASS_ID = `${P}000000000002`;
const Y2_SECTION_ID = `${P}000000000003`;
const TENANT_B = `${P}0000000000b0`;

describe('lifecycle handlers (integration)', () => {
  let ds: DataSource;
  let readmission: ReadmissionHandler;
  let sectionChange: SectionChangeHandler;
  let transfer: TransferCertificateHandler;
  let n = 0;

  const ctxFor = (tenantId: string) =>
    ({
      tenantId,
      actorUserId: SEED_ADMIN_USER_ID,
      req: { ip: '127.0.0.1', headers: { 'user-agent': 'vitest' } },
    }) as unknown as ApplicationEffectContext;
  const ctxA = ctxFor(SEED_TENANT_ID);
  const ctxB = ctxFor(TENANT_B);

  const q = (sql: string, params: unknown[] = []) => ds.query(sql, params);
  const appFor = (studentId: string, payload: Record<string, unknown>) =>
    ({ id: `${P}0000000000aa`, subject_student_id: studentId, payload }) as unknown as Application;
  const day = (offset: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };

  /** The global beforeEach wipes students/enrollments, so seed inside each test. */
  async function seedStudent(status = 'ACTIVE') {
    n += 1;
    const [s] = await q(
      `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, enrollment_status, tenant_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [`LH ${n}`, `LH-${n}`, n, SEED_SECTION_1_ID, status, SEED_TENANT_ID],
    );
    const [e] = await q(
      `INSERT INTO enrollments (student_id, class_id, section_id, academic_year_id, enrollment_status, tenant_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [s.id, SEED_CLASS_1_ID, SEED_SECTION_1_ID, SEED_ACADEMIC_YEAR_ID, status, SEED_TENANT_ID],
    );
    return { studentId: s.id as string, enrollmentId: e.id as string };
  }
  const studentRow = async (id: string) =>
    (await q(`SELECT enrollment_status, class_section_id FROM students WHERE id = $1`, [id]))[0];
  const enrollmentRow = async (id: string) =>
    (await q(`SELECT enrollment_status, section_id FROM enrollments WHERE id = $1`, [id]))[0];
  const auditCount = async (ids: string[]) =>
    (await q(`SELECT id FROM audit_logs WHERE entity_id = ANY($1::uuid[])`, [ids])).length;

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [],
      [ConfigModule.forRoot({ isGlobal: true }), ApplicationsModule, AuthModule],
    );
    ds = module.get<DataSource>(getDataSourceToken());
    readmission = module.get(ReadmissionHandler);
    sectionChange = module.get(SectionChangeHandler);
    transfer = module.get(TransferCertificateHandler);

    // A second academic year with its own class + section (for the other-year case).
    await q(
      `INSERT INTO academic_years (id, name, start_date, end_date, is_current, tenant_id, created_at, updated_at)
       VALUES ($1, '2031', '2031-01-01', '2031-12-31', false, $2, NOW(), NOW())`,
      [Y2_ID, SEED_TENANT_ID],
    );
    await q(
      `INSERT INTO classes (id, name, academic_year_id, tenant_id, created_at, updated_at)
       VALUES ($1, 'LH Y2 Class', $2, $3, NOW(), NOW())`,
      [Y2_CLASS_ID, Y2_ID, SEED_TENANT_ID],
    );
    await q(
      `INSERT INTO class_sections (id, section_name, class_id, tenant_id, created_at, updated_at)
       VALUES ($1, 'LH Y2 A', $2, $3, NOW(), NOW())`,
      [Y2_SECTION_ID, Y2_CLASS_ID, SEED_TENANT_ID],
    );
    await q(
      `INSERT INTO schools (id, name, slug, created_at, updated_at) VALUES ($1, 'LH School B', 'lh-school-b', NOW(), NOW())`,
      [TENANT_B],
    );
  }, 60000);

  afterAll(async () => {
    if (!ds) return;
    await q(`DELETE FROM class_sections WHERE id = $1`, [Y2_SECTION_ID]);
    await q(`DELETE FROM classes WHERE id = $1`, [Y2_CLASS_ID]);
    await q(`DELETE FROM academic_years WHERE id = $1`, [Y2_ID]);
    await q(`DELETE FROM schools WHERE id = $1`, [TENANT_B]);
    await ds.destroy();
  });

  describe('readmission', () => {
    const payload = (over: Record<string, unknown> = {}) => ({
      class_section_id: SEED_SECTION_1_ID,
      occurred_on: day(-1),
      reason: 'Family returned',
      ...over,
    });

    it('WITHDRAWN student becomes ACTIVE and the lifecycle event id comes back', async () => {
      const { studentId, enrollmentId } = await seedStudent('INACTIVE');
      const res = await ds.transaction((m) =>
        readmission.apply(m, appFor(studentId, payload()), ctxA),
      );
      expect(res).toEqual({ lifecycle_event_id: expect.any(String) });
      expect((await studentRow(studentId)).enrollment_status).toBe('ACTIVE');
      expect((await enrollmentRow(enrollmentId)).enrollment_status).toBe('ACTIVE');
    });

    it('already ACTIVE -> 409 and nothing written', async () => {
      const { studentId } = await seedStudent('ACTIVE');
      await expect(
        ds.transaction((m) => readmission.apply(m, appFor(studentId, payload()), ctxA)),
      ).rejects.toMatchObject({ status: 409 });
      expect(
        await q(`SELECT id FROM student_lifecycle_events WHERE student_id = $1`, [studentId]),
      ).toHaveLength(0);
    });

    it('future occurred_on -> 422 DATE_IN_FUTURE and student stays inactive', async () => {
      const { studentId } = await seedStudent('INACTIVE');
      await expect(
        ds.transaction((m) =>
          readmission.apply(m, appFor(studentId, payload({ occurred_on: day(5) })), ctxA),
        ),
      ).rejects.toMatchObject({
        status: 422,
        response: { details: { code: 'DATE_IN_FUTURE' } },
      });
      expect((await studentRow(studentId)).enrollment_status).toBe('INACTIVE');
    });

    it('rollback after apply leaves students.enrollment_status, enrollment, events and audit untouched', async () => {
      const { studentId, enrollmentId } = await seedStudent('INACTIVE');
      await expect(
        ds.transaction(async (m) => {
          await readmission.apply(m, appFor(studentId, payload()), ctxA);
          throw new Error('rollback');
        }),
      ).rejects.toThrow('rollback');
      // Proves the handler used the caller's manager, not its own transaction.
      expect((await studentRow(studentId)).enrollment_status).toBe('INACTIVE');
      expect((await enrollmentRow(enrollmentId)).enrollment_status).toBe('INACTIVE');
      expect(
        await q(`SELECT id FROM student_lifecycle_events WHERE student_id = $1`, [studentId]),
      ).toHaveLength(0);
      expect(await auditCount([studentId, enrollmentId])).toBe(0);
    });

    it("tenant B cannot readmit tenant A's student -> 404, rows unchanged", async () => {
      const { studentId } = await seedStudent('INACTIVE');
      await expect(
        ds.transaction((m) => readmission.apply(m, appFor(studentId, payload()), ctxB)),
      ).rejects.toMatchObject({ status: 404 });
      expect((await studentRow(studentId)).enrollment_status).toBe('INACTIVE');
    });
  });

  describe('section change', () => {
    it('moves the enrollment and students.class_section_id', async () => {
      const { studentId, enrollmentId } = await seedStudent();
      const res = await ds.transaction((m) =>
        sectionChange.apply(
          m,
          appFor(studentId, { to_section_id: SEED_SECTION_2_ID, reason: 'Clash' }),
          ctxA,
        ),
      );
      expect(res).toEqual({
        enrollment_id: enrollmentId,
        from_section_id: SEED_SECTION_1_ID,
        to_section_id: SEED_SECTION_2_ID,
      });
      expect((await enrollmentRow(enrollmentId)).section_id).toBe(SEED_SECTION_2_ID);
      expect((await studentRow(studentId)).class_section_id).toBe(SEED_SECTION_2_ID);
    });

    it('same section -> 409 SECTION_UNCHANGED', async () => {
      const { studentId } = await seedStudent();
      await expect(
        ds.transaction((m) =>
          sectionChange.apply(
            m,
            appFor(studentId, { to_section_id: SEED_SECTION_1_ID, reason: 'Nothing' }),
            ctxA,
          ),
        ),
      ).rejects.toMatchObject({
        status: 409,
        response: { details: { code: 'SECTION_UNCHANGED' } },
      });
    });

    it('no active enrollment -> 409 NO_ACTIVE_ENROLLMENT', async () => {
      const { studentId } = await seedStudent('INACTIVE');
      await expect(
        ds.transaction((m) =>
          sectionChange.apply(
            m,
            appFor(studentId, { to_section_id: SEED_SECTION_2_ID, reason: 'Clash' }),
            ctxA,
          ),
        ),
      ).rejects.toMatchObject({
        status: 409,
        response: { details: { code: 'NO_ACTIVE_ENROLLMENT' } },
      });
    });

    it('section from another academic year -> 400', async () => {
      const { studentId, enrollmentId } = await seedStudent();
      await expect(
        ds.transaction((m) =>
          sectionChange.apply(
            m,
            appFor(studentId, { to_section_id: Y2_SECTION_ID, reason: 'Wrong year' }),
            ctxA,
          ),
        ),
      ).rejects.toMatchObject({ status: 400 });
      expect((await enrollmentRow(enrollmentId)).section_id).toBe(SEED_SECTION_1_ID);
    });

    it("tenant B on tenant A's student -> 404, tenant A rows unchanged", async () => {
      const { studentId, enrollmentId } = await seedStudent();
      await expect(
        ds.transaction((m) =>
          sectionChange.apply(
            m,
            appFor(studentId, { to_section_id: SEED_SECTION_2_ID, reason: 'Clash' }),
            ctxB,
          ),
        ),
      ).rejects.toMatchObject({ status: 404 });
      expect((await enrollmentRow(enrollmentId)).section_id).toBe(SEED_SECTION_1_ID);
    });

    it("another tenant's section id -> 404", async () => {
      const { studentId } = await seedStudent();
      await q(
        `INSERT INTO academic_years (id, name, start_date, end_date, is_current, tenant_id, created_at, updated_at)
         VALUES ($1, 'B Y', '2026-01-01', '2026-12-31', true, $2, NOW(), NOW())`,
        [`${P}0000000000b1`, TENANT_B],
      );
      await q(
        `INSERT INTO classes (id, name, academic_year_id, tenant_id, created_at, updated_at)
         VALUES ($1, 'B C', $2, $3, NOW(), NOW())`,
        [`${P}0000000000b2`, `${P}0000000000b1`, TENANT_B],
      );
      await q(
        `INSERT INTO class_sections (id, section_name, class_id, tenant_id, created_at, updated_at)
         VALUES ($1, 'B S', $2, $3, NOW(), NOW())`,
        [`${P}0000000000b3`, `${P}0000000000b2`, TENANT_B],
      );
      try {
        await expect(
          ds.transaction((m) =>
            sectionChange.apply(
              m,
              appFor(studentId, { to_section_id: `${P}0000000000b3`, reason: 'Cross' }),
              ctxA,
            ),
          ),
        ).rejects.toMatchObject({ status: 404 });
      } finally {
        await q(`DELETE FROM class_sections WHERE id = $1`, [`${P}0000000000b3`]);
        await q(`DELETE FROM classes WHERE id = $1`, [`${P}0000000000b2`]);
        await q(`DELETE FROM academic_years WHERE id = $1`, [`${P}0000000000b1`]);
      }
    });

    it("a section created in the caller's transaction is visible to the move, and rollback undoes both", async () => {
      const { studentId, enrollmentId } = await seedStudent();
      const newSection = `${P}0000000000c1`;
      await expect(
        ds.transaction(async (m) => {
          await m.query(
            `INSERT INTO class_sections (id, section_name, class_id, tenant_id, created_at, updated_at)
             VALUES ($1, 'LH In-tx', $2, $3, NOW(), NOW())`,
            [newSection, SEED_CLASS_1_ID, SEED_TENANT_ID],
          );
          const res = await sectionChange.apply(
            m,
            appFor(studentId, { to_section_id: newSection, reason: 'Fresh section' }),
            ctxA,
          );
          expect(res).toMatchObject({ to_section_id: newSection });
          throw new Error('rollback');
        }),
      ).rejects.toThrow('rollback');
      expect((await enrollmentRow(enrollmentId)).section_id).toBe(SEED_SECTION_1_ID);
      expect((await studentRow(studentId)).class_section_id).toBe(SEED_SECTION_1_ID);
      expect(await auditCount([enrollmentId])).toBe(0);
    });
  });

  describe('review round 1 extras', () => {
    const today = () =>
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());

    it('positive control: a committed readmission and transfer DO write audit rows', async () => {
      const a = await seedStudent('INACTIVE');
      await ds.transaction((m) =>
        readmission.apply(
          m,
          appFor(a.studentId, {
            class_section_id: SEED_SECTION_1_ID,
            occurred_on: day(-1),
            reason: 'Back',
          }),
          ctxA,
        ),
      );
      expect(await auditCount([a.studentId, a.enrollmentId])).toBeGreaterThan(0);

      const b = await seedStudent();
      await ds.transaction((m) =>
        transfer.apply(
          m,
          appFor(b.studentId, { leaving_date: day(-1), reason: 'Moving away' }),
          ctxA,
        ),
      );
      expect(await auditCount([b.studentId, b.enrollmentId])).toBeGreaterThan(0);
    });

    it("today's date is accepted (not 'future') for readmission and transfer", async () => {
      const a = await seedStudent('INACTIVE');
      await ds.transaction((m) =>
        readmission.apply(
          m,
          appFor(a.studentId, {
            class_section_id: SEED_SECTION_1_ID,
            occurred_on: today(),
            reason: 'Back',
          }),
          ctxA,
        ),
      );
      const b = await seedStudent();
      await ds.transaction((m) =>
        transfer.apply(m, appFor(b.studentId, { leaving_date: today(), reason: 'Moving' }), ctxA),
      );
      expect((await studentRow(a.studentId)).enrollment_status).toBe('ACTIVE');
      expect((await studentRow(b.studentId)).enrollment_status).toBe('TRANSFERRED');
    });

    it('datetime strings are cut to the date part before the future check', async () => {
      const a = await seedStudent('INACTIVE');
      await ds.transaction((m) =>
        readmission.apply(
          m,
          appFor(a.studentId, {
            class_section_id: SEED_SECTION_1_ID,
            occurred_on: `${day(-1)}T10:00:00.000Z`,
            reason: 'Back',
          }),
          ctxA,
        ),
      );
      expect((await studentRow(a.studentId)).enrollment_status).toBe('ACTIVE');

      const b = await seedStudent();
      await ds.transaction((m) =>
        transfer.apply(
          m,
          appFor(b.studentId, { leaving_date: `${day(-1)}T23:30:00.000Z`, reason: 'Moving' }),
          ctxA,
        ),
      );
      expect((await studentRow(b.studentId)).enrollment_status).toBe('TRANSFERRED');

      // A future datetime is still refused.
      const c = await seedStudent();
      await expect(
        ds.transaction((m) =>
          transfer.apply(
            m,
            appFor(c.studentId, { leaving_date: `${day(5)}T00:00:00.000Z`, reason: 'Moving' }),
            ctxA,
          ),
        ),
      ).rejects.toMatchObject({ status: 422 });
    });

    it('soft-deleted student -> 404 on section change', async () => {
      const { studentId } = await seedStudent();
      await q(`UPDATE students SET deleted_at = NOW() WHERE id = $1`, [studentId]);
      await expect(
        ds.transaction((m) =>
          sectionChange.apply(
            m,
            appFor(studentId, { to_section_id: SEED_SECTION_2_ID, reason: 'Clash' }),
            ctxA,
          ),
        ),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('soft-deleted target section -> 404 on section change', async () => {
      const { studentId, enrollmentId } = await seedStudent();
      const gone = `${P}0000000000d1`;
      await q(
        `INSERT INTO class_sections (id, section_name, class_id, tenant_id, deleted_at, created_at, updated_at)
         VALUES ($1, 'LH Gone', $2, $3, NOW(), NOW(), NOW())`,
        [gone, SEED_CLASS_1_ID, SEED_TENANT_ID],
      );
      try {
        await expect(
          ds.transaction((m) =>
            sectionChange.apply(
              m,
              appFor(studentId, { to_section_id: gone, reason: 'Deleted' }),
              ctxA,
            ),
          ),
        ).rejects.toMatchObject({ status: 404 });
        expect((await enrollmentRow(enrollmentId)).section_id).toBe(SEED_SECTION_1_ID);
      } finally {
        await q(`DELETE FROM class_sections WHERE id = $1`, [gone]);
      }
    });
  });

  describe('transfer certificate', () => {
    const payload = (over: Record<string, unknown> = {}) => ({
      leaving_date: day(-1),
      destination: 'Other School',
      reason: 'Parents relocating',
      ...over,
    });

    it('student becomes TRANSFERRED_OUT and a PRINT follow-up is returned', async () => {
      const { studentId } = await seedStudent();
      const res = await ds.transaction((m) =>
        transfer.apply(m, appFor(studentId, payload()), ctxA),
      );
      expect(res).toEqual({
        lifecycle_event_id: expect.any(String),
        follow_up: {
          kind: 'PRINT',
          document_kind: 'TRANSFER_CERTIFICATE',
          subject_type: 'STUDENT',
          subject_ids: [studentId],
        },
      });
      // Event type is TRANSFERRED_OUT; the resulting student status is TRANSFERRED.
      expect((await studentRow(studentId)).enrollment_status).toBe('TRANSFERRED');
    });

    it('future leaving_date -> 422 DATE_IN_FUTURE and student still ACTIVE', async () => {
      const { studentId } = await seedStudent();
      await expect(
        ds.transaction((m) =>
          transfer.apply(m, appFor(studentId, payload({ leaving_date: day(5) })), ctxA),
        ),
      ).rejects.toMatchObject({
        status: 422,
        response: { details: { code: 'DATE_IN_FUTURE' } },
      });
      expect((await studentRow(studentId)).enrollment_status).toBe('ACTIVE');
    });

    it('rollback after apply leaves student, enrollment and audit untouched', async () => {
      const { studentId, enrollmentId } = await seedStudent();
      await expect(
        ds.transaction(async (m) => {
          await transfer.apply(m, appFor(studentId, payload()), ctxA);
          throw new Error('rollback');
        }),
      ).rejects.toThrow('rollback');
      expect((await studentRow(studentId)).enrollment_status).toBe('ACTIVE');
      expect((await enrollmentRow(enrollmentId)).enrollment_status).toBe('ACTIVE');
      expect(
        await q(`SELECT id FROM student_lifecycle_events WHERE student_id = $1`, [studentId]),
      ).toHaveLength(0);
      expect(await auditCount([studentId, enrollmentId])).toBe(0);
    });

    it("tenant B cannot transfer tenant A's student -> 404, student still ACTIVE", async () => {
      const { studentId } = await seedStudent();
      await expect(
        ds.transaction((m) => transfer.apply(m, appFor(studentId, payload()), ctxB)),
      ).rejects.toMatchObject({ status: 404 });
      expect((await studentRow(studentId)).enrollment_status).toBe('ACTIVE');
    });
  });
});

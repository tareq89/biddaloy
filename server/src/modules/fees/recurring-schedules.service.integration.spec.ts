import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { BadRequestException } from '@nestjs/common';
import { RecurringSchedulesService } from './recurring-schedules.service';
import { AuditService } from '../audit/audit.service';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import {
  SEED_TENANT_ID,
  SEED_SECTION_1_ID,
  SEED_SECTION_2_ID,
  SEED_ACADEMIC_YEAR_ID,
  SEED_ADMIN_USER_ID,
} from '@test/constants';

/**
 * Integration tests for RecurringSchedulesService (16.7.1). Runs against a
 * real PostgreSQL database.
 */
describe('RecurringSchedulesService (integration)', () => {
  let dataSource: DataSource;
  let service: RecurringSchedulesService;

  const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000006750';
  let studentSeq = 0;

  async function createStudent(
    overrides: {
      class_section_id?: string;
      enrollment_status?: string;
      tenant_id?: string;
    } = {},
  ): Promise<string> {
    studentSeq += 1;
    const res = await dataSource.query(
      `INSERT INTO students (id, full_name, registration_number, roll_number, class_section_id, tenant_id, date_of_birth, preferred_communication, enrollment_status, created_at, updated_at)
       VALUES (DEFAULT, $1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
       RETURNING id`,
      [
        `Schedule Student ${studentSeq}`,
        `REG-SCHED-${String(studentSeq).padStart(4, '0')}`,
        studentSeq,
        overrides.class_section_id === undefined ? SEED_SECTION_1_ID : overrides.class_section_id,
        overrides.tenant_id ?? SEED_TENANT_ID,
        '2015-01-01',
        'SMS',
        overrides.enrollment_status ?? 'ACTIVE',
      ],
    );
    return res[0].id as string;
  }

  async function createFeeStructure(
    overrides: {
      name?: string;
      fee_type?: string;
      academic_year_id?: string;
      tenant_id?: string;
    } = {},
  ): Promise<string> {
    const res = await dataSource.query(
      `INSERT INTO fee_structures (id, fee_type, name, amount, academic_year_id, tenant_id, created_at, updated_at)
       VALUES (DEFAULT, $1, $2, 1000, $3, $4, NOW(), NOW())
       RETURNING id`,
      [
        overrides.fee_type ?? 'MONTHLY_TUITION',
        overrides.name ?? 'Tuition',
        overrides.academic_year_id ?? SEED_ACADEMIC_YEAR_ID,
        overrides.tenant_id ?? SEED_TENANT_ID,
      ],
    );
    return res[0].id as string;
  }

  beforeAll(async () => {
    const moduleRef = await createTestModule(ALL_ENTITIES, [
      RecurringSchedulesService,
      AuditService,
    ]);
    dataSource = moduleRef.get(DataSource);
    service = moduleRef.get(RecurringSchedulesService);

    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Recurring Schedules Test School B', 'recurring-schedules-test-school-b', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [OTHER_TENANT_ID],
    );
  }, 60000);

  afterAll(async () => {
    await dataSource.destroy();
  });

  describe('audience resolution', () => {
    it('honours class/section, active status, and exclusions', async () => {
      const structureId = await createFeeStructure({ name: `Tuition ${Date.now()}` });
      const matchingStudent = await createStudent({ class_section_id: SEED_SECTION_1_ID });
      const excludedStudent = await createStudent({ class_section_id: SEED_SECTION_1_ID });
      const inactiveStudent = await createStudent({
        class_section_id: SEED_SECTION_1_ID,
        enrollment_status: 'INACTIVE',
      });
      // A different section — should never match this schedule's audience.
      await createStudent({ class_section_id: SEED_SECTION_2_ID });

      const schedule = await service.create(
        {
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          name: 'Section A Monthly Tuition',
          audience: { section_id: SEED_SECTION_1_ID, enrollment_status: 'ACTIVE' },
          rule: { kind: 'MONTHLY', day_of_month: 1 },
          fee_structure_ids: [structureId],
          starts_on: '2026-01-01',
        } as any,
        SEED_TENANT_ID,
        SEED_ADMIN_USER_ID,
      );

      await service.addExclusion(
        schedule.id,
        { student_id: excludedStudent, reason: 'Sponsored' },
        SEED_TENANT_ID,
        SEED_ADMIN_USER_ID,
      );

      const preview = await service.preview(schedule.id, SEED_TENANT_ID);
      const ids = preview.students.map((s) => s.id);

      expect(ids).toContain(matchingStudent);
      expect(ids).not.toContain(excludedStudent);
      expect(ids).not.toContain(inactiveStudent);
    });
  });

  describe('ends_on validation', () => {
    it('rejects an ends_on beyond the academic year end date with 400', async () => {
      const structureId = await createFeeStructure({ name: `Tuition ${Date.now()}` });

      await expect(
        service.create(
          {
            academic_year_id: SEED_ACADEMIC_YEAR_ID,
            name: 'Past-year-end schedule',
            audience: { enrollment_status: 'ACTIVE' },
            rule: { kind: 'MONTHLY', day_of_month: 1 },
            fee_structure_ids: [structureId],
            starts_on: '2026-01-01',
            ends_on: '2027-01-31',
          } as any,
          SEED_TENANT_ID,
          SEED_ADMIN_USER_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a class that does not belong to the tenant/academic year with 400', async () => {
      const structureId = await createFeeStructure({ name: `Tuition ${Date.now()}` });

      await expect(
        service.create(
          {
            academic_year_id: SEED_ACADEMIC_YEAR_ID,
            name: 'Bad class schedule',
            audience: {
              class_id: '00000000-0000-4000-8000-000000000999',
              enrollment_status: 'ACTIVE',
            },
            rule: { kind: 'MONTHLY', day_of_month: 1 },
            fee_structure_ids: [structureId],
            starts_on: '2026-01-01',
          } as any,
          SEED_TENANT_ID,
          SEED_ADMIN_USER_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects duplicate fee_structure_ids with a clean 400, not an unhandled unique-constraint error', async () => {
      const structureId = await createFeeStructure({ name: `Dup Tuition ${Date.now()}` });

      await expect(
        service.create(
          {
            academic_year_id: SEED_ACADEMIC_YEAR_ID,
            name: 'Duplicate structure ids schedule',
            audience: { enrollment_status: 'ACTIVE' },
            rule: { kind: 'MONTHLY', day_of_month: 1 },
            fee_structure_ids: [structureId, structureId],
            starts_on: '2026-01-01',
          } as any,
          SEED_TENANT_ID,
          SEED_ADMIN_USER_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a starts_on after ends_on with 400 on create', async () => {
      const structureId = await createFeeStructure({ name: `Tuition ${Date.now()}` });

      await expect(
        service.create(
          {
            academic_year_id: SEED_ACADEMIC_YEAR_ID,
            name: 'Backwards date range schedule',
            audience: { enrollment_status: 'ACTIVE' },
            rule: { kind: 'MONTHLY', day_of_month: 1 },
            fee_structure_ids: [structureId],
            starts_on: '2026-06-01',
            ends_on: '2026-01-01',
          } as any,
          SEED_TENANT_ID,
          SEED_ADMIN_USER_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a starts_on after ends_on with 400 on update', async () => {
      const structureId = await createFeeStructure({ name: `Tuition ${Date.now()}` });
      const created = await service.create(
        {
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          name: 'Schedule to push backwards',
          audience: { enrollment_status: 'ACTIVE' },
          rule: { kind: 'MONTHLY', day_of_month: 1 },
          fee_structure_ids: [structureId],
          starts_on: '2026-01-01',
          ends_on: '2026-06-01',
        } as any,
        SEED_TENANT_ID,
        SEED_ADMIN_USER_ID,
      );

      await expect(
        service.update(
          created.id,
          { starts_on: '2026-12-01' } as any,
          SEED_TENANT_ID,
          SEED_ADMIN_USER_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('clone', () => {
    it('maps structures by (name, fee_type) and reports unmatched ones', async () => {
      const matchedName = `Clone Tuition ${Date.now()}`;
      const unmatchedName = `Clone Transport ${Date.now()}`;
      const sourceMatched = await createFeeStructure({
        name: matchedName,
        fee_type: 'MONTHLY_TUITION',
      });
      const sourceUnmatched = await createFeeStructure({
        name: unmatchedName,
        fee_type: 'TRANSPORT_FEE',
      });

      // Target academic year, with only the matching structure re-created.
      const targetYearId = '00000000-0000-4000-8000-000000006751';
      await dataSource.query(
        `INSERT INTO academic_years (id, name, start_date, end_date, is_current, tenant_id, created_at, updated_at)
         VALUES ($1, '2027-2028', '2027-01-01', '2027-12-31', false, $2, NOW(), NOW())
         ON CONFLICT DO NOTHING`,
        [targetYearId, SEED_TENANT_ID],
      );
      await createFeeStructure({
        name: matchedName,
        fee_type: 'MONTHLY_TUITION',
        academic_year_id: targetYearId,
      });

      const source = await service.create(
        {
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          name: 'Clone source schedule',
          audience: { enrollment_status: 'ACTIVE' },
          rule: { kind: 'MONTHLY', day_of_month: 5 },
          fee_structure_ids: [sourceMatched, sourceUnmatched],
          starts_on: '2026-01-01',
        } as any,
        SEED_TENANT_ID,
        SEED_ADMIN_USER_ID,
      );

      const result = await service.clone(
        source.id,
        { academic_year_id: targetYearId } as any,
        SEED_TENANT_ID,
        SEED_ADMIN_USER_ID,
      );

      expect(result.unmatched_structure_names).toEqual([unmatchedName]);
      expect(result.schedule.fee_structure_ids).toHaveLength(1);
      expect(result.schedule.academic_year_id).toBe(targetYearId);
      expect(result.schedule.starts_on).toBe('2027-01-01');
    });

    it('copies exclusions to the clone', async () => {
      const structureId = await createFeeStructure({ name: `Clone Excl Tuition ${Date.now()}` });
      const excludedStudent = await createStudent();

      const targetYearId = '00000000-0000-4000-8000-000000006752';
      await dataSource.query(
        `INSERT INTO academic_years (id, name, start_date, end_date, is_current, tenant_id, created_at, updated_at)
         VALUES ($1, '2027-2028b', '2027-01-01', '2027-12-31', false, $2, NOW(), NOW())
         ON CONFLICT DO NOTHING`,
        [targetYearId, SEED_TENANT_ID],
      );

      const source = await service.create(
        {
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          name: 'Clone-with-exclusion source',
          audience: { enrollment_status: 'ACTIVE' },
          rule: { kind: 'MONTHLY', day_of_month: 5 },
          fee_structure_ids: [structureId],
          starts_on: '2026-01-01',
        } as any,
        SEED_TENANT_ID,
        SEED_ADMIN_USER_ID,
      );
      await service.addExclusion(
        source.id,
        { student_id: excludedStudent, reason: 'Sponsored' },
        SEED_TENANT_ID,
        SEED_ADMIN_USER_ID,
      );

      const result = await service.clone(
        source.id,
        { academic_year_id: targetYearId } as any,
        SEED_TENANT_ID,
        SEED_ADMIN_USER_ID,
      );

      // findForStudent's date-window filter would hide a next-year clone
      // before its window opens, so verify the copied row directly rather
      // than through that read path.
      const [row] = await dataSource.query(
        `SELECT student_id, reason FROM recurring_schedule_exclusions WHERE schedule_id = $1`,
        [result.schedule.id],
      );
      expect(row.student_id).toBe(excludedStudent);
      expect(row.reason).toBe('Sponsored');
    });

    it('rejects cloning a schedule into its own academic year', async () => {
      const structureId = await createFeeStructure({ name: `Same-year Tuition ${Date.now()}` });
      const source = await service.create(
        {
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          name: 'Same-year clone source',
          audience: { enrollment_status: 'ACTIVE' },
          rule: { kind: 'MONTHLY', day_of_month: 5 },
          fee_structure_ids: [structureId],
          starts_on: '2026-01-01',
        } as any,
        SEED_TENANT_ID,
        SEED_ADMIN_USER_ID,
      );

      await expect(
        service.clone(
          source.id,
          { academic_year_id: SEED_ACADEMIC_YEAR_ID } as any,
          SEED_TENANT_ID,
          SEED_ADMIN_USER_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('remaps a class/section audience by name into the target year, reporting a miss instead of guessing', async () => {
      const structureId = await createFeeStructure({
        name: `Class-scoped clone Tuition ${Date.now()}`,
      });
      const targetYearId = '00000000-0000-4000-8000-000000006753';
      await dataSource.query(
        `INSERT INTO academic_years (id, name, start_date, end_date, is_current, tenant_id, created_at, updated_at)
         VALUES ($1, '2027-2028c', '2027-01-01', '2027-12-31', false, $2, NOW(), NOW())
         ON CONFLICT DO NOTHING`,
        [targetYearId, SEED_TENANT_ID],
      );
      // No same-named class exists in targetYearId, so the section can't
      // be remapped by name — clone() should report it, not throw or
      // silently keep the source year's (now meaningless) section id.

      const source = await service.create(
        {
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          name: 'Class-scoped clone source',
          audience: { section_id: SEED_SECTION_1_ID, enrollment_status: 'ACTIVE' },
          rule: { kind: 'MONTHLY', day_of_month: 5 },
          fee_structure_ids: [structureId],
          starts_on: '2026-01-01',
        } as any,
        SEED_TENANT_ID,
        SEED_ADMIN_USER_ID,
      );

      const result = await service.clone(
        source.id,
        { academic_year_id: targetYearId } as any,
        SEED_TENANT_ID,
        SEED_ADMIN_USER_ID,
      );

      expect(result.unmatched_audience_label).not.toBeNull();
      expect(result.schedule.audience).toEqual({ enrollment_status: 'ACTIVE' });
      // A failed remap must not silently widen to a school-wide, active
      // schedule — that would bill every student instead of the source's
      // narrow section. Land it inactive; unmatched_audience_label tells
      // the caller/UI why, so a human can fix the audience and flip it on.
      expect(result.schedule.is_active).toBe(false);
    });

    it('remaps a class/section audience by name when a same-named class exists in the target year', async () => {
      const structureId = await createFeeStructure({
        name: `Class-remap clone Tuition ${Date.now()}`,
      });
      const targetYearId = '00000000-0000-4000-8000-000000006754';
      await dataSource.query(
        `INSERT INTO academic_years (id, name, start_date, end_date, is_current, tenant_id, created_at, updated_at)
         VALUES ($1, '2027-2028d', '2027-01-01', '2027-12-31', false, $2, NOW(), NOW())
         ON CONFLICT DO NOTHING`,
        [targetYearId, SEED_TENANT_ID],
      );
      const [sourceSection] = await dataSource.query(
        `SELECT cs.section_name, c.id AS class_id, c.name AS class_name
         FROM class_sections cs JOIN classes c ON c.id = cs.class_id
         WHERE cs.id = $1`,
        [SEED_SECTION_1_ID],
      );
      const [targetClass] = await dataSource.query(
        `INSERT INTO classes (id, name, academic_year_id, tenant_id, created_at, updated_at)
         VALUES (DEFAULT, $1, $2, $3, NOW(), NOW())
         RETURNING id`,
        [sourceSection.class_name, targetYearId, SEED_TENANT_ID],
      );
      const [targetSection] = await dataSource.query(
        `INSERT INTO class_sections (id, class_id, section_name, tenant_id, created_at, updated_at)
         VALUES (DEFAULT, $1, $2, $3, NOW(), NOW())
         RETURNING id`,
        [targetClass.id, sourceSection.section_name, SEED_TENANT_ID],
      );

      const source = await service.create(
        {
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          name: 'Class-remap clone source',
          audience: { section_id: SEED_SECTION_1_ID, enrollment_status: 'ACTIVE' },
          rule: { kind: 'MONTHLY', day_of_month: 5 },
          fee_structure_ids: [structureId],
          starts_on: '2026-01-01',
        } as any,
        SEED_TENANT_ID,
        SEED_ADMIN_USER_ID,
      );

      const result = await service.clone(
        source.id,
        { academic_year_id: targetYearId } as any,
        SEED_TENANT_ID,
        SEED_ADMIN_USER_ID,
      );

      expect(result.unmatched_audience_label).toBeNull();
      expect(result.schedule.audience).toEqual({
        class_id: targetClass.id,
        section_id: targetSection.id,
        enrollment_status: 'ACTIVE',
      });
    });
  });

  describe('findForStudent', () => {
    it("returns schedules matching the student's audience and flags excluded ones", async () => {
      const structureId = await createFeeStructure({ name: `Student Read Tuition ${Date.now()}` });
      const matchingStudent = await createStudent({ class_section_id: SEED_SECTION_1_ID });

      const schedule = await service.create(
        {
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          name: 'Student-read schedule',
          audience: { section_id: SEED_SECTION_1_ID, enrollment_status: 'ACTIVE' },
          rule: { kind: 'MONTHLY', day_of_month: 5 },
          fee_structure_ids: [structureId],
          starts_on: '2020-01-01',
          ends_on: '2026-12-31',
        } as any,
        SEED_TENANT_ID,
        SEED_ADMIN_USER_ID,
      );

      const results = await service.findForStudent(matchingStudent, SEED_TENANT_ID);
      const entry = results.find((s) => s.id === schedule.id);
      expect(entry).toBeDefined();
      expect(entry?.excluded).toBe(false);

      await service.addExclusion(
        schedule.id,
        { student_id: matchingStudent, reason: 'Sponsored' },
        SEED_TENANT_ID,
        SEED_ADMIN_USER_ID,
      );
      const afterExclusion = await service.findForStudent(matchingStudent, SEED_TENANT_ID);
      expect(afterExclusion.find((s) => s.id === schedule.id)?.excluded).toBe(true);
    });

    it('excludes schedules whose window has already ended', async () => {
      const structureId = await createFeeStructure({ name: `Expired Tuition ${Date.now()}` });
      const student = await createStudent({ class_section_id: SEED_SECTION_1_ID });

      const schedule = await service.create(
        {
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          name: 'Expired schedule',
          audience: { section_id: SEED_SECTION_1_ID, enrollment_status: 'ACTIVE' },
          rule: { kind: 'MONTHLY', day_of_month: 5 },
          fee_structure_ids: [structureId],
          starts_on: '2020-01-01',
          ends_on: '2020-12-31',
        } as any,
        SEED_TENANT_ID,
        SEED_ADMIN_USER_ID,
      );

      const results = await service.findForStudent(student, SEED_TENANT_ID);
      expect(results.find((s) => s.id === schedule.id)).toBeUndefined();
    });
  });

  describe('remove', () => {
    it('soft-deletes a schedule so it no longer resolves via findOne', async () => {
      const structureId = await createFeeStructure({ name: `Removable Tuition ${Date.now()}` });
      const schedule = await service.create(
        {
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          name: 'Removable schedule',
          audience: { enrollment_status: 'ACTIVE' },
          rule: { kind: 'MONTHLY', day_of_month: 5 },
          fee_structure_ids: [structureId],
          starts_on: '2026-01-01',
        } as any,
        SEED_TENANT_ID,
        SEED_ADMIN_USER_ID,
      );

      await service.remove(schedule.id, SEED_TENANT_ID, SEED_ADMIN_USER_ID);

      await expect(service.findOne(schedule.id, SEED_TENANT_ID)).rejects.toThrow();

      const [row] = await dataSource.query(
        `SELECT deleted_at FROM recurring_schedules WHERE id = $1`,
        [schedule.id],
      );
      expect(row.deleted_at).not.toBeNull();
    });
  });

  describe('tenant isolation', () => {
    it("does not let one tenant read another tenant's schedule", async () => {
      const structureId = await createFeeStructure({ name: `Tuition ${Date.now()}` });
      const schedule = await service.create(
        {
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          name: 'Tenant A schedule',
          audience: { enrollment_status: 'ACTIVE' },
          rule: { kind: 'MONTHLY', day_of_month: 1 },
          fee_structure_ids: [structureId],
          starts_on: '2026-01-01',
        } as any,
        SEED_TENANT_ID,
        SEED_ADMIN_USER_ID,
      );

      await expect(service.findOne(schedule.id, OTHER_TENANT_ID)).rejects.toThrow();
    });
  });
});

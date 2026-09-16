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

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { Repository, DataSource } from 'typeorm';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { AcademicYearService } from './academic-year.service';
import { AcademicYear } from './entities/academic-year.entity';
import { Class } from './entities/class.entity';
import { ClassSection } from './entities/class-section.entity';
import { Student } from '../students/entities/student.entity';
import { Enrollment } from '../students/entities/enrollment.entity';
import { FeeStructure } from '../fees/entities/fee-structure.entity';
import { School } from '../schools/entities/school.entity';
import { User } from '../users/entities/user.entity';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID } from '@test/constants';
import { EnrollmentStatus, FeeType, FeeApplicability, AuditAction } from '@biddaloy/shared';
import { AuditService } from '../audit/audit.service';
import { AuditLog } from '../audit/entities/audit-log.entity';

/**
 * Integration tests for AcademicYearService.
 *
 * These tests run against a real PostgreSQL database and verify
 * tenant isolation, CRUD operations, and the "set current" business logic.
 */

describe('AcademicYearService (integration)', () => {
  let service: AcademicYearService;
  let repo: Repository<AcademicYear>;
  let dataSource: DataSource;

  const TENANT_ID = SEED_TENANT_ID;
  const OTHER_TENANT = '00000000-0000-4000-8000-000000000099';

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [AcademicYearService, AuditService], [], {
      synchronize: true,
      dropSchema: true,
    });

    service = module.get<AcademicYearService>(AcademicYearService);
    repo = module.get<Repository<AcademicYear>>(getRepositoryToken(AcademicYear));
    dataSource = module.get<DataSource>(getDataSourceToken());

    // Ensure base schools exist (seed data from setup.js, but create OTHER_TENANT's school)
    const schoolRepo = dataSource.getRepository(School);
    const existing = await schoolRepo.findOne({ where: { id: TENANT_ID } });
    if (!existing) {
      await schoolRepo.save({ id: TENANT_ID, name: 'Test School', slug: 'test-school' });
    }
    const otherExisting = await schoolRepo.findOne({ where: { id: OTHER_TENANT } });
    if (!otherExisting) {
      await schoolRepo.save({ id: OTHER_TENANT, name: 'Other School', slug: 'other-school' });
    }
  }, 60000);

  afterAll(async () => {
    if (dataSource) {
      await dataSource.destroy();
    }
  });

  // Reset: clear all data before each test (FK-safe order)
  beforeEach(async () => {
    if (dataSource) {
      await dataSource.query('DELETE FROM payment_allocations');
      await dataSource.query('DELETE FROM student_fees');
      await dataSource.query('DELETE FROM fee_structure_students');
      await dataSource.query('DELETE FROM fee_structures');
      await dataSource.query('DELETE FROM payments');
      await dataSource.query('DELETE FROM student_guardians');
      await dataSource.query('DELETE FROM students');
      await dataSource.query('DELETE FROM guardians');
      await dataSource.query('DELETE FROM class_sections');
      await dataSource.query('DELETE FROM classes');
      await dataSource.query('DELETE FROM academic_years');
    }
  });

  describe('create', () => {
    it('should create an academic year', async () => {
      const dto = {
        name: '2026-2027',
        start_date: '2026-01-01',
        end_date: '2026-12-31',
      };

      const result = await service.create(dto, TENANT_ID);

      expect(result).toBeDefined();
      expect(result.name).toBe('2026-2027');
      expect(result.tenant_id).toBe(TENANT_ID);
    });

    it('should enforce unique name per tenant', async () => {
      const dto = {
        name: '2026-2027',
        start_date: '2026-01-01',
        end_date: '2026-12-31',
      };

      // Create first
      await service.create(dto, TENANT_ID);

      // Try to create duplicate — should fail
      await expect(service.create(dto, TENANT_ID)).rejects.toThrow();
    });

    it('should allow same name in different tenants', async () => {
      const dto = {
        name: '2026-2027',
        start_date: '2026-01-01',
        end_date: '2026-12-31',
      };

      // Create in tenant-1
      await service.create(dto, TENANT_ID);

      // Create in tenant-2 — should succeed
      const result = await service.create(dto, OTHER_TENANT);
      expect(result).toBeDefined();
      expect(result.tenant_id).toBe(OTHER_TENANT);
    });
  });

  describe('findAll', () => {
    it('should return paginated academic years', async () => {
      await service.create(
        { name: '2026-2027', start_date: '2026-01-01', end_date: '2026-12-31' },
        TENANT_ID,
      );
      await service.create(
        { name: '2027-2028', start_date: '2027-01-01', end_date: '2027-12-31' },
        TENANT_ID,
      );

      const result = await service.findAll({ page: 1, limit: 10 }, TENANT_ID);

      expect(result.data).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('should enforce tenant isolation', async () => {
      // Create for tenant-1
      await service.create(
        { name: '2026-2027', start_date: '2026-01-01', end_date: '2026-12-31' },
        TENANT_ID,
      );
      // Create for tenant-2
      await service.create(
        { name: '2026-2027', start_date: '2026-01-01', end_date: '2026-12-31' },
        OTHER_TENANT,
      );

      // Query from tenant-1 — should only see tenant-1's data
      const result = await service.findAll({ page: 1, limit: 10 }, TENANT_ID);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].tenant_id).toBe(TENANT_ID);
    });
  });

  describe('findOne', () => {
    it('should return an academic year by ID', async () => {
      const created = await service.create(
        { name: '2026-2027', start_date: '2026-01-01', end_date: '2026-12-31' },
        TENANT_ID,
      );

      const result = await service.findOne(created.id, TENANT_ID);

      expect(result.id).toBe(created.id);
      expect(result.name).toBe('2026-2027');
    });

    it('should throw NotFoundException when year belongs to a different tenant', async () => {
      const created = await service.create(
        { name: '2026-2027', start_date: '2026-01-01', end_date: '2026-12-31' },
        OTHER_TENANT,
      );

      await expect(service.findOne(created.id, TENANT_ID)).rejects.toThrow(NotFoundException);
    });
  });

  describe('setCurrent', () => {
    it('should set the current academic year', async () => {
      const year1 = await service.create(
        { name: '2026-2027', start_date: '2026-01-01', end_date: '2026-12-31' },
        TENANT_ID,
      );
      const year2 = await service.create(
        { name: '2027-2028', start_date: '2027-01-01', end_date: '2027-12-31' },
        TENANT_ID,
      );

      // Set year2 as current
      await service.setCurrent(year2.id, TENANT_ID);

      // Verify year2 is current
      const year2Reloaded = await service.findOne(year2.id, TENANT_ID);
      expect(year2Reloaded.is_current).toBe(true);

      // Verify year1 is no longer current
      const year1Reloaded = await service.findOne(year1.id, TENANT_ID);
      expect(year1Reloaded.is_current).toBe(false);
    });

    it('should not affect other tenants when setting current', async () => {
      const tenant1 = await service.create(
        { name: '2026-2027', start_date: '2026-01-01', end_date: '2026-12-31' },
        TENANT_ID,
      );
      const tenant2 = await service.create(
        { name: '2026-2027', start_date: '2026-01-01', end_date: '2026-12-31' },
        OTHER_TENANT,
      );

      // Set tenant2's year as current
      await service.setCurrent(tenant2.id, OTHER_TENANT);

      // Tenant1's year should remain unaffected
      const tenant1Reloaded = await service.findOne(tenant1.id, TENANT_ID);
      expect(tenant1Reloaded.is_current).toBe(false);
    });
  });

  describe('remove (soft delete)', () => {
    it('should soft delete an academic year', async () => {
      const created = await service.create(
        { name: '2026-2027', start_date: '2026-01-01', end_date: '2026-12-31' },
        TENANT_ID,
      );

      await service.remove(created.id, TENANT_ID);

      // Should not be found via findOne
      await expect(service.findOne(created.id, TENANT_ID)).rejects.toThrow(NotFoundException);

      // But should still exist with deleted_at set
      const raw = await repo.findOne({
        where: { id: created.id },
        withDeleted: true,
      });
      expect(raw).toBeDefined();
      expect(raw?.deleted_at).not.toBeNull();
    });
  });

  describe('getStats', () => {
    it('should count classes, active-enrolled students, and fee structures for the year', async () => {
      const year = await service.create(
        { name: '2026-2027', start_date: '2026-01-01', end_date: '2026-12-31' },
        TENANT_ID,
      );

      const classRepo = dataSource.getRepository(Class);
      const sectionRepo = dataSource.getRepository(ClassSection);
      const studentRepo = dataSource.getRepository(Student);
      const enrollmentRepo = dataSource.getRepository(Enrollment);
      const feeStructureRepo = dataSource.getRepository(FeeStructure);

      const klass = await classRepo.save({
        name: 'Class 10',
        academic_year_id: year.id,
        tenant_id: TENANT_ID,
      });
      const section = await sectionRepo.save({
        class_id: klass.id,
        section_name: 'A',
        tenant_id: TENANT_ID,
      });
      const student = await studentRepo.save({
        full_name: 'Test Student',
        registration_number: 'REG-STATS-1',
        roll_number: 1,
        class_section_id: section.id,
        tenant_id: TENANT_ID,
      });
      await enrollmentRepo.save({
        student_id: student.id,
        class_id: klass.id,
        section_id: section.id,
        academic_year_id: year.id,
        tenant_id: TENANT_ID,
        enrollment_status: EnrollmentStatus.ACTIVE,
      });
      await feeStructureRepo.save({
        fee_type: FeeType.MONTHLY_TUITION,
        name: 'Tuition',
        amount: 500,
        applicability: FeeApplicability.ALL,
        class_id: klass.id,
        academic_year_id: year.id,
        month: 1,
        is_recurring: true,
        tenant_id: TENANT_ID,
      });

      const stats = await service.getStats(year.id, TENANT_ID);

      expect(stats).toEqual({
        classes_count: 1,
        students_count: 1,
        fee_structures_count: 1,
      });
    });

    it('should return zero counts for a year with nothing attached', async () => {
      const year = await service.create(
        { name: '2027-2028', start_date: '2027-01-01', end_date: '2027-12-31' },
        TENANT_ID,
      );

      const stats = await service.getStats(year.id, TENANT_ID);

      expect(stats).toEqual({ classes_count: 0, students_count: 0, fee_structures_count: 0 });
    });

    it("should not count another tenant's classes/students/fee structures", async () => {
      const year = await service.create(
        { name: '2028-2029', start_date: '2028-01-01', end_date: '2028-12-31' },
        TENANT_ID,
      );
      const otherYear = await service.create(
        { name: '2028-2029', start_date: '2028-01-01', end_date: '2028-12-31' },
        OTHER_TENANT,
      );

      const classRepo = dataSource.getRepository(Class);
      await classRepo.save({
        name: 'Other Tenant Class',
        academic_year_id: otherYear.id,
        tenant_id: OTHER_TENANT,
      });

      const stats = await service.getStats(year.id, TENANT_ID);

      expect(stats.classes_count).toBe(0);
    });

    it('should reject a stats lookup for a year that does not belong to the tenant', async () => {
      const otherYear = await service.create(
        { name: '2029-2030', start_date: '2029-01-01', end_date: '2029-12-31' },
        OTHER_TENANT,
      );

      await expect(service.getStats(otherYear.id, TENANT_ID)).rejects.toThrow(NotFoundException);
    });
  });

  // [15.2.4] every AcademicYear mutation writes a tenant-scoped audit row,
  // and set-current writes one entry on the newly-current year and one on
  // each previously-current year.
  describe('audit', () => {
    let auditLogRepo: Repository<AuditLog>;
    let actorUserId: string;

    beforeAll(async () => {
      auditLogRepo = dataSource.getRepository(AuditLog);
      const userRepo = dataSource.getRepository(User);
      const actor = await userRepo.save({
        full_name: 'Audit Actor',
        email: 'audit-actor@example.com',
      });
      actorUserId = actor.id;
    });

    it('writes a CREATE audit record for a new academic year', async () => {
      const created = await service.create(
        { name: '2026-2027', start_date: '2026-01-01', end_date: '2026-12-31' },
        TENANT_ID,
        actorUserId,
      );

      const logs = await auditLogRepo.find({
        where: { entity_id: created.id, entity_type: 'AcademicYear', action: AuditAction.CREATE },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0]?.performed_by_user_id).toBe(actorUserId);
      expect(logs[0]?.new_values).toMatchObject({ name: '2026-2027' });
    });

    it('writes an UPDATE audit record capturing old and new values', async () => {
      const created = await service.create(
        { name: '2026-2027', start_date: '2026-01-01', end_date: '2026-12-31' },
        TENANT_ID,
      );

      await service.update(created.id, { name: '2026-2027 Renamed' }, TENANT_ID, actorUserId);

      const logs = await auditLogRepo.find({
        where: { entity_id: created.id, entity_type: 'AcademicYear', action: AuditAction.UPDATE },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0]?.old_values).toMatchObject({ name: '2026-2027' });
      expect(logs[0]?.new_values).toMatchObject({ name: '2026-2027 Renamed' });
    });

    it('writes a DELETE audit record on remove', async () => {
      const created = await service.create(
        { name: '2026-2027', start_date: '2026-01-01', end_date: '2026-12-31' },
        TENANT_ID,
      );

      await service.remove(created.id, TENANT_ID, actorUserId);

      const logs = await auditLogRepo.find({
        where: { entity_id: created.id, entity_type: 'AcademicYear', action: AuditAction.DELETE },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0]?.performed_by_user_id).toBe(actorUserId);
    });

    it('set-current writes one entry on the newly-current year and one on the previously-current year', async () => {
      const yearA = await service.create(
        { name: 'Year A', start_date: '2026-01-01', end_date: '2026-12-31', is_current: true },
        TENANT_ID,
      );
      const yearB = await service.create(
        { name: 'Year B', start_date: '2027-01-01', end_date: '2027-12-31' },
        TENANT_ID,
      );

      await service.setCurrent(yearB.id, TENANT_ID, actorUserId);

      const yearBLogs = await auditLogRepo.find({
        where: { entity_id: yearB.id, entity_type: 'AcademicYear', action: AuditAction.UPDATE },
      });
      expect(yearBLogs).toHaveLength(1);
      expect(yearBLogs[0]?.old_values).toMatchObject({ is_current: false });
      expect(yearBLogs[0]?.new_values).toMatchObject({ is_current: true });

      const yearALogs = await auditLogRepo.find({
        where: { entity_id: yearA.id, entity_type: 'AcademicYear', action: AuditAction.UPDATE },
      });
      expect(yearALogs).toHaveLength(1);
      expect(yearALogs[0]?.old_values).toMatchObject({ is_current: true });
      expect(yearALogs[0]?.new_values).toMatchObject({ is_current: false });
    });

    it('rolls back both the academic year row and the audit entry on a forced failure', async () => {
      const before = await repo.count({ where: { tenant_id: TENANT_ID } });

      await expect(
        service.update('00000000-0000-4000-8000-000000000001', { name: 'X' }, TENANT_ID),
      ).rejects.toThrow(NotFoundException);

      const after = await repo.count({ where: { tenant_id: TENANT_ID } });
      expect(after).toBe(before);

      const logs = await auditLogRepo.find({
        where: { entity_id: '00000000-0000-4000-8000-000000000001', entity_type: 'AcademicYear' },
      });
      expect(logs).toHaveLength(0);
    });

    it("never exposes another tenant's academic year audit rows", async () => {
      const created = await service.create(
        { name: 'Cross Tenant Year', start_date: '2026-01-01', end_date: '2026-12-31' },
        OTHER_TENANT,
      );

      const logs = await auditLogRepo.find({
        where: { entity_id: created.id, entity_type: 'AcademicYear', tenant_id: TENANT_ID },
      });
      expect(logs).toHaveLength(0);

      const otherTenantLogs = await auditLogRepo.find({
        where: { entity_id: created.id, entity_type: 'AcademicYear', tenant_id: OTHER_TENANT },
      });
      expect(otherTenantLogs).toHaveLength(1);
    });
  });
});

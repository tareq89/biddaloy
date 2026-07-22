import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { Repository, DataSource } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EnrollmentService } from './enrollments.service';
import { Enrollment } from '../students/entities/enrollment.entity';
import { Student } from '../students/entities/student.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { School } from '../schools/entities/school.entity';
import { Guardian } from '../students/entities/guardian.entity';
import { User } from '../users/entities/user.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import {
  SEED_TENANT_ID,
  SEED_CLASS_1_ID,
  SEED_SECTION_1_ID,
  SEED_ACADEMIC_YEAR_ID,
} from '@test/constants';
import { EnrollmentStatus } from '@beton-boi/shared';

/**
 * Integration tests for EnrollmentService.
 *
 * These tests run against a real PostgreSQL database and verify:
 * - Full CRUD lifecycle: create → findByStudent → update
 * - Tenant isolation at every boundary
 * - Duplicate active enrollment prevention (ConflictException)
 * - Cross-entity FK validation (student, class, section, academic_year)
 * - Default ACTIVE enrollment_status and enrolled_at timestamp
 */

const OTHER_TENANT = '00000000-0000-4000-8000-000000000099';

/**
 * Seed reference data: school, academic year, class, class_section,
 * plus parallel entities for the other tenant so cross-tenant tests
 * can create valid foreign keys on the other side.
 */
async function seedReferenceData(ds: DataSource): Promise<void> {
  // FK-safe cleanup
  await ds.query('DELETE FROM enrollments');
  await ds.query('DELETE FROM student_guardians');
  await ds.query('DELETE FROM students');
  await ds.query('DELETE FROM guardians');
  await ds.query('DELETE FROM class_sections');
  await ds.query('DELETE FROM classes');
  await ds.query('DELETE FROM academic_years');
  await ds.query('DELETE FROM schools');

  const schoolRepo = ds.getRepository(School);
  const ayRepo = ds.getRepository(AcademicYear);
  const classRepo = ds.getRepository(Class);
  const sectionRepo = ds.getRepository(ClassSection);

  // Tenant 1 reference data
  await schoolRepo.save(schoolRepo.create({
    id: SEED_TENANT_ID,
    name: 'Test School',
    slug: 'test-school',
    tenant_id: SEED_TENANT_ID,
  }));
  await ayRepo.save(ayRepo.create({
    id: SEED_ACADEMIC_YEAR_ID,
    name: '2026-2027',
    start_date: new Date('2026-01-01'),
    end_date: new Date('2026-12-31'),
    is_current: true,
    tenant_id: SEED_TENANT_ID,
  }));
  await classRepo.save(classRepo.create({
    id: SEED_CLASS_1_ID,
    name: 'Class One',
    academic_year_id: SEED_ACADEMIC_YEAR_ID,
    tenant_id: SEED_TENANT_ID,
  }));
  await sectionRepo.save(sectionRepo.create({
    id: SEED_SECTION_1_ID,
    section_name: 'Section A',
    class_id: SEED_CLASS_1_ID,
    tenant_id: SEED_TENANT_ID,
  }));

  // Other tenant reference data
  const OTHER_AY_ID = '00000000-0000-4000-8000-000000000099';
  const OTHER_CLASS_ID = '00000000-0000-4000-8000-000000000098';
  const OTHER_SECTION_ID = '00000000-0000-4000-8000-000000000097';
  await schoolRepo.save(schoolRepo.create({
    id: OTHER_TENANT,
    name: 'Other School',
    slug: 'other-school',
    tenant_id: OTHER_TENANT,
  }));
  await ayRepo.save(ayRepo.create({
    id: OTHER_AY_ID,
    name: 'Other 2026-2027',
    start_date: new Date('2026-01-01'),
    end_date: new Date('2026-12-31'),
    is_current: true,
    tenant_id: OTHER_TENANT,
  }));
  await classRepo.save(classRepo.create({
    id: OTHER_CLASS_ID,
    name: 'Other Class',
    academic_year_id: OTHER_AY_ID,
    tenant_id: OTHER_TENANT,
  }));
  await sectionRepo.save(sectionRepo.create({
    id: OTHER_SECTION_ID,
    section_name: 'Other Section',
    class_id: OTHER_CLASS_ID,
    tenant_id: OTHER_TENANT,
  }));
}

describe('EnrollmentService (integration)', () => {
  let service: EnrollmentService;
  let enrollmentRepo: Repository<Enrollment>;
  let studentRepo: Repository<Student>;
  let classRepo: Repository<Class>;
  let sectionRepo: Repository<ClassSection>;
  let academicYearRepo: Repository<AcademicYear>;
  let dataSource: DataSource;

  const TENANT_ID = SEED_TENANT_ID;

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [EnrollmentService],
      [],
      { synchronize: true, dropSchema: true },
    );

    service = module.get<EnrollmentService>(EnrollmentService);
    enrollmentRepo = module.get<Repository<Enrollment>>(getRepositoryToken(Enrollment));
    studentRepo = module.get<Repository<Student>>(getRepositoryToken(Student));
    classRepo = module.get<Repository<Class>>(getRepositoryToken(Class));
    sectionRepo = module.get<Repository<ClassSection>>(getRepositoryToken(ClassSection));
    academicYearRepo = module.get<Repository<AcademicYear>>(getRepositoryToken(AcademicYear));
    dataSource = module.get(DataSource);

    await seedReferenceData(dataSource);
  }, 60000);

  afterAll(async () => {
    if (dataSource) {
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    if (dataSource) {
      await dataSource.query('DELETE FROM enrollments');
      await dataSource.query('DELETE FROM student_guardians');
      await dataSource.query('DELETE FROM students');
    }
  });

  // ────────────────────────
  //  Helper: create a minimal student that belongs to the tenant
  // ────────────────────────
  async function buildStudent(overrides: Partial<Student> = {}): Promise<Student> {
    return studentRepo.save(
      studentRepo.create({
        full_name: 'Enrolled Student',
        registration_number: 'REG-2026-0001',
        roll_number: 1,
        class_section_id: SEED_SECTION_1_ID,
        tenant_id: TENANT_ID,
        date_of_birth: new Date('2010-01-01'),
        gender: 'MALE',
        enrollment_status: EnrollmentStatus.ACTIVE,
        preferred_communication: 'SMS',
        ...overrides,
      }),
    );
  }

  // ────────────────────────
  //  create()
  // ────────────────────────
  describe('create', () => {
    it('should create an enrollment with ACTIVE status and default enrolled_at', async () => {
      const student = await buildStudent();

      const result = await service.create(
        {
          student_id: student.id,
          class_id: SEED_CLASS_1_ID,
          section_id: SEED_SECTION_1_ID,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
        },
        TENANT_ID,
      );

      expect(result).toBeDefined();
      expect(result.student_id).toBe(student.id);
      expect(result.class_id).toBe(SEED_CLASS_1_ID);
      expect(result.section_id).toBe(SEED_SECTION_1_ID);
      expect(result.academic_year_id).toBe(SEED_ACADEMIC_YEAR_ID);
      expect(result.tenant_id).toBe(TENANT_ID);
      expect(result.enrollment_status).toBe(EnrollmentStatus.ACTIVE);
      expect(result.enrolled_at).toBeInstanceOf(Date);
    });

    it('should create an enrollment without a section_id (nullable section)', async () => {
      const student = await buildStudent();

      const result = await service.create(
        {
          student_id: student.id,
          class_id: SEED_CLASS_1_ID,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
        },
        TENANT_ID,
      );

      expect(result).toBeDefined();
      expect(result.section_id).toBeNull();
    });

    it('should throw NotFoundException when student does not exist', async () => {
      await expect(
        service.create(
          {
            student_id: '00000000-0000-4000-8000-000000000000',
            class_id: SEED_CLASS_1_ID,
            academic_year_id: SEED_ACADEMIC_YEAR_ID,
          },
          TENANT_ID,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when student belongs to a different tenant', async () => {
      // Student whose class_section chain resolves to OTHER_TENANT
      const student = await studentRepo.save(
        studentRepo.create({
          full_name: 'Other Tenant Student',
          registration_number: 'REG-OTHER-0001',
          roll_number: 1,
          class_section_id: '00000000-0000-4000-8000-000000000097',
          tenant_id: OTHER_TENANT,
          date_of_birth: new Date('2010-01-01'),
          gender: 'MALE',
          enrollment_status: EnrollmentStatus.ACTIVE,
          preferred_communication: 'SMS',
        }),
      );

      await expect(
        service.create(
          {
            student_id: student.id,
            class_id: SEED_CLASS_1_ID,
            academic_year_id: SEED_ACADEMIC_YEAR_ID,
          },
          TENANT_ID,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when class does not belong to tenant', async () => {
      const student = await buildStudent();

      await expect(
        service.create(
          {
            student_id: student.id,
            class_id: '00000000-0000-4000-8000-000000000000',
            academic_year_id: SEED_ACADEMIC_YEAR_ID,
          },
          TENANT_ID,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when academic year does not belong to tenant', async () => {
      const student = await buildStudent();

      await expect(
        service.create(
          {
            student_id: student.id,
            class_id: SEED_CLASS_1_ID,
            academic_year_id: '00000000-0000-4000-8000-000000000000',
          },
          TENANT_ID,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when section does not belong to the class or tenant', async () => {
      const student = await buildStudent();

      await expect(
        service.create(
          {
            student_id: student.id,
            class_id: SEED_CLASS_1_ID,
            section_id: '00000000-0000-4000-8000-000000000000',
            academic_year_id: SEED_ACADEMIC_YEAR_ID,
          },
          TENANT_ID,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when section belongs to a different class', async () => {
      const student = await buildStudent();

      // Create a second class that has no section matching SEED_SECTION_1_ID
      const otherClass = await classRepo.save(
        classRepo.create({
          name: 'Other Class',
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          tenant_id: TENANT_ID,
        }),
      );

      await expect(
        service.create(
          {
            student_id: student.id,
            class_id: otherClass.id,
            section_id: SEED_SECTION_1_ID,
            academic_year_id: SEED_ACADEMIC_YEAR_ID,
          },
          TENANT_ID,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException when student already has an ACTIVE enrollment in the same academic year', async () => {
      const student = await buildStudent();

      // First enrollment
      await service.create(
        {
          student_id: student.id,
          class_id: SEED_CLASS_1_ID,
          section_id: SEED_SECTION_1_ID,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
        },
        TENANT_ID,
      );

      // Duplicate enrollment — should conflict
      await expect(
        service.create(
          {
            student_id: student.id,
            class_id: SEED_CLASS_1_ID,
            section_id: SEED_SECTION_1_ID,
            academic_year_id: SEED_ACADEMIC_YEAR_ID,
          },
          TENANT_ID,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('should allow a second enrollment after the first is marked INACTIVE', async () => {
      const student = await buildStudent();

      const first = await service.create(
        {
          student_id: student.id,
          class_id: SEED_CLASS_1_ID,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
        },
        TENANT_ID,
      );

      // Mark first inactive
      await service.update(
        first.id,
        { enrollment_status: EnrollmentStatus.INACTIVE },
        TENANT_ID,
      );

      // Second enrollment in same year — should succeed
      const second = await service.create(
        {
          student_id: student.id,
          class_id: SEED_CLASS_1_ID,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
        },
        TENANT_ID,
      );

      expect(second).toBeDefined();
      expect(second.enrollment_status).toBe(EnrollmentStatus.ACTIVE);
    });
  });

  // ────────────────────────
  //  findByStudent()
  // ────────────────────────
  describe('findByStudent', () => {
    it('should return all enrollments for a student ordered by enrolled_at DESC', async () => {
      const student = await buildStudent();

      await service.create(
        { student_id: student.id, class_id: SEED_CLASS_1_ID, academic_year_id: SEED_ACADEMIC_YEAR_ID },
        TENANT_ID,
      );

      const results = await service.findByStudent(student.id, TENANT_ID);

      expect(results).toHaveLength(1);
      expect(results[0].student_id).toBe(student.id);
    });

    it('should return multiple enrollments across different academic years', async () => {
      const student = await buildStudent();

      // Create a second academic year for the same tenant
      const ay2 = await academicYearRepo.save(
        academicYearRepo.create({
          name: '2027-2028',
          start_date: new Date('2027-01-01'),
          end_date: new Date('2027-12-31'),
          is_current: false,
          tenant_id: TENANT_ID,
        }),
      );

      await service.create(
        { student_id: student.id, class_id: SEED_CLASS_1_ID, academic_year_id: SEED_ACADEMIC_YEAR_ID },
        TENANT_ID,
      );
      await service.create(
        { student_id: student.id, class_id: SEED_CLASS_1_ID, academic_year_id: ay2.id },
        TENANT_ID,
      );

      const results = await service.findByStudent(student.id, TENANT_ID);

      expect(results).toHaveLength(2);
      // Results should be ordered DESC by enrolled_at
      expect(results[0].academic_year_id).toBe(ay2.id);
      expect(results[1].academic_year_id).toBe(SEED_ACADEMIC_YEAR_ID);
    });

    it('should throw NotFoundException when student does not exist', async () => {
      await expect(
        service.findByStudent('00000000-0000-4000-8000-000000000000', TENANT_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when student belongs to a different tenant', async () => {
      const student = await studentRepo.save(
        studentRepo.create({
          full_name: 'Other Tenant Student',
          registration_number: 'REG-OTHER-0001',
          roll_number: 1,
          class_section_id: '00000000-0000-4000-8000-000000000097',
          tenant_id: OTHER_TENANT,
          date_of_birth: new Date('2010-01-01'),
          gender: 'MALE',
          enrollment_status: EnrollmentStatus.ACTIVE,
          preferred_communication: 'SMS',
        }),
      );

      await expect(
        service.findByStudent(student.id, TENANT_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('should return empty array when student has no enrollments', async () => {
      const student = await buildStudent();

      const results = await service.findByStudent(student.id, TENANT_ID);

      expect(results).toEqual([]);
    });

    it('should return enrollments with relations loaded (class, section, academic_year)', async () => {
      const student = await buildStudent();

      await service.create(
        {
          student_id: student.id,
          class_id: SEED_CLASS_1_ID,
          section_id: SEED_SECTION_1_ID,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
        },
        TENANT_ID,
      );

      const results = await service.findByStudent(student.id, TENANT_ID);

      expect(results).toHaveLength(1);
      expect(results[0].class).toBeDefined();
      expect(results[0].class.id).toBe(SEED_CLASS_1_ID);
      expect(results[0].section).toBeDefined();
      expect(results[0].section.id).toBe(SEED_SECTION_1_ID);
      expect(results[0].academic_year).toBeDefined();
      expect(results[0].academic_year.id).toBe(SEED_ACADEMIC_YEAR_ID);
    });
  });

  // ────────────────────────
  //  findCurrentByStudent()
  // ────────────────────────
  describe('findCurrentByStudent', () => {
    it('should return the ACTIVE enrollment for a student', async () => {
      const student = await buildStudent();

      await service.create(
        { student_id: student.id, class_id: SEED_CLASS_1_ID, academic_year_id: SEED_ACADEMIC_YEAR_ID },
        TENANT_ID,
      );

      const result = await service.findCurrentByStudent(student.id, TENANT_ID);

      expect(result).not.toBeNull();
      expect(result!.student_id).toBe(student.id);
      expect(result!.enrollment_status).toBe(EnrollmentStatus.ACTIVE);
    });

    it('should return null when student has only non-ACTIVE enrollments', async () => {
      const student = await buildStudent();

      const enrollment = await service.create(
        { student_id: student.id, class_id: SEED_CLASS_1_ID, academic_year_id: SEED_ACADEMIC_YEAR_ID },
        TENANT_ID,
      );

      // Mark as INACTIVE
      await service.update(enrollment.id, { enrollment_status: EnrollmentStatus.INACTIVE }, TENANT_ID);

      const result = await service.findCurrentByStudent(student.id, TENANT_ID);

      expect(result).toBeNull();
    });

    it('should return null when student has no enrollments', async () => {
      const student = await buildStudent();

      const result = await service.findCurrentByStudent(student.id, TENANT_ID);

      expect(result).toBeNull();
    });

    it('should throw NotFoundException when student does not exist', async () => {
      await expect(
        service.findCurrentByStudent('00000000-0000-4000-8000-000000000000', TENANT_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when student belongs to a different tenant', async () => {
      const student = await studentRepo.save(
        studentRepo.create({
          full_name: 'Other Tenant Student',
          registration_number: 'REG-OTHER-0001',
          roll_number: 1,
          class_section_id: '00000000-0000-4000-8000-000000000097',
          tenant_id: OTHER_TENANT,
          date_of_birth: new Date('2010-01-01'),
          gender: 'MALE',
          enrollment_status: EnrollmentStatus.ACTIVE,
          preferred_communication: 'SMS',
        }),
      );

      await expect(
        service.findCurrentByStudent(student.id, TENANT_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('should return current enrollment with relations loaded', async () => {
      const student = await buildStudent();

      await service.create(
        {
          student_id: student.id,
          class_id: SEED_CLASS_1_ID,
          section_id: SEED_SECTION_1_ID,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
        },
        TENANT_ID,
      );

      const result = await service.findCurrentByStudent(student.id, TENANT_ID);

      expect(result).not.toBeNull();
      expect(result!.class).toBeDefined();
      expect(result!.section).toBeDefined();
      expect(result!.academic_year).toBeDefined();
    });
  });

  // ────────────────────────
  //  update()
  // ────────────────────────
  describe('update', () => {
    it('should update enrollment_status', async () => {
      const student = await buildStudent();

      const enrollment = await service.create(
        { student_id: student.id, class_id: SEED_CLASS_1_ID, academic_year_id: SEED_ACADEMIC_YEAR_ID },
        TENANT_ID,
      );

      const updated = await service.update(
        enrollment.id,
        { enrollment_status: EnrollmentStatus.INACTIVE },
        TENANT_ID,
      );

      expect(updated.enrollment_status).toBe(EnrollmentStatus.INACTIVE);
    });

    it('should update section_id', async () => {
      const student = await buildStudent();
      const enrollment = await service.create(
        { student_id: student.id, class_id: SEED_CLASS_1_ID, academic_year_id: SEED_ACADEMIC_YEAR_ID },
        TENANT_ID,
      );

      const updated = await service.update(
        enrollment.id,
        { section_id: SEED_SECTION_1_ID },
        TENANT_ID,
      );

      expect(updated.section_id).toBe(SEED_SECTION_1_ID);
    });

    it('should throw NotFoundException when enrollment does not exist', async () => {
      await expect(
        service.update(
          '00000000-0000-4000-8000-000000000000',
          { enrollment_status: EnrollmentStatus.TRANSFERRED },
          TENANT_ID,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when enrollment belongs to a different tenant', async () => {
      const student = await buildStudent();

      // Create enrollment for tenant 1
      const enrollment = await service.create(
        { student_id: student.id, class_id: SEED_CLASS_1_ID, academic_year_id: SEED_ACADEMIC_YEAR_ID },
        TENANT_ID,
      );

      // Try to update with a different tenant
      await expect(
        service.update(enrollment.id, { enrollment_status: EnrollmentStatus.TRANSFERRED }, OTHER_TENANT),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when updated section_id does not belong to the enrollment class', async () => {
      const student = await buildStudent();

      const enrollment = await service.create(
        { student_id: student.id, class_id: SEED_CLASS_1_ID, academic_year_id: SEED_ACADEMIC_YEAR_ID },
        TENANT_ID,
      );

      await expect(
        service.update(
          enrollment.id,
          { section_id: '00000000-0000-4000-8000-000000000000' },
          TENANT_ID,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should support transitioning enrollment through all status values', async () => {
      const student = await buildStudent();

      const enrollment = await service.create(
        { student_id: student.id, class_id: SEED_CLASS_1_ID, academic_year_id: SEED_ACADEMIC_YEAR_ID },
        TENANT_ID,
      );

      // ACTIVE → INACTIVE
      let updated = await service.update(enrollment.id, { enrollment_status: EnrollmentStatus.INACTIVE }, TENANT_ID);
      expect(updated.enrollment_status).toBe(EnrollmentStatus.INACTIVE);

      // INACTIVE → TRANSFERRED
      updated = await service.update(enrollment.id, { enrollment_status: EnrollmentStatus.TRANSFERRED }, TENANT_ID);
      expect(updated.enrollment_status).toBe(EnrollmentStatus.TRANSFERRED);

      // TRANSFERRED → GRADUATED
      updated = await service.update(enrollment.id, { enrollment_status: EnrollmentStatus.GRADUATED }, TENANT_ID);
      expect(updated.enrollment_status).toBe(EnrollmentStatus.GRADUATED);

      // GRADUATED → ACTIVE (re-enroll)
      updated = await service.update(enrollment.id, { enrollment_status: EnrollmentStatus.ACTIVE }, TENANT_ID);
      expect(updated.enrollment_status).toBe(EnrollmentStatus.ACTIVE);
    });

    it('should return updated enrollment with relations loaded', async () => {
      const student = await buildStudent();

      const enrollment = await service.create(
        { student_id: student.id, class_id: SEED_CLASS_1_ID, section_id: SEED_SECTION_1_ID, academic_year_id: SEED_ACADEMIC_YEAR_ID },
        TENANT_ID,
      );

      const updated = await service.update(
        enrollment.id,
        { enrollment_status: EnrollmentStatus.GRADUATED },
        TENANT_ID,
      );

      expect(updated.class).toBeDefined();
      expect(updated.section).toBeDefined();
      expect(updated.academic_year).toBeDefined();
    });
  });
});

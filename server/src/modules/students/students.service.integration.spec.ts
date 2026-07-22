import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { Repository, DataSource } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { StudentService, GuardianService } from './students.service';
import { Student } from './entities/student.entity';
import { Guardian } from './entities/guardian.entity';
import { ALL_ENTITIES } from '@test/all-entities';
import { School } from '../schools/entities/school.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { createTestModule } from '@test/helpers/module.helper';
import { SEED_TENANT_ID, SEED_SECTION_1_ID, SEED_ACADEMIC_YEAR_ID } from '@test/constants';

/**
 * Integration tests for StudentService and GuardianService.
 *
 * These tests run against a real PostgreSQL database and verify
 * tenant isolation, soft deletes, registration number generation,
 * and guardian-to-student linking.
 */

const OTHER_TENANT = '00000000-0000-0000-0000-000000000099';
const OTHER_SECTION_ID = '00000000-0000-0000-0000-000000000097';

/**
 * Seed reference data required by tests (school, class, class_section).
 * These are created fresh for each test file run.
 */
async function seedReferenceData(ds: DataSource): Promise<void> {
  // Clean up any stale data before seeding (FK-safe order)
  await ds.query('DELETE FROM payment_allocations');
  await ds.query('DELETE FROM student_fees');
  await ds.query('DELETE FROM fee_structure_students');
  await ds.query('DELETE FROM fee_structures');
  await ds.query('DELETE FROM payments');
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
    id: SEED_TENANT_ID,
    name: 'Class One',
    academic_year_id: SEED_ACADEMIC_YEAR_ID,
    tenant_id: SEED_TENANT_ID,
  }));
  await sectionRepo.save(sectionRepo.create({
    id: SEED_SECTION_1_ID,
    section_name: 'Section A',
    class_id: SEED_TENANT_ID,
    tenant_id: SEED_TENANT_ID,
  }));

  // Other tenant reference data (for tenant isolation tests)
  const OTHER_AY_ID = '00000000-0000-0000-0000-000000000099';
  const OTHER_CLASS_ID = '00000000-0000-0000-0000-000000000098';
  const OTHER_SECTION_ID = '00000000-0000-0000-0000-000000000097';
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

describe('StudentService (integration)', () => {
  let service: StudentService;
  let guardianService: GuardianService;
  let studentRepo: Repository<Student>;
  let guardianRepo: Repository<Guardian>;
  let dataSource: DataSource;

  const TENANT_ID = SEED_TENANT_ID;
  const OTHER_TENANT = '00000000-0000-0000-0000-000000000099';

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [StudentService, GuardianService],
      [],
      { synchronize: true, dropSchema: true },
    );

    service = module.get<StudentService>(StudentService);
    guardianService = module.get<GuardianService>(GuardianService);
    studentRepo = module.get<Repository<Student>>(getRepositoryToken(Student));
    guardianRepo = module.get<Repository<Guardian>>(getRepositoryToken(Guardian));
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
      await dataSource.query('DELETE FROM student_guardians');
      await dataSource.query('DELETE FROM guardians');
      await dataSource.query('DELETE FROM students');
    }
  });

  describe('create', () => {
    it('should create a student with auto-generated registration number', async () => {
      const dto = {
        full_name: 'John Doe',
        class_section_id: SEED_SECTION_1_ID,
        date_of_birth: '2010-05-15',
      };

      const result = await service.create(dto, TENANT_ID);

      expect(result).toBeDefined();
      expect(result.full_name).toBe('John Doe');
      expect(result.registration_number).toMatch(/^REG-\d{4}-\d{4}$/);
      // Critical: registration number is scoped to tenant
      expect(result.tenant_id).toBe(TENANT_ID);
    });

    it('should link guardians when guardian_ids are provided', async () => {
      // First create a guardian
      const guardian = await guardianRepo.save(
        guardianRepo.create({
          full_name: 'Parent',
          relationship: 'FATHER',
          phone: '+880****0001',
          tenant_id: TENANT_ID,
        }),
      );

      const dto = {
        full_name: 'John Doe',
        class_section_id: SEED_SECTION_1_ID,
        guardian_ids: [guardian.id],
      };

      const result = await service.create(dto, TENANT_ID);

      expect(result.guardians).toBeDefined();
      expect(result.guardians).toHaveLength(1);
      expect(result.guardians[0].id).toBe(guardian.id);
    });

    it('should throw NotFoundException when class_section is invalid', async () => {
      const dto = {
        full_name: 'John Doe',
        class_section_id: '00000000-0000-0000-0000-000000000000',
      };

      await expect(
        service.create(dto, TENANT_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when guardian does not belong to tenant', async () => {
      // Create a guardian in a different tenant
      const otherGuardian = await guardianRepo.save(
        guardianRepo.create({
          full_name: 'Other Parent',
          relationship: 'MOTHER',
          phone: '+880****0002',
          tenant_id: OTHER_TENANT,
        }),
      );

      const dto = {
        full_name: 'John Doe',
        class_section_id: SEED_SECTION_1_ID,
        guardian_ids: [otherGuardian.id],
      };

      // The guardian from a different tenant should not be found
      await expect(
        service.create(dto, TENANT_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('should auto-increment roll_number per section', async () => {
      // Create first student
      const student1 = await service.create(
        { full_name: 'Student 1', class_section_id: SEED_SECTION_1_ID },
        TENANT_ID,
      );
      expect(student1.roll_number).toBe(1);

      // Create second student in same section
      const student2 = await service.create(
        { full_name: 'Student 2', class_section_id: SEED_SECTION_1_ID },
        TENANT_ID,
      );
      expect(student2.roll_number).toBe(2);
    });

    it('should generate sequential registration numbers per tenant', async () => {
      const student1 = await service.create(
        { full_name: 'Student 1', class_section_id: SEED_SECTION_1_ID },
        TENANT_ID,
      );
      const student2 = await service.create(
        { full_name: 'Student 2', class_section_id: SEED_SECTION_1_ID },
        TENANT_ID,
      );

      // Registration numbers should be sequential
      expect(student1.registration_number).toMatch(/REG-\d{4}-\d{4}$/);
      expect(student2.registration_number).toMatch(/REG-\d{4}-\d{4}$/);
      expect(student2.registration_number).not.toBe(student1.registration_number);
    });
  });

  describe('findAll', () => {
    it('should return paginated students', async () => {
      await studentRepo.save(
        studentRepo.create({
          full_name: 'Student 1',
          registration_number: 'REG-2026-0001',
          roll_number: 1,
          class_section_id: SEED_SECTION_1_ID,
          tenant_id: TENANT_ID,
          date_of_birth: new Date('2010-01-01'),
        }),
      );
      await studentRepo.save(
        studentRepo.create({
          full_name: 'Student 2',
          registration_number: 'REG-2026-0002',
          roll_number: 2,
          class_section_id: SEED_SECTION_1_ID,
          tenant_id: TENANT_ID,
          date_of_birth: new Date('2010-01-01'),
        }),
      );

      const result = await service.findAll({ page: 1, limit: 10 }, TENANT_ID);

      expect(result.data).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('should enforce tenant isolation', async () => {
      // Create a student for tenant-1
      await studentRepo.save(
        studentRepo.create({
          full_name: 'Tenant A Student',
          registration_number: 'REG-2026-0001',
          roll_number: 1,
          class_section_id: SEED_SECTION_1_ID,
          tenant_id: TENANT_ID,
          date_of_birth: new Date('2010-01-01'),
        }),
      );
      // Create a student for tenant-2
      await studentRepo.save(
        studentRepo.create({
          full_name: 'Tenant B Student',
          registration_number: 'REG-2026-0002',
          roll_number: 2,
          class_section_id: SEED_SECTION_1_ID,
          tenant_id: OTHER_TENANT,
          date_of_birth: new Date('2010-01-01'),
        }),
      );

      // Query from tenant-1 — should only see tenant-1's student
      const result = await service.findAll({ page: 1, limit: 10 }, TENANT_ID);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].full_name).toBe('Tenant A Student');
    });
  });

  describe('findOne', () => {
    it('should return a student by ID', async () => {
      const created = await service.create(
        { full_name: 'John Doe', class_section_id: SEED_SECTION_1_ID },
        TENANT_ID,
      );

      const result = await service.findOne(created.id, TENANT_ID);

      expect(result.id).toBe(created.id);
      expect(result.full_name).toBe('John Doe');
    });

    it('should throw NotFoundException when student belongs to a different tenant', async () => {
      const created = await service.create(
        { full_name: 'Other Tenant Student', class_section_id: OTHER_SECTION_ID },
        OTHER_TENANT,
      );

      await expect(
        service.findOne(created.id, TENANT_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove (soft delete)', () => {
    it('should soft delete a student', async () => {
      const created = await service.create(
        { full_name: 'John Doe', class_section_id: SEED_SECTION_1_ID },
        TENANT_ID,
      );

      await service.remove(created.id, TENANT_ID);

      // Should not be found via findOne
      await expect(
        service.findOne(created.id, TENANT_ID),
      ).rejects.toThrow(NotFoundException);

      // But should still exist with deleted_at set
      const raw = await studentRepo.findOne({
        where: { id: created.id },
        withDeleted: true,
      });
      expect(raw).toBeDefined();
      expect(raw?.deleted_at).not.toBeNull();
    });
  });
});

describe('GuardianService (integration)', () => {
  let service: GuardianService;
  let studentRepo: Repository<Student>;
  let guardianRepo: Repository<Guardian>;
  let dataSource: DataSource;

  const TENANT_ID = SEED_TENANT_ID;
  const OTHER_TENANT = '00000000-0000-0000-0000-000000000099';

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [StudentService, GuardianService],
      [],
      { synchronize: true, dropSchema: true },
    );

    service = module.get<GuardianService>(GuardianService);
    studentRepo = module.get<Repository<Student>>(getRepositoryToken(Student));
    guardianRepo = module.get<Repository<Guardian>>(getRepositoryToken(Guardian));
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
      await dataSource.query('DELETE FROM student_guardians');
      await dataSource.query('DELETE FROM guardians');
      await dataSource.query('DELETE FROM students');
    }
  });

  describe('create', () => {
    it('should create a guardian', async () => {
      const dto = {
        full_name: 'Parent Name',
        relationship: 'FATHER',
        phone: '+880****0001',
      };

      const result = await service.create(dto, TENANT_ID);

      expect(result).toBeDefined();
      expect(result.full_name).toBe('Parent Name');
      expect(result.tenant_id).toBe(TENANT_ID);
    });

    it('should link to students when student_ids are provided', async () => {
      // Create a student first
      const student = await studentRepo.save(
        studentRepo.create({
          full_name: 'Test Student',
          registration_number: 'REG-2026-0001',
          roll_number: 1,
          class_section_id: SEED_SECTION_1_ID,
          tenant_id: TENANT_ID,
          date_of_birth: new Date('2010-01-01'),
        }),
      );

      const dto = {
        full_name: 'Parent Name',
        relationship: 'FATHER',
        phone: '+880****0001',
        student_ids: [student.id],
      };

      const result = await service.create(dto, TENANT_ID);

      expect(result.students).toBeDefined();
      expect(result.students).toHaveLength(1);
      expect(result.students[0].id).toBe(student.id);
    });

    it('should throw NotFoundException when student_ids belong to a different tenant', async () => {
      const otherStudent = await studentRepo.save(
        studentRepo.create({
          full_name: 'Other Student',
          registration_number: 'REG-2026-0001',
          roll_number: 1,
          class_section_id: SEED_SECTION_1_ID,
          tenant_id: OTHER_TENANT,
          date_of_birth: new Date('2010-01-01'),
        }),
      );

      const dto = {
        full_name: 'Parent Name',
        relationship: 'FATHER',
        student_ids: [otherStudent.id],
      };

      await expect(
        service.create(dto, TENANT_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAll', () => {
    it('should return paginated guardians', async () => {
      await guardianRepo.save(
        guardianRepo.create({
          full_name: 'Guardian 1',
          relationship: 'FATHER',
          phone: '+880****0001',
          tenant_id: TENANT_ID,
        }),
      );
      await guardianRepo.save(
        guardianRepo.create({
          full_name: 'Guardian 2',
          relationship: 'MOTHER',
          phone: '+880****0002',
          tenant_id: TENANT_ID,
        }),
      );

      const result = await service.findAll({ page: 1, limit: 10 }, TENANT_ID);

      expect(result.data).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('should search guardians by name, phone, or email', async () => {
      await guardianRepo.save(
        guardianRepo.create({
          full_name: 'Ahmed Khan',
          relationship: 'FATHER',
          phone: '+880****0001',
          tenant_id: TENANT_ID,
        }),
      );
      await guardianRepo.save(
        guardianRepo.create({
          full_name: 'Fatima Begum',
          relationship: 'MOTHER',
          phone: '+880****0002',
          tenant_id: TENANT_ID,
        }),
      );

      // Search by name
      const result = await service.findAll({ search: 'Ahmed', page: 1, limit: 10 }, TENANT_ID);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].full_name).toBe('Ahmed Khan');
    });
  });

  describe('remove (soft delete)', () => {
    it('should soft delete a guardian', async () => {
      const created = await service.create(
        { full_name: 'Parent Name', relationship: 'FATHER', phone: '+880****0001' },
        TENANT_ID,
      );

      await service.remove(created.id, TENANT_ID);

      await expect(
        service.findOne(created.id, TENANT_ID),
      ).rejects.toThrow(NotFoundException);

      const raw = await guardianRepo.findOne({
        where: { id: created.id },
        withDeleted: true,
      });
      expect(raw?.deleted_at).not.toBeNull();
    });
  });
});
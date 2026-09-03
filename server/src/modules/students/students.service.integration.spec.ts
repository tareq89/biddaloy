import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { Repository, DataSource } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { StudentService, GuardianService } from './students.service';
import { Student } from './entities/student.entity';
import { Guardian } from './entities/guardian.entity';
import { Enrollment } from './entities/enrollment.entity';
import { ALL_ENTITIES } from '@test/all-entities';
import { School } from '../schools/entities/school.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { createTestModule } from '@test/helpers/module.helper';
import { SEED_TENANT_ID, SEED_SECTION_1_ID, SEED_ACADEMIC_YEAR_ID } from '@test/constants';
import { EnrollmentStatus, CommunicationMedium } from '@biddaloy/shared';

/**
 * Integration tests for StudentService and GuardianService.
 *
 * These tests run against a real PostgreSQL database and verify
 * tenant isolation, soft deletes, registration number generation,
 * and guardian-to-student linking.
 */

const OTHER_TENANT = '00000000-0000-4000-8000-000000000099';
const OTHER_SECTION_ID = '00000000-0000-4000-8000-000000000097';

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
  await ds.query('DELETE FROM enrollments');
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
  await schoolRepo.save(
    schoolRepo.create({
      id: SEED_TENANT_ID,
      name: 'Test School',
      slug: 'test-school',
      tenant_id: SEED_TENANT_ID,
    }),
  );
  await ayRepo.save(
    ayRepo.create({
      id: SEED_ACADEMIC_YEAR_ID,
      name: '2026-2027',
      start_date: new Date('2026-01-01'),
      end_date: new Date('2026-12-31'),
      is_current: true,
      tenant_id: SEED_TENANT_ID,
    }),
  );
  await classRepo.save(
    classRepo.create({
      id: SEED_TENANT_ID,
      name: 'Class One',
      academic_year_id: SEED_ACADEMIC_YEAR_ID,
      tenant_id: SEED_TENANT_ID,
    }),
  );
  await sectionRepo.save(
    sectionRepo.create({
      id: SEED_SECTION_1_ID,
      section_name: 'Section A',
      class_id: SEED_TENANT_ID,
      tenant_id: SEED_TENANT_ID,
    }),
  );

  // Other tenant reference data (for tenant isolation tests)
  const OTHER_AY_ID = '00000000-0000-4000-8000-000000000099';
  const OTHER_CLASS_ID = '00000000-0000-4000-8000-000000000098';
  const OTHER_SECTION_ID = '00000000-0000-4000-8000-000000000097';
  await schoolRepo.save(
    schoolRepo.create({
      id: OTHER_TENANT,
      name: 'Other School',
      slug: 'other-school',
      tenant_id: OTHER_TENANT,
    }),
  );
  await ayRepo.save(
    ayRepo.create({
      id: OTHER_AY_ID,
      name: 'Other 2026-2027',
      start_date: new Date('2026-01-01'),
      end_date: new Date('2026-12-31'),
      is_current: true,
      tenant_id: OTHER_TENANT,
    }),
  );
  await classRepo.save(
    classRepo.create({
      id: OTHER_CLASS_ID,
      name: 'Other Class',
      academic_year_id: OTHER_AY_ID,
      tenant_id: OTHER_TENANT,
    }),
  );
  await sectionRepo.save(
    sectionRepo.create({
      id: OTHER_SECTION_ID,
      section_name: 'Other Section',
      class_id: OTHER_CLASS_ID,
      tenant_id: OTHER_TENANT,
    }),
  );
}

describe('StudentService (integration)', () => {
  let service: StudentService;
  let guardianService: GuardianService;
  let studentRepo: Repository<Student>;
  let guardianRepo: Repository<Guardian>;
  let enrollmentRepo: Repository<Enrollment>;
  let dataSource: DataSource;

  const TENANT_ID = SEED_TENANT_ID;
  const OTHER_TENANT = '00000000-0000-4000-8000-000000000099';

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [StudentService, GuardianService], [], {
      synchronize: true,
      dropSchema: true,
    });

    service = module.get<StudentService>(StudentService);
    guardianService = module.get<GuardianService>(GuardianService);
    studentRepo = module.get<Repository<Student>>(getRepositoryToken(Student));
    guardianRepo = module.get<Repository<Guardian>>(getRepositoryToken(Guardian));
    enrollmentRepo = module.get<Repository<Enrollment>>(getRepositoryToken(Enrollment));
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
      await dataSource.query('DELETE FROM enrollments');
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
        class_section_id: '00000000-0000-4000-8000-000000000000',
      };

      await expect(service.create(dto, TENANT_ID)).rejects.toThrow(NotFoundException);
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
      await expect(service.create(dto, TENANT_ID)).rejects.toThrow(NotFoundException);
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

    it('serializes concurrent creates so no two students in the same section collide on roll_number or registration_number', async () => {
      // Fired concurrently against an empty section — the pessimistic
      // row lock alone can't serialize this (there's no row to lock yet
      // for the very first insert); the advisory lock added in
      // StudentService.create is what prevents duplicates here.
      const students = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          service.create(
            { full_name: `Concurrent ${i}`, class_section_id: SEED_SECTION_1_ID },
            TENANT_ID,
          ),
        ),
      );

      const rollNumbers = students.map((s) => s.roll_number);
      const registrationNumbers = students.map((s) => s.registration_number);
      expect(new Set(rollNumbers).size).toBe(5);
      expect(new Set(registrationNumbers).size).toBe(5);
    });

    // ────────────────────────
    //  [8.11.3] Day-one enrollment history
    // ────────────────────────
    it('also creates an ACTIVE Enrollment row matching the target class/section/year', async () => {
      const student = await service.create(
        { full_name: 'Enrolled Student', class_section_id: SEED_SECTION_1_ID },
        TENANT_ID,
      );

      const enrollment = await enrollmentRepo.findOne({ where: { student_id: student.id } });

      expect(enrollment).not.toBeNull();
      expect(enrollment!.enrollment_status).toBe(EnrollmentStatus.ACTIVE);
      expect(enrollment!.section_id).toBe(SEED_SECTION_1_ID);
      expect(enrollment!.class_id).toBe(student.class_section.class.id);
      expect(enrollment!.academic_year_id).toBe(SEED_ACADEMIC_YEAR_ID);
      expect(enrollment!.tenant_id).toBe(TENANT_ID);
    });

    it('rolls back the enrollment write too when the student insert itself fails', async () => {
      // An explicit roll_number that collides with an existing student in
      // the same section trips the unique (class_section_id, roll_number)
      // index inside the create transaction — proves the enrollment write
      // is part of the same atomic unit as the student insert, not a
      // separate best-effort call after it: if the transaction ever did
      // partially commit, this section would show orphaned rows behind it.
      const existing = await service.create(
        { full_name: 'Existing Student', class_section_id: SEED_SECTION_1_ID, roll_number: 5 },
        TENANT_ID,
      );

      await expect(
        service.create(
          {
            full_name: 'Colliding Student',
            class_section_id: SEED_SECTION_1_ID,
            roll_number: 5,
          },
          TENANT_ID,
        ),
      ).rejects.toThrow();

      const enrollmentsInSection = await enrollmentRepo.find({
        where: { section_id: SEED_SECTION_1_ID },
      });
      expect(enrollmentsInSection).toHaveLength(1);
      expect(enrollmentsInSection[0].student_id).toBe(existing.id);
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

    it('should search students by name or roll number', async () => {
      await studentRepo.save(
        studentRepo.create({
          full_name: 'Ahmed Khan',
          registration_number: 'REG-2026-0001',
          roll_number: 7,
          class_section_id: SEED_SECTION_1_ID,
          tenant_id: TENANT_ID,
          date_of_birth: new Date('2010-01-01'),
        }),
      );
      await studentRepo.save(
        studentRepo.create({
          full_name: 'Fatima Begum',
          registration_number: 'REG-2026-0002',
          roll_number: 8,
          class_section_id: SEED_SECTION_1_ID,
          tenant_id: TENANT_ID,
          date_of_birth: new Date('2010-01-01'),
        }),
      );

      // Search by name
      const byName = await service.findAll({ search: 'Ahmed', page: 1, limit: 10 }, TENANT_ID);
      expect(byName.data).toHaveLength(1);
      expect(byName.data[0].full_name).toBe('Ahmed Khan');

      // Search is case-insensitive
      const byLowercaseName = await service.findAll(
        { search: 'ahmed', page: 1, limit: 10 },
        TENANT_ID,
      );
      expect(byLowercaseName.data).toHaveLength(1);
      expect(byLowercaseName.data[0].full_name).toBe('Ahmed Khan');

      // Search by roll number
      const byRoll = await service.findAll({ search: '8', page: 1, limit: 10 }, TENANT_ID);
      expect(byRoll.data).toHaveLength(1);
      expect(byRoll.data[0].full_name).toBe('Fatima Begum');
    });

    it("does not return another tenant's student when searching by name or roll number", async () => {
      await studentRepo.save(
        studentRepo.create({
          full_name: 'Ahmed Khan',
          registration_number: 'REG-2026-0001',
          roll_number: 7,
          class_section_id: OTHER_SECTION_ID,
          tenant_id: OTHER_TENANT,
          date_of_birth: new Date('2010-01-01'),
        }),
      );

      const byName = await service.findAll({ search: 'Ahmed', page: 1, limit: 10 }, TENANT_ID);
      expect(byName.data).toHaveLength(0);

      const byRoll = await service.findAll({ search: '7', page: 1, limit: 10 }, TENANT_ID);
      expect(byRoll.data).toHaveLength(0);
    });

    it('does not return a soft-deleted student when searching by name or roll number', async () => {
      const created = await service.create(
        { full_name: 'Ahmed Khan', class_section_id: SEED_SECTION_1_ID },
        TENANT_ID,
      );
      await service.remove(created.id, TENANT_ID);

      const byName = await service.findAll({ search: 'Ahmed', page: 1, limit: 10 }, TENANT_ID);
      expect(byName.data).toHaveLength(0);

      const byRoll = await service.findAll(
        { search: String(created.roll_number), page: 1, limit: 10 },
        TENANT_ID,
      );
      expect(byRoll.data).toHaveLength(0);
    });

    it('sorts by full_name ascending or descending when sort/order are given', async () => {
      await studentRepo.save(
        studentRepo.create({
          full_name: 'Zahid Islam',
          registration_number: 'REG-2026-0001',
          roll_number: 1,
          class_section_id: SEED_SECTION_1_ID,
          tenant_id: TENANT_ID,
          date_of_birth: new Date('2010-01-01'),
        }),
      );
      await studentRepo.save(
        studentRepo.create({
          full_name: 'Ahmed Khan',
          registration_number: 'REG-2026-0002',
          roll_number: 2,
          class_section_id: SEED_SECTION_1_ID,
          tenant_id: TENANT_ID,
          date_of_birth: new Date('2010-01-01'),
        }),
      );

      const ascending = await service.findAll(
        { sort: 'full_name', order: 'asc', page: 1, limit: 10 },
        TENANT_ID,
      );
      expect(ascending.data.map((s) => s.full_name)).toEqual(['Ahmed Khan', 'Zahid Islam']);

      const descending = await service.findAll(
        { sort: 'full_name', order: 'desc', page: 1, limit: 10 },
        TENANT_ID,
      );
      expect(descending.data.map((s) => s.full_name)).toEqual(['Zahid Islam', 'Ahmed Khan']);
    });

    it('falls back to created_at DESC when no sort is given, same as before sort support existed', async () => {
      const first = await studentRepo.save(
        studentRepo.create({
          full_name: 'Ahmed Khan',
          registration_number: 'REG-2026-0001',
          roll_number: 1,
          class_section_id: SEED_SECTION_1_ID,
          tenant_id: TENANT_ID,
          date_of_birth: new Date('2010-01-01'),
        }),
      );
      const second = await studentRepo.save(
        studentRepo.create({
          full_name: 'Zahid Islam',
          registration_number: 'REG-2026-0002',
          roll_number: 2,
          class_section_id: SEED_SECTION_1_ID,
          tenant_id: TENANT_ID,
          date_of_birth: new Date('2010-01-01'),
        }),
      );

      const result = await service.findAll({ page: 1, limit: 10 }, TENANT_ID);
      expect(result.data.map((s) => s.id)).toEqual([second.id, first.id]);
    });

    it('paginates deterministically with duplicate sort values — no row is skipped or repeated across pages', async () => {
      // Same full_name and same date_of_birth on every row: with `sort:
      // 'full_name'` alone, ties leave row order unspecified page to page,
      // so a `limit: 1` walk can duplicate or skip a row across requests.
      // `id: 'ASC'` as a tiebreaker makes the order (and thus the walk)
      // deterministic.
      const students = await studentRepo.save(
        [1, 2, 3].map((n) =>
          studentRepo.create({
            full_name: 'Ahmed Khan',
            registration_number: `REG-2026-DUP-${n}`,
            roll_number: n,
            class_section_id: SEED_SECTION_1_ID,
            tenant_id: TENANT_ID,
            date_of_birth: new Date('2010-01-01'),
          }),
        ),
      );
      const expectedIds = [...students.map((s) => s.id)].sort();

      const seenIds: string[] = [];
      for (let page = 1; page <= students.length; page++) {
        const result = await service.findAll(
          { sort: 'full_name', order: 'asc', page, limit: 1 },
          TENANT_ID,
        );
        expect(result.data).toHaveLength(1);
        seenIds.push(result.data[0].id);
      }

      expect([...seenIds].sort()).toEqual(expectedIds);
      expect(new Set(seenIds).size).toBe(students.length);
    });

    // [8.14.9] search also matches registration_number now, not just name.
    it('searches by registration_number', async () => {
      await studentRepo.save(
        studentRepo.create({
          full_name: 'Ahmed Khan',
          registration_number: 'REG-2026-9999',
          roll_number: 1,
          class_section_id: SEED_SECTION_1_ID,
          tenant_id: TENANT_ID,
          date_of_birth: new Date('2010-01-01'),
        }),
      );

      const result = await service.findAll(
        { search: '2026-9999', page: 1, limit: 10 },
        TENANT_ID,
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0].full_name).toBe('Ahmed Khan');
    });

    // [8.14.9] % and _ in a search term must not act as SQL wildcards.
    it('treats % and _ in search as literal text, not wildcards', async () => {
      await studentRepo.save(
        studentRepo.create({
          full_name: 'Ahmed Khan',
          registration_number: 'REG-2026-0001',
          roll_number: 1,
          class_section_id: SEED_SECTION_1_ID,
          tenant_id: TENANT_ID,
          date_of_birth: new Date('2010-01-01'),
        }),
      );
      await studentRepo.save(
        studentRepo.create({
          full_name: '100% Attendance',
          registration_number: 'REG-2026-0002',
          roll_number: 2,
          class_section_id: SEED_SECTION_1_ID,
          tenant_id: TENANT_ID,
          date_of_birth: new Date('2010-01-01'),
        }),
      );

      // A bare % would match every student's name if unescaped.
      const percent = await service.findAll({ search: '100%', page: 1, limit: 10 }, TENANT_ID);
      expect(percent.data).toHaveLength(1);
      expect(percent.data[0].full_name).toBe('100% Attendance');
    });

    // [8.14.9] a Bengali-digit roll number search must convert to Latin
    // before matching the integer roll_number column.
    it('searches by roll number typed in Bengali digits', async () => {
      await studentRepo.save(
        studentRepo.create({
          full_name: 'Ahmed Khan',
          registration_number: 'REG-2026-0001',
          roll_number: 103,
          class_section_id: SEED_SECTION_1_ID,
          tenant_id: TENANT_ID,
          date_of_birth: new Date('2010-01-01'),
        }),
      );

      // ১০৩ is the Bengali-digit spelling of 103.
      const result = await service.findAll({ search: '১০৩', page: 1, limit: 10 }, TENANT_ID);

      expect(result.data).toHaveLength(1);
      expect(result.data[0].full_name).toBe('Ahmed Khan');
    });

    it('filters by gender', async () => {
      await studentRepo.save(
        studentRepo.create({
          full_name: 'Ahmed Khan',
          registration_number: 'REG-2026-0001',
          roll_number: 1,
          class_section_id: SEED_SECTION_1_ID,
          tenant_id: TENANT_ID,
          gender: 'MALE',
        }),
      );
      await studentRepo.save(
        studentRepo.create({
          full_name: 'Fatima Begum',
          registration_number: 'REG-2026-0002',
          roll_number: 2,
          class_section_id: SEED_SECTION_1_ID,
          tenant_id: TENANT_ID,
          gender: 'FEMALE',
        }),
      );

      const result = await service.findAll({ gender: 'FEMALE', page: 1, limit: 10 }, TENANT_ID);

      expect(result.data).toHaveLength(1);
      expect(result.data[0].full_name).toBe('Fatima Begum');
    });

    it('filters by date_of_birth_from/date_of_birth_to', async () => {
      await studentRepo.save(
        studentRepo.create({
          full_name: 'Older Student',
          registration_number: 'REG-2026-0001',
          roll_number: 1,
          class_section_id: SEED_SECTION_1_ID,
          tenant_id: TENANT_ID,
          date_of_birth: new Date('2005-01-01'),
        }),
      );
      await studentRepo.save(
        studentRepo.create({
          full_name: 'Younger Student',
          registration_number: 'REG-2026-0002',
          roll_number: 2,
          class_section_id: SEED_SECTION_1_ID,
          tenant_id: TENANT_ID,
          date_of_birth: new Date('2015-01-01'),
        }),
      );

      const result = await service.findAll(
        { date_of_birth_from: '2010-01-01', date_of_birth_to: '2020-01-01', page: 1, limit: 10 },
        TENANT_ID,
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0].full_name).toBe('Younger Student');
    });

    // [8.14.9] search now also matches via the student's guardian(s).
    describe('search via guardian', () => {
      it('finds a student by their guardian full_name or phone', async () => {
        const student1 = await studentRepo.save(
          studentRepo.create({
            full_name: 'Ahmed Khan',
            registration_number: 'REG-2026-0001',
            roll_number: 1,
            class_section_id: SEED_SECTION_1_ID,
            tenant_id: TENANT_ID,
          }),
        );
        const student2 = await studentRepo.save(
          studentRepo.create({
            full_name: 'Fatima Begum',
            registration_number: 'REG-2026-0002',
            roll_number: 2,
            class_section_id: SEED_SECTION_1_ID,
            tenant_id: TENANT_ID,
          }),
        );
        const guardian = await guardianRepo.save(
          guardianRepo.create({
            full_name: 'Karim Uddin',
            phone: '+8801711112222',
            relationship: 'Father',
            tenant_id: TENANT_ID,
          }),
        );
        await dataSource.query(
          'INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)',
          [student1.id, guardian.id],
        );

        const byGuardianName = await service.findAll(
          { search: 'Karim Uddin', page: 1, limit: 10 },
          TENANT_ID,
        );
        expect(byGuardianName.data).toHaveLength(1);
        expect(byGuardianName.data[0].id).toBe(student1.id);
        // Confirms this branch didn't accidentally match every student.
        expect(byGuardianName.data.map((s) => s.id)).not.toContain(student2.id);

        const byGuardianPhone = await service.findAll(
          { search: '01711112222', page: 1, limit: 10 },
          TENANT_ID,
        );
        expect(byGuardianPhone.data).toHaveLength(1);
        expect(byGuardianPhone.data[0].id).toBe(student1.id);
      });

      // Cross-tenant: a guardian in tenant B must never surface a tenant A
      // student search, even if (hypothetically) linked cross-tenant — the
      // guardian join must carry its own tenant_id, not just rely on the
      // student_guardians join table.
      it('does not match a guardian belonging to another tenant', async () => {
        const student = await studentRepo.save(
          studentRepo.create({
            full_name: 'Ahmed Khan',
            registration_number: 'REG-2026-0001',
            roll_number: 1,
            class_section_id: SEED_SECTION_1_ID,
            tenant_id: TENANT_ID,
          }),
        );
        const otherTenantGuardian = await guardianRepo.save(
          guardianRepo.create({
            full_name: 'Karim Uddin',
            phone: '+8801711112222',
            relationship: 'Father',
            tenant_id: OTHER_TENANT,
          }),
        );
        // Deliberately force a cross-tenant join row — proves the query's
        // own `guardian.tenant_id = :tenantId` guard, not the join table's
        // absence of such rows, is what keeps this out of the result.
        await dataSource.query(
          'INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)',
          [student.id, otherTenantGuardian.id],
        );

        const result = await service.findAll(
          { search: 'Karim Uddin', page: 1, limit: 10 },
          TENANT_ID,
        );

        expect(result.data).toHaveLength(0);
      });

      // A student with two guardians matching the search must still
      // appear exactly once, and `total` must reflect distinct students,
      // not joined rows.
      it('does not inflate total when a matched student has multiple guardians', async () => {
        const student = await studentRepo.save(
          studentRepo.create({
            full_name: 'Ahmed Khan',
            registration_number: 'REG-2026-0001',
            roll_number: 1,
            class_section_id: SEED_SECTION_1_ID,
            tenant_id: TENANT_ID,
          }),
        );
        const guardians = await guardianRepo.save([
          guardianRepo.create({
            full_name: 'Karim Uddin',
            phone: '+8801711112222',
            relationship: 'Father',
            tenant_id: TENANT_ID,
          }),
          guardianRepo.create({
            full_name: 'Karim Rahman',
            phone: '+8801711113333',
            relationship: 'Uncle',
            tenant_id: TENANT_ID,
          }),
        ]);
        for (const guardian of guardians) {
          await dataSource.query(
            'INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)',
            [student.id, guardian.id],
          );
        }

        const result = await service.findAll({ search: 'Karim', page: 1, limit: 10 }, TENANT_ID);

        expect(result.data).toHaveLength(1);
        expect(result.total).toBe(1);
      });
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

      await expect(service.findOne(created.id, TENANT_ID)).rejects.toThrow(NotFoundException);
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
      await expect(service.findOne(created.id, TENANT_ID)).rejects.toThrow(NotFoundException);

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
  const OTHER_TENANT = '00000000-0000-4000-8000-000000000099';

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [StudentService, GuardianService], [], {
      synchronize: true,
      dropSchema: true,
    });

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
      await dataSource.query('DELETE FROM enrollments');
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

    it('defaults notifications_enabled to true, so existing reminders keep flowing', async () => {
      const result = await service.create(
        { full_name: 'Parent Name', relationship: 'FATHER', phone: '+880****0001' },
        TENANT_ID,
      );

      const stored = await guardianRepo.findOneOrFail({ where: { id: result.id } });
      expect(stored.notifications_enabled).toBe(true);
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

      await expect(service.create(dto, TENANT_ID)).rejects.toThrow(NotFoundException);
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

    // [8.11.4]'s list page "Linked students" column, and the global-search
    // launcher's `guardian.students.length > 0` filter — both need
    // `students` loaded, which neither findAll branch loaded before.
    it('loads each guardian`s linked students (no-search branch)', async () => {
      const student = await studentRepo.save(
        studentRepo.create({
          full_name: 'Linked Student',
          registration_number: 'REG-2026-0002',
          roll_number: 2,
          class_section_id: SEED_SECTION_1_ID,
          tenant_id: TENANT_ID,
          date_of_birth: new Date('2010-01-01'),
        }),
      );
      await service.create(
        { full_name: 'Guardian With Child', relationship: 'FATHER', student_ids: [student.id] },
        TENANT_ID,
      );

      const result = await service.findAll({ page: 1, limit: 10 }, TENANT_ID);

      const guardian = result.data.find((g) => g.full_name === 'Guardian With Child');
      expect(guardian?.students).toBeDefined();
      expect(guardian?.students).toHaveLength(1);
      expect(guardian?.students[0].id).toBe(student.id);
    });

    it('loads each guardian`s linked students (search branch)', async () => {
      const student = await studentRepo.save(
        studentRepo.create({
          full_name: 'Linked Student',
          registration_number: 'REG-2026-0003',
          roll_number: 3,
          class_section_id: SEED_SECTION_1_ID,
          tenant_id: TENANT_ID,
          date_of_birth: new Date('2010-01-01'),
        }),
      );
      await service.create(
        {
          full_name: 'Searchable Guardian',
          relationship: 'FATHER',
          student_ids: [student.id],
        },
        TENANT_ID,
      );

      const result = await service.findAll({ search: 'Searchable', page: 1, limit: 10 }, TENANT_ID);

      expect(result.data).toHaveLength(1);
      expect(result.data[0].students).toBeDefined();
      expect(result.data[0].students).toHaveLength(1);
      expect(result.data[0].students[0].id).toBe(student.id);
    });

    // [8.14.9] search regression: `rahim` (lowercase) must find `Rahim`
    // (mixed case) — the original Like-based search was case-sensitive.
    it('finds a guardian searched in a different case (case-insensitive)', async () => {
      await guardianRepo.save(
        guardianRepo.create({
          full_name: 'Rahim Uddin',
          relationship: 'FATHER',
          tenant_id: TENANT_ID,
        }),
      );

      const result = await service.findAll({ search: 'rahim', page: 1, limit: 10 }, TENANT_ID);

      expect(result.data).toHaveLength(1);
      expect(result.data[0].full_name).toBe('Rahim Uddin');
    });

    it('filters by relationship', async () => {
      await guardianRepo.save(
        guardianRepo.create({ full_name: 'Father Guardian', relationship: 'FATHER', tenant_id: TENANT_ID }),
      );
      await guardianRepo.save(
        guardianRepo.create({ full_name: 'Mother Guardian', relationship: 'MOTHER', tenant_id: TENANT_ID }),
      );

      const result = await service.findAll({ relationship: 'MOTHER', page: 1, limit: 10 }, TENANT_ID);

      expect(result.data).toHaveLength(1);
      expect(result.data[0].full_name).toBe('Mother Guardian');
    });

    it('filters by preferred_communication', async () => {
      await guardianRepo.save(
        guardianRepo.create({
          full_name: 'SMS Guardian',
          relationship: 'FATHER',
          preferred_communication: CommunicationMedium.SMS,
          tenant_id: TENANT_ID,
        }),
      );
      await guardianRepo.save(
        guardianRepo.create({
          full_name: 'Email Guardian',
          relationship: 'MOTHER',
          preferred_communication: CommunicationMedium.EMAIL,
          tenant_id: TENANT_ID,
        }),
      );

      const result = await service.findAll(
        { preferred_communication: CommunicationMedium.EMAIL, page: 1, limit: 10 },
        TENANT_ID,
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0].full_name).toBe('Email Guardian');
    });

    it('filters by is_primary_contact', async () => {
      await guardianRepo.save(
        guardianRepo.create({
          full_name: 'Primary Guardian',
          relationship: 'FATHER',
          is_primary_contact: true,
          tenant_id: TENANT_ID,
        }),
      );
      await guardianRepo.save(
        guardianRepo.create({
          full_name: 'Secondary Guardian',
          relationship: 'MOTHER',
          is_primary_contact: false,
          tenant_id: TENANT_ID,
        }),
      );

      const result = await service.findAll(
        { is_primary_contact: false, page: 1, limit: 10 },
        TENANT_ID,
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0].full_name).toBe('Secondary Guardian');
    });

    it('sorts by full_name using the Bengali collation', async () => {
      await guardianRepo.save(
        guardianRepo.create({ full_name: 'Zebra Guardian', relationship: 'FATHER', tenant_id: TENANT_ID }),
      );
      await guardianRepo.save(
        guardianRepo.create({ full_name: 'Apple Guardian', relationship: 'MOTHER', tenant_id: TENANT_ID }),
      );

      const result = await service.findAll(
        { sort: 'full_name', order: 'asc', page: 1, limit: 10 },
        TENANT_ID,
      );

      expect(result.data.map((g) => g.full_name)).toEqual(['Apple Guardian', 'Zebra Guardian']);
    });

    // Cross-tenant isolation for every new filter, per server/CLAUDE.md.
    it('does not return another tenant’s guardian for any of the new filters', async () => {
      await guardianRepo.save(
        guardianRepo.create({
          full_name: 'Other Tenant Guardian',
          relationship: 'FATHER',
          preferred_communication: CommunicationMedium.EMAIL,
          is_primary_contact: true,
          tenant_id: OTHER_TENANT,
        }),
      );

      const result = await service.findAll(
        {
          relationship: 'FATHER',
          preferred_communication: CommunicationMedium.EMAIL,
          is_primary_contact: true,
          page: 1,
          limit: 10,
        },
        TENANT_ID,
      );

      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  /**
   * [5.4a] Self-service ownership. The caller never names a guardian id —
   * the row is chosen by `user_id` AND `tenant_id`, so a user holding
   * memberships in two tenants can only ever reach the row in the tenant
   * they are currently acting in.
   */
  describe('findOwn / updateOwn', () => {
    const OWNER_USER_ID = '00000000-0000-4000-8000-0000054a1001';
    const OTHER_USER_ID = '00000000-0000-4000-8000-0000054a1002';

    beforeEach(async () => {
      for (const [id, email] of [
        [OWNER_USER_ID, 'own-guardian-owner@example.com'],
        [OTHER_USER_ID, 'own-guardian-other@example.com'],
      ]) {
        await dataSource.query(
          `INSERT INTO users (id, email, full_name, status, created_at, updated_at)
           VALUES ($1, $2, 'Own Guardian Fixture', 'ACTIVE', NOW(), NOW())
           ON CONFLICT DO NOTHING`,
          [id, email],
        );
      }
    });

    const makeGuardian = (userId: string | null, tenantId: string) =>
      guardianRepo.save(
        guardianRepo.create({
          full_name: 'Own Guardian',
          relationship: 'FATHER',
          phone: '+8801700000001',
          alternate_phone: '+8801700000002',
          email: 'own-guardian@example.com',
          tenant_id: tenantId,
          user_id: userId,
        }),
      );

    it('findOwn returns the row linked to that user in that tenant', async () => {
      const guardian = await makeGuardian(OWNER_USER_ID, TENANT_ID);

      const found = await service.findOwn(OWNER_USER_ID, TENANT_ID);

      expect(found.id).toBe(guardian.id);
    });

    it('findOwn does not cross tenants, even for the same user_id', async () => {
      await makeGuardian(OWNER_USER_ID, TENANT_ID);

      await expect(service.findOwn(OWNER_USER_ID, OTHER_TENANT)).rejects.toThrow(NotFoundException);
    });

    it('findOwn ignores soft-deleted rows', async () => {
      const guardian = await makeGuardian(OWNER_USER_ID, TENANT_ID);
      await guardianRepo.softDelete({ id: guardian.id });

      await expect(service.findOwn(OWNER_USER_ID, TENANT_ID)).rejects.toThrow(NotFoundException);

      // The row is still there — `findOwn` skipped it because `deleted_at` is
      // set, not because the delete was a hard one.
      const softDeleted = await guardianRepo.findOne({
        where: { id: guardian.id },
        withDeleted: true,
      });
      expect(softDeleted).not.toBeNull();
      expect(softDeleted?.deleted_at).not.toBeNull();
    });

    it('findOwn throws for a user with no guardian row', async () => {
      await expect(service.findOwn(OTHER_USER_ID, TENANT_ID)).rejects.toThrow(NotFoundException);
    });

    it('updateOwn writes only the contact fields', async () => {
      const guardian = await makeGuardian(OWNER_USER_ID, TENANT_ID);

      const updated = await service.updateOwn(
        OWNER_USER_ID,
        { phone: '+8801799999999', preferred_communication: CommunicationMedium.EMAIL },
        TENANT_ID,
      );

      expect(updated.id).toBe(guardian.id);
      expect(updated.phone).toBe('+8801799999999');
      expect(updated.preferred_communication).toBe(CommunicationMedium.EMAIL);
      expect(updated.full_name).toBe('Own Guardian');
    });

    it("updateOwn maps '' to NULL", async () => {
      await makeGuardian(OWNER_USER_ID, TENANT_ID);

      const updated = await service.updateOwn(
        OWNER_USER_ID,
        { alternate_phone: '', email: '' },
        TENANT_ID,
      );

      expect(updated.alternate_phone).toBeNull();
      expect(updated.email).toBeNull();
    });

    it("updateOwn never touches another tenant's row with a matching user_id", async () => {
      // Guardian.user_id is a global @OneToOne, so the two rows below cannot
      // share a user. The stand-in: an identically-shaped row in the other
      // tenant that must be untouched by the tenant-scoped update.
      const mine = await makeGuardian(OWNER_USER_ID, TENANT_ID);
      const theirs = await makeGuardian(OTHER_USER_ID, OTHER_TENANT);

      await service.updateOwn(OWNER_USER_ID, { phone: '+8801788888888' }, TENANT_ID);

      const untouched = await guardianRepo.findOneOrFail({ where: { id: theirs.id } });
      expect(untouched.phone).toBe('+8801700000001');
      const changed = await guardianRepo.findOneOrFail({ where: { id: mine.id } });
      expect(changed.phone).toBe('+8801788888888');
    });

    it('updateOwn flips notifications_enabled and returns it', async () => {
      await makeGuardian(OWNER_USER_ID, TENANT_ID);

      const off = await service.updateOwn(
        OWNER_USER_ID,
        { notifications_enabled: false },
        TENANT_ID,
      );
      expect(off.notifications_enabled).toBe(false);

      const on = await service.updateOwn(OWNER_USER_ID, { notifications_enabled: true }, TENANT_ID);
      expect(on.notifications_enabled).toBe(true);
    });

    it("updateOwn never flips notifications_enabled on another tenant's row", async () => {
      const theirs = await makeGuardian(OTHER_USER_ID, OTHER_TENANT);
      await makeGuardian(OWNER_USER_ID, TENANT_ID);

      await service.updateOwn(OWNER_USER_ID, { notifications_enabled: false }, TENANT_ID);

      const untouched = await guardianRepo.findOneOrFail({ where: { id: theirs.id } });
      expect(untouched.notifications_enabled).toBe(true);
    });

    it('staff update can flip notifications_enabled too', async () => {
      const guardian = await makeGuardian(OWNER_USER_ID, TENANT_ID);

      const updated = await service.update(
        guardian.id,
        { notifications_enabled: false },
        TENANT_ID,
      );

      expect(updated.notifications_enabled).toBe(false);
    });

    it('updateOwn refuses when the caller has no guardian row', async () => {
      await expect(
        service.updateOwn(OTHER_USER_ID, { phone: '+8801777777777' }, TENANT_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove (soft delete)', () => {
    it('should soft delete a guardian', async () => {
      const created = await service.create(
        { full_name: 'Parent Name', relationship: 'FATHER', phone: '+880****0001' },
        TENANT_ID,
      );

      await service.remove(created.id, TENANT_ID);

      await expect(service.findOne(created.id, TENANT_ID)).rejects.toThrow(NotFoundException);

      const raw = await guardianRepo.findOne({
        where: { id: created.id },
        withDeleted: true,
      });
      expect(raw?.deleted_at).not.toBeNull();
    });
  });
});

/**
 * [8.14.9] Dedicated regression test for the `bn_icu` collation created by
 * `1788307200000-AddBengaliCollationAndSearchIndexes`. Two spellings of the
 * same name that are canonically equivalent — one using the precomposed
 * Bengali letter ড় (U+09DC, "DDDHA"), one built from ড (U+09A1, "DA") plus a
 * combining nukta (U+09BC) — must sort adjacently under Bengali dictionary
 * order. Under Postgres's default `en_US.utf8` (libc) collation they do
 * not: libc sorts by raw codepoint, so the decomposed spelling (which
 * starts with a *lower* codepoint than the precomposed letter) can land far
 * away from it once other names are interleaved.
 *
 * Named with explicit `\u` escapes in this comment (not just in the code)
 * because editors normalize away the visual difference between the two
 * forms — you cannot tell them apart by eye in a diff.
 */
describe('GuardianService (integration) — Bengali collation', () => {
  let service: GuardianService;
  let guardianRepo: Repository<Guardian>;

  const TENANT_ID = SEED_TENANT_ID;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [GuardianService, StudentService], [], {
      synchronize: true,
      dropSchema: true,
    });

    service = module.get<GuardianService>(GuardianService);
    guardianRepo = module.get<Repository<Guardian>>(getRepositoryToken(Guardian));
    const dataSource = module.get(DataSource);

    await seedReferenceData(dataSource);
  }, 60000);

  it('sorts canonically-equivalent \u09A1\u09BC/\u09DC spellings adjacently, with a Latin name outside the pair', async () => {
    // "\u09AC\u09DC\u09BE" ("b\u01D0" — big) spelled with the precomposed letter
    // \u09DC directly: \u09AC (U+09AC) + \u09DC (U+09DC) + \u09BE (U+09BE). Written
    // with explicit `\\u` JS string escapes, never as a literal pasted
    // character — an editor or diff tool would otherwise silently
    // re-normalize a pasted precomposed/decomposed pair to identical
    // bytes, erasing the very difference this test exists to exercise.
    const precomposed = '\u09AC\u09DC\u09BE';
    // The same word, but with \u09DC spelled as its NFD decomposition:
    // \u09A1 (U+09A1, plain "DA") + a combining nukta \u09BC (U+09BC).
    // Renders identically to `precomposed` above; the underlying bytes differ.
    const decomposed = '\u09AC\u09A1\u09BC\u09BE';

    await guardianRepo.save([
      guardianRepo.create({
        full_name: 'Zebra Guardian', // Latin, sorts after both Bengali forms.
        relationship: 'FATHER',
        tenant_id: TENANT_ID,
      }),
      guardianRepo.create({
        full_name: decomposed,
        relationship: 'MOTHER',
        tenant_id: TENANT_ID,
      }),
      guardianRepo.create({
        full_name: precomposed,
        relationship: 'FATHER',
        tenant_id: TENANT_ID,
      }),
    ]);

    const result = await service.findAll(
      { sort: 'full_name', order: 'asc', page: 1, limit: 10 },
      TENANT_ID,
    );

    const names = result.data.map((g) => g.full_name);
    const precomposedIndex = names.indexOf(precomposed);
    const decomposedIndex = names.indexOf(decomposed);

    expect(precomposedIndex).toBeGreaterThanOrEqual(0);
    expect(decomposedIndex).toBeGreaterThanOrEqual(0);
    // The two canonically-equivalent spellings must be next to each other —
    // no other name (Zebra Guardian) sorted between them.
    expect(Math.abs(precomposedIndex - decomposedIndex)).toBe(1);
    // Both Bengali-script names sort before the Latin-script one under
    // Bengali dictionary order.
    expect(names.indexOf('Zebra Guardian')).toBeGreaterThan(
      Math.max(precomposedIndex, decomposedIndex),
    );
  });
});

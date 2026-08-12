import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { Repository, DataSource } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FeeGenerationService } from './fee-generation.service';
import { FeeStructure } from './entities/fee-structure.entity';
import { FeeStructureStudent } from './entities/fee-structure-student.entity';
import { StudentFee } from './entities/student-fee.entity';
import { Student } from '../students/entities/student.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { School } from '../schools/entities/school.entity';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import {
  SEED_TENANT_ID,
  SEED_CLASS_1_ID,
  SEED_SECTION_1_ID,
  SEED_ACADEMIC_YEAR_ID,
} from '@test/constants';
import { EnrollmentStatus, FeeApplicability, FeeType, CommunicationMedium } from '@biddaloy/shared';

/**
 * Integration tests for FeeGenerationService.
 *
 * Runs against a real PostgreSQL database and verifies the recurring/one-time
 * month-matching rule, ALL/SELECTED applicability, class/section filtering,
 * inactive-student exclusion, idempotent re-runs, and tenant isolation.
 */

const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000000099';
const SEED_CLASS_2_ID = '00000000-0000-4000-8000-000000000031';
const SEED_SECTION_2_ID = '00000000-0000-4000-8000-000000000041';
const SEED_CLASS_2_SECTION_ID = '00000000-0000-4000-8000-000000000042';

let studentSeq = 0;

async function seedReferenceData(ds: DataSource): Promise<void> {
  await ds.query('DELETE FROM payment_allocations');
  await ds.query('DELETE FROM student_fees');
  await ds.query('DELETE FROM fee_structure_students');
  await ds.query('DELETE FROM fee_structures');
  await ds.query('DELETE FROM payments');
  await ds.query('DELETE FROM student_guardians');
  await ds.query('DELETE FROM students');
  await ds.query('DELETE FROM class_sections');
  await ds.query('DELETE FROM classes');
  await ds.query('DELETE FROM academic_years');
  await ds.query('DELETE FROM schools');

  const schoolRepo = ds.getRepository(School);
  const classRepo = ds.getRepository(Class);
  const sectionRepo = ds.getRepository(ClassSection);
  const ayRepo = ds.getRepository(AcademicYear);

  await schoolRepo.save(
    schoolRepo.create({ id: SEED_TENANT_ID, name: 'Test School', slug: 'test-school' }),
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
      id: SEED_CLASS_1_ID,
      name: 'Class One',
      academic_year_id: SEED_ACADEMIC_YEAR_ID,
      tenant_id: SEED_TENANT_ID,
    }),
  );
  await classRepo.save(
    classRepo.create({
      id: SEED_CLASS_2_ID,
      name: 'Class Two',
      academic_year_id: SEED_ACADEMIC_YEAR_ID,
      tenant_id: SEED_TENANT_ID,
    }),
  );
  await sectionRepo.save(
    sectionRepo.create({
      id: SEED_SECTION_1_ID,
      section_name: 'Section A',
      class_id: SEED_CLASS_1_ID,
      tenant_id: SEED_TENANT_ID,
    }),
  );
  await sectionRepo.save(
    sectionRepo.create({
      id: SEED_SECTION_2_ID,
      section_name: 'Section B',
      class_id: SEED_CLASS_1_ID,
      tenant_id: SEED_TENANT_ID,
    }),
  );
  await sectionRepo.save(
    sectionRepo.create({
      id: SEED_CLASS_2_SECTION_ID,
      section_name: 'Class Two Section',
      class_id: SEED_CLASS_2_ID,
      tenant_id: SEED_TENANT_ID,
    }),
  );

  await schoolRepo.save(
    schoolRepo.create({ id: OTHER_TENANT_ID, name: 'Other School', slug: 'other-school' }),
  );
}

describe('FeeGenerationService (integration)', () => {
  let service: FeeGenerationService;
  let structureRepo: Repository<FeeStructure>;
  let fssRepo: Repository<FeeStructureStudent>;
  let studentFeeRepo: Repository<StudentFee>;
  let studentRepo: Repository<Student>;
  let dataSource: DataSource;

  const TENANT_ID = SEED_TENANT_ID;

  function makeStudent(overrides: Partial<Student> = {}) {
    studentSeq += 1;
    return studentRepo.create({
      full_name: `Student ${studentSeq}`,
      registration_number: `REG-GEN-${String(studentSeq).padStart(4, '0')}`,
      roll_number: studentSeq,
      class_section_id: SEED_SECTION_1_ID,
      tenant_id: TENANT_ID,
      date_of_birth: new Date('2010-01-01'),
      preferred_communication: CommunicationMedium.SMS,
      enrollment_status: EnrollmentStatus.ACTIVE,
      ...overrides,
    });
  }

  function makeStructure(overrides: Partial<FeeStructure> = {}) {
    return structureRepo.create({
      fee_type: FeeType.MONTHLY_TUITION,
      name: 'Tuition',
      amount: 1000,
      applicability: FeeApplicability.ALL,
      class_id: SEED_CLASS_1_ID,
      academic_year_id: SEED_ACADEMIC_YEAR_ID,
      month: 1,
      is_recurring: true,
      tenant_id: TENANT_ID,
      ...overrides,
    });
  }

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [FeeGenerationService], [], {
      synchronize: true,
      dropSchema: true,
    });

    service = module.get<FeeGenerationService>(FeeGenerationService);
    structureRepo = module.get<Repository<FeeStructure>>(getRepositoryToken(FeeStructure));
    fssRepo = module.get<Repository<FeeStructureStudent>>(getRepositoryToken(FeeStructureStudent));
    studentFeeRepo = module.get<Repository<StudentFee>>(getRepositoryToken(StudentFee));
    studentRepo = module.get<Repository<Student>>(getRepositoryToken(Student));
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
      await dataSource.query('DELETE FROM payment_allocations');
      await dataSource.query('DELETE FROM student_fees');
      await dataSource.query('DELETE FROM fee_structure_students');
      await dataSource.query('DELETE FROM fee_structures');
      await dataSource.query('DELETE FROM students');
    }
  });

  it('generates a StudentFee for an active student under a recurring structure', async () => {
    await studentRepo.save(makeStudent());
    await structureRepo.save(makeStructure({ month: 1, is_recurring: true }));

    const result = await service.generate(
      { academic_year_id: SEED_ACADEMIC_YEAR_ID, month: 1, year: 2026 },
      TENANT_ID,
    );

    expect(result).toEqual({ generated: 1, skipped: 0, students_evaluated: 1 });
    const fees = await studentFeeRepo.find();
    expect(fees).toHaveLength(1);
    expect(Number(fees[0].total_amount)).toBe(1000);
  });

  it('applies a recurring structure to months after its effective-from month', async () => {
    await studentRepo.save(makeStudent());
    await structureRepo.save(makeStructure({ month: 3, is_recurring: true }));

    const result = await service.generate(
      { academic_year_id: SEED_ACADEMIC_YEAR_ID, month: 5, year: 2026 },
      TENANT_ID,
    );

    expect(result.generated).toBe(1);
  });

  it('does not apply a recurring structure before its effective-from month', async () => {
    await studentRepo.save(makeStudent());
    await structureRepo.save(makeStructure({ month: 6, is_recurring: true }));

    const result = await service.generate(
      { academic_year_id: SEED_ACADEMIC_YEAR_ID, month: 3, year: 2026 },
      TENANT_ID,
    );

    expect(result.generated).toBe(0);
  });

  it('applies a one-time structure only on its exact month', async () => {
    await studentRepo.save(makeStudent());
    await structureRepo.save(
      makeStructure({ month: 4, is_recurring: false, fee_type: FeeType.EXAM_FEE }),
    );

    const matching = await service.generate(
      { academic_year_id: SEED_ACADEMIC_YEAR_ID, month: 4, year: 2026 },
      TENANT_ID,
    );
    expect(matching.generated).toBe(1);
  });

  it('does not apply a one-time structure on a later month', async () => {
    await studentRepo.save(makeStudent());
    await structureRepo.save(
      makeStructure({ month: 4, is_recurring: false, fee_type: FeeType.EXAM_FEE }),
    );

    const later = await service.generate(
      { academic_year_id: SEED_ACADEMIC_YEAR_ID, month: 5, year: 2026 },
      TENANT_ID,
    );
    expect(later.generated).toBe(0);
  });

  it('sums multiple applicable structures into one StudentFee row', async () => {
    await studentRepo.save(makeStudent());
    await structureRepo.save(makeStructure({ name: 'Tuition', amount: 1000, month: 1 }));
    await structureRepo.save(
      makeStructure({ name: 'Library', amount: 200, month: 1, fee_type: FeeType.LIBRARY_FEE }),
    );

    await service.generate(
      { academic_year_id: SEED_ACADEMIC_YEAR_ID, month: 1, year: 2026 },
      TENANT_ID,
    );

    const fees = await studentFeeRepo.find();
    expect(fees).toHaveLength(1);
    expect(Number(fees[0].total_amount)).toBe(1200);
  });

  it('applies a SELECTED structure only to linked students', async () => {
    const included = await studentRepo.save(makeStudent());
    const excluded = await studentRepo.save(makeStudent());
    const structure = await structureRepo.save(
      makeStructure({
        applicability: FeeApplicability.SELECTED,
        amount: 500,
        month: 1,
        fee_type: FeeType.TRANSPORT_FEE,
      }),
    );
    await fssRepo.save(fssRepo.create({ fee_structure_id: structure.id, student_id: included.id }));

    const result = await service.generate(
      { academic_year_id: SEED_ACADEMIC_YEAR_ID, month: 1, year: 2026 },
      TENANT_ID,
    );

    expect(result.generated).toBe(1);
    const fees = await studentFeeRepo.find();
    expect(fees).toHaveLength(1);
    expect(fees[0].student_id).toBe(included.id);
    expect(fees.some((f) => f.student_id === excluded.id)).toBe(false);
  });

  it('skips a student with no applicable structures (total would be zero)', async () => {
    await studentRepo.save(makeStudent());
    // No fee structures at all for this academic year/month.

    const result = await service.generate(
      { academic_year_id: SEED_ACADEMIC_YEAR_ID, month: 1, year: 2026 },
      TENANT_ID,
    );

    expect(result).toEqual({ generated: 0, skipped: 0, students_evaluated: 1 });
  });

  it('excludes inactive students', async () => {
    await studentRepo.save(makeStudent({ enrollment_status: EnrollmentStatus.INACTIVE }));
    await structureRepo.save(makeStructure({ month: 1 }));

    const result = await service.generate(
      { academic_year_id: SEED_ACADEMIC_YEAR_ID, month: 1, year: 2026 },
      TENANT_ID,
    );

    expect(result.students_evaluated).toBe(0);
    expect(result.generated).toBe(0);
  });

  it('filters by class_id', async () => {
    await studentRepo.save(makeStudent({ class_section_id: SEED_SECTION_1_ID }));
    await studentRepo.save(makeStudent({ class_section_id: SEED_CLASS_2_SECTION_ID }));
    await structureRepo.save(makeStructure({ month: 1, class_id: SEED_CLASS_1_ID }));

    const result = await service.generate(
      { academic_year_id: SEED_ACADEMIC_YEAR_ID, month: 1, year: 2026, class_id: SEED_CLASS_1_ID },
      TENANT_ID,
    );

    expect(result.students_evaluated).toBe(1);
    expect(result.generated).toBe(1);
  });

  it('filters by section_id', async () => {
    await studentRepo.save(makeStudent({ class_section_id: SEED_SECTION_1_ID }));
    await studentRepo.save(makeStudent({ class_section_id: SEED_SECTION_2_ID }));
    await structureRepo.save(makeStructure({ month: 1 }));

    const result = await service.generate(
      {
        academic_year_id: SEED_ACADEMIC_YEAR_ID,
        month: 1,
        year: 2026,
        section_id: SEED_SECTION_1_ID,
      },
      TENANT_ID,
    );

    expect(result.students_evaluated).toBe(1);
  });

  it('a section-scoped structure does not apply to a different section in the same class', async () => {
    await studentRepo.save(makeStudent({ class_section_id: SEED_SECTION_2_ID }));
    await structureRepo.save(makeStructure({ month: 1, section_id: SEED_SECTION_1_ID }));

    const result = await service.generate(
      { academic_year_id: SEED_ACADEMIC_YEAR_ID, month: 1, year: 2026 },
      TENANT_ID,
    );

    expect(result.generated).toBe(0);
  });

  it('is idempotent: re-running the same generation produces no new rows', async () => {
    await studentRepo.save(makeStudent());
    await structureRepo.save(makeStructure({ month: 1 }));

    const first = await service.generate(
      { academic_year_id: SEED_ACADEMIC_YEAR_ID, month: 1, year: 2026 },
      TENANT_ID,
    );
    expect(first.generated).toBe(1);

    const second = await service.generate(
      { academic_year_id: SEED_ACADEMIC_YEAR_ID, month: 1, year: 2026 },
      TENANT_ID,
    );
    expect(second).toEqual({ generated: 0, skipped: 1, students_evaluated: 1 });

    const fees = await studentFeeRepo.find();
    expect(fees).toHaveLength(1);
  });

  it('throws BadRequestException when year falls outside the academic year range', async () => {
    // Seeded academic year covers 2026-01-01 through 2026-12-31 only.
    await expect(
      service.generate(
        { academic_year_id: SEED_ACADEMIC_YEAR_ID, month: 1, year: 2027 },
        TENANT_ID,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws NotFoundException when academic year does not belong to tenant', async () => {
    await expect(
      service.generate(
        { academic_year_id: '00000000-0000-4000-8000-000000000000', month: 1, year: 2026 },
        TENANT_ID,
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException when class_id does not belong to tenant', async () => {
    await expect(
      service.generate(
        {
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          month: 1,
          year: 2026,
          class_id: '00000000-0000-4000-8000-000000000000',
        },
        TENANT_ID,
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects generation for a tenant that does not own the academic year', async () => {
    await studentRepo.save(makeStudent());
    await structureRepo.save(makeStructure({ month: 1 }));

    // SEED_ACADEMIC_YEAR_ID belongs to TENANT_ID, not OTHER_TENANT_ID.
    await expect(
      service.generate(
        { academic_year_id: SEED_ACADEMIC_YEAR_ID, month: 1, year: 2026 },
        OTHER_TENANT_ID,
      ),
    ).rejects.toThrow(NotFoundException);
  });
});

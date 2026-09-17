import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DataSource } from 'typeorm';
import { LateFeeService } from './late-fee.service';
import { FeeStructure } from './entities/fee-structure.entity';
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
import { DiscountKind, EnrollmentStatus, FeeStatus, FeeType, PeriodType } from '@biddaloy/shared';

/**
 * Integration tests for `LateFeeService.applyDue` (#678/16.7.4).
 */
const TUITION_STRUCTURE_ID = '00000000-0000-4000-8000-000000000651';
const STUDENT_ID = '00000000-0000-4000-8000-000000000601';
const TODAY = '2026-03-15';

describe('LateFeeService (integration)', () => {
  let ds: DataSource;
  let service: LateFeeService;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [LateFeeService]);
    ds = module.get(DataSource);
    service = module.get(LateFeeService);

    const schoolRepo = ds.getRepository(School);
    const ayRepo = ds.getRepository(AcademicYear);
    const classRepo = ds.getRepository(Class);
    const sectionRepo = ds.getRepository(ClassSection);

    await ayRepo.save(
      ayRepo.create({
        id: SEED_ACADEMIC_YEAR_ID,
        name: '2026-2027',
        start_date: new Date('2026-01-01'),
        end_date: new Date('2026-12-31'),
        tenant_id: SEED_TENANT_ID,
      }),
    );
    await classRepo.save(
      classRepo.create({
        id: SEED_CLASS_1_ID,
        name: 'Class 1',
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

    await schoolRepo.save(
      schoolRepo.create({ id: SEED_TENANT_ID, name: 'Test School', slug: 'test-school' }),
    );
  });

  afterAll(async () => {
    await ds.destroy();
  });

  async function setSettings(lateFees: Record<string, unknown> | undefined): Promise<void> {
    const settings = lateFees ? { fees: { lateFees } } : null;
    await ds
      .getRepository(School)
      .update({ id: SEED_TENANT_ID }, { settings } as unknown as Partial<School>);
  }

  async function seedBill(dueDate: string, overrides: Partial<StudentFee> = {}): Promise<string> {
    const row = await ds.getRepository(StudentFee).save(
      ds.getRepository(StudentFee).create({
        student_id: STUDENT_ID,
        academic_year_id: SEED_ACADEMIC_YEAR_ID,
        fee_structure_id: TUITION_STRUCTURE_ID,
        period_start: new Date('2026-02-01'),
        period_type: PeriodType.MONTH,
        total_amount: 1000,
        paid_amount: 0,
        discount_amount: 0,
        status: FeeStatus.PENDING,
        due_date: new Date(dueDate),
        ...overrides,
      }),
    );
    return row.id;
  }

  // `students`/`fee_structures`/`student_fees` are all in
  // `TRANSACTIONAL_TABLES_CHILD_FIRST` (`test/reset-order.ts`) — the global
  // `beforeEach` truncates them before every test, so they're reseeded
  // here rather than once in `beforeAll`.
  beforeEach(async () => {
    await ds.getRepository(FeeStructure).save(
      ds.getRepository(FeeStructure).create({
        id: TUITION_STRUCTURE_ID,
        fee_type: FeeType.MONTHLY_TUITION,
        name: 'Tuition Fee',
        amount: 1000,
        class_id: SEED_CLASS_1_ID,
        academic_year_id: SEED_ACADEMIC_YEAR_ID,
        tenant_id: SEED_TENANT_ID,
      }),
    );
    await ds.getRepository(Student).save(
      ds.getRepository(Student).create({
        id: STUDENT_ID,
        full_name: 'Late Fee Student',
        registration_number: 'REG-LATE-601',
        tenant_id: SEED_TENANT_ID,
        class_section_id: SEED_SECTION_1_ID,
        enrollment_status: EnrollmentStatus.ACTIVE,
        roll_number: 601,
      }),
    );
  });

  it('enabled late fee with grace period generates an extra bill once due+grace has passed', async () => {
    await setSettings({
      MONTHLY_TUITION: { enabled: true, grace_days: 5, kind: DiscountKind.FLAT, value: 100 },
    });
    // due 2026-03-01 + 5 days grace = 2026-03-06, well before TODAY (2026-03-15)
    await seedBill('2026-03-01');

    await service.applyDue(SEED_TENANT_ID, TODAY);

    const lateFeeBills = await ds.getRepository(StudentFee).find({
      where: { student_id: STUDENT_ID },
      relations: { fee_structure: true },
    });
    const lateFee = lateFeeBills.find((b) => b.fee_structure.fee_type === FeeType.LATE_FEE);
    expect(lateFee).toBeDefined();
    expect(Number(lateFee?.total_amount)).toBe(100);
  });

  it('disabled setting produces nothing', async () => {
    await setSettings({
      MONTHLY_TUITION: { enabled: false, grace_days: 5, kind: DiscountKind.FLAT, value: 100 },
    });
    await seedBill('2026-03-01');

    await service.applyDue(SEED_TENANT_ID, TODAY);

    const bills = await ds.getRepository(StudentFee).find({ where: { student_id: STUDENT_ID } });
    expect(bills).toHaveLength(1); // only the original bill
  });

  it('a bill past due but still within grace produces nothing yet', async () => {
    await setSettings({
      MONTHLY_TUITION: { enabled: true, grace_days: 30, kind: DiscountKind.FLAT, value: 100 },
    });
    // due 2026-03-01 + 30 days grace = 2026-03-31, after TODAY (2026-03-15)
    await seedBill('2026-03-01');

    await service.applyDue(SEED_TENANT_ID, TODAY);

    const bills = await ds.getRepository(StudentFee).find({ where: { student_id: STUDENT_ID } });
    expect(bills).toHaveLength(1);
  });

  it('re-running the job on the same day does not duplicate the late-fee bill', async () => {
    await setSettings({
      MONTHLY_TUITION: { enabled: true, grace_days: 5, kind: DiscountKind.FLAT, value: 100 },
    });
    await seedBill('2026-03-01');

    await service.applyDue(SEED_TENANT_ID, TODAY);
    await service.applyDue(SEED_TENANT_ID, TODAY);

    const bills = await ds.getRepository(StudentFee).find({
      where: { student_id: STUDENT_ID },
      relations: { fee_structure: true },
    });
    const lateFeeBills = bills.filter((b) => b.fee_structure.fee_type === FeeType.LATE_FEE);
    expect(lateFeeBills).toHaveLength(1);
  });

  it('a late-fee bill itself never generates another late fee', async () => {
    await setSettings({
      MONTHLY_TUITION: { enabled: true, grace_days: 0, kind: DiscountKind.FLAT, value: 100 },
      LATE_FEE: { enabled: true, grace_days: 0, kind: DiscountKind.FLAT, value: 50 },
    });
    await seedBill('2026-03-01');

    await service.applyDue(SEED_TENANT_ID, TODAY);
    // Second run: the LATE_FEE settings key is explicitly ignored by
    // `applyDue` regardless — the late-fee bill it just created must not
    // itself spawn another late fee.
    await service.applyDue(SEED_TENANT_ID, TODAY);

    const bills = await ds.getRepository(StudentFee).find({
      where: { student_id: STUDENT_ID },
      relations: { fee_structure: true },
    });
    const lateFeeBills = bills.filter((b) => b.fee_structure.fee_type === FeeType.LATE_FEE);
    expect(lateFeeBills).toHaveLength(1);
  });

  it('rounds PERCENT-based late fees against outstanding (total - discount - paid)', async () => {
    await setSettings({
      MONTHLY_TUITION: { enabled: true, grace_days: 0, kind: DiscountKind.PERCENT, value: 10 },
    });
    await seedBill('2026-03-01', {
      total_amount: 1000,
      discount_amount: 100,
      standing_discount_amount: 100,
      paid_amount: 200,
    });
    // outstanding = 1000 - 100 - 200 = 700; 10% = 70

    await service.applyDue(SEED_TENANT_ID, TODAY);

    const bills = await ds.getRepository(StudentFee).find({
      where: { student_id: STUDENT_ID },
      relations: { fee_structure: true },
    });
    const lateFee = bills.find((b) => b.fee_structure.fee_type === FeeType.LATE_FEE);
    expect(Number(lateFee?.total_amount)).toBe(70);
  });
});

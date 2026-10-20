import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { localDate, localToday } from '../../common/time';
import { Repository, DataSource } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FeeDuesService } from './fee-dues.service';
import { StudentFee } from './entities/student-fee.entity';
import { FeeStructure } from './entities/fee-structure.entity';
import { Student } from '../students/entities/student.entity';
import { Guardian } from '../students/entities/guardian.entity';
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
import {
  EnrollmentStatus,
  CommunicationMedium,
  FeeStatus,
  FeeType,
  PeriodType,
} from '@biddaloy/shared';

/**
 * Integration tests for FeeDuesService (issue #15).
 *
 * Runs against a real PostgreSQL database and verifies dues aggregation
 * (total due, months overdue, previous-month breakdown), filtering,
 * sorting, tenant isolation, and the flagged/reminder-threshold endpoint
 * including guardian contact info.
 */

const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000000099';
const SEED_CLASS_2_ID = '00000000-0000-4000-8000-000000000031';
const SEED_SECTION_2_ID = '00000000-0000-4000-8000-000000000041';
const SEED_CLASS_2_SECTION_ID = '00000000-0000-4000-8000-000000000042';
const TUITION_STRUCTURE_ID = '00000000-0000-4000-8000-000000000051';
const EXAM_STRUCTURE_ID = '00000000-0000-4000-8000-000000000052';
const FINE_STRUCTURE_ID = '00000000-0000-4000-8000-000000000054';

let studentSeq = 0;

async function seedReferenceData(ds: DataSource): Promise<void> {
  await ds.query('DELETE FROM payment_allocations');
  await ds.query('DELETE FROM student_fees');
  await ds.query('DELETE FROM student_guardians');
  await ds.query('DELETE FROM guardians');
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

  await seedFeeStructures(ds);
}

/**
 * `fee_structures` is one of `TRANSACTIONAL_TABLES_CHILD_FIRST` in
 * `test/reset-order.ts` — the global `beforeEach` in `test/setup.ts`
 * deletes it before *every* test, unlike `schools`/`classes`/
 * `academic_years` (reset once per file). `StudentFee.fee_structure_id`
 * is a required FK since 16.1.3, so every test needs these rows back —
 * hence this is called from this file's own `beforeEach` too, not just
 * `seedReferenceData`'s once-per-file setup.
 */
async function seedFeeStructures(ds: DataSource): Promise<void> {
  const feeStructureRepo = ds.getRepository(FeeStructure);
  await feeStructureRepo.save(
    feeStructureRepo.create({
      id: TUITION_STRUCTURE_ID,
      fee_type: FeeType.MONTHLY_TUITION,
      name: 'Tuition Fee',
      amount: 1000,
      class_id: SEED_CLASS_1_ID,
      academic_year_id: SEED_ACADEMIC_YEAR_ID,
      tenant_id: SEED_TENANT_ID,
    }),
  );
  await feeStructureRepo.save(
    feeStructureRepo.create({
      id: EXAM_STRUCTURE_ID,
      fee_type: FeeType.EXAM_FEE,
      name: 'Exam Fee',
      amount: 500,
      class_id: SEED_CLASS_1_ID,
      academic_year_id: SEED_ACADEMIC_YEAR_ID,
      tenant_id: SEED_TENANT_ID,
    }),
  );
  await feeStructureRepo.save(
    feeStructureRepo.create({
      id: FINE_STRUCTURE_ID,
      fee_type: FeeType.FINE,
      name: 'Uniform Fine',
      amount: 50,
      class_id: SEED_CLASS_1_ID,
      academic_year_id: SEED_ACADEMIC_YEAR_ID,
      tenant_id: SEED_TENANT_ID,
    }),
  );
}

describe('FeeDuesService (integration)', () => {
  let service: FeeDuesService;
  let studentFeeRepo: Repository<StudentFee>;
  let studentRepo: Repository<Student>;
  let guardianRepo: Repository<Guardian>;
  let dataSource: DataSource;

  const TENANT_ID = SEED_TENANT_ID;
  // `due_date` is a `date` column compared with the school's day (Asia/Dhaka,
  // `localToday()`), passed in by the app. TypeORM writes a Date into a `date`
  // column from its *local* parts, so build each day from the Dhaka calendar
  // date — otherwise "yesterday" can land on today around midnight.
  const day = (offsetDays: number) => {
    const [y, m, d] = localDate(new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000))
      .split('-')
      .map(Number);
    return new Date(y, m - 1, d);
  };
  const YESTERDAY = day(-1);
  const TODAY = day(0);
  const TOMORROW = day(1);

  function makeStudent(overrides: Partial<Student> = {}) {
    studentSeq += 1;
    return studentRepo.create({
      full_name: `Student ${studentSeq}`,
      registration_number: `REG-DUES-${String(studentSeq).padStart(4, '0')}`,
      roll_number: studentSeq,
      class_section_id: SEED_SECTION_1_ID,
      tenant_id: TENANT_ID,
      date_of_birth: new Date('2010-01-01'),
      preferred_communication: CommunicationMedium.SMS,
      enrollment_status: EnrollmentStatus.ACTIVE,
      ...overrides,
    });
  }

  // `month`/`year` are stored generated columns derived from `period_start`
  // now — callers still pass `month`/`year` for readability and this
  // derives `period_start` from them, same as the fee-generation service does.
  function makeFee(
    studentId: string,
    overrides: Partial<StudentFee> & { month?: number; year?: number } = {},
  ) {
    const { month = 1, year = 2026, ...rest } = overrides;
    return studentFeeRepo.create({
      student_id: studentId,
      academic_year_id: SEED_ACADEMIC_YEAR_ID,
      fee_structure_id: TUITION_STRUCTURE_ID,
      period_start: new Date(Date.UTC(year, month - 1, 1)),
      period_type: PeriodType.MONTH,
      occurrence: 1,
      total_amount: 1000,
      paid_amount: 0,
      discount_amount: 0,
      standing_discount_amount: 0,
      one_off_discount_amount: 0,
      status: FeeStatus.PENDING,
      ...rest,
    });
  }

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [FeeDuesService], [], {
      synchronize: true,
      dropSchema: true,
    });

    service = module.get<FeeDuesService>(FeeDuesService);
    studentFeeRepo = module.get<Repository<StudentFee>>(getRepositoryToken(StudentFee));
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
      await dataSource.query('DELETE FROM payment_allocations');
      await dataSource.query('DELETE FROM student_fees');
      await dataSource.query('DELETE FROM student_guardians');
      await dataSource.query('DELETE FROM guardians');
      await dataSource.query('DELETE FROM students');
      // fee_structures is truncated by the global per-test beforeEach
      // (test/setup.ts) before this one runs — re-seed it every test.
      await seedFeeStructures(dataSource);
    }
  });

  describe('getDues', () => {
    it('returns only students with PENDING or PARTIALLY_PAID fees, excluding PAID', async () => {
      const pending = await studentRepo.save(makeStudent());
      const paid = await studentRepo.save(makeStudent());
      await studentFeeRepo.save(makeFee(pending.id, { status: FeeStatus.PENDING }));
      await studentFeeRepo.save(makeFee(paid.id, { status: FeeStatus.PAID, paid_amount: 1000 }));

      const result = await service.getDues({ page: 1, limit: 10 }, TENANT_ID);

      expect(result.total).toBe(1);
      expect(result.data[0].student_id).toBe(pending.id);
    });

    it('[F-156] balance is rounded to the paisa (exactly 0), and an OVERDUE bill is listed', async () => {
      const student = await studentRepo.save(makeStudent());
      // 100.10 - 100.00 - 0.10 is -5.7e-15 in floating point; the balance must be exactly 0.
      await studentFeeRepo.save(
        makeFee(student.id, {
          month: 1,
          total_amount: 100.1,
          paid_amount: 100,
          discount_amount: 0.1,
          standing_discount_amount: 0.1,
          status: FeeStatus.PARTIALLY_PAID,
        }),
      );
      await studentFeeRepo.save(makeFee(student.id, { month: 2, status: FeeStatus.OVERDUE }));

      const result = await service.getDues({ page: 1, limit: 10 }, TENANT_ID);

      const dues = result.data[0].dues;
      expect(dues).toHaveLength(2);
      expect(dues.find((d) => d.month === 1)!.balance).toBe(0);
      expect(dues.find((d) => d.month === 2)!.status).toBe(FeeStatus.OVERDUE);
    });

    it('computes total_due as the sum of balances across all open fees for a student', async () => {
      const student = await studentRepo.save(makeStudent());
      await studentFeeRepo.save(
        makeFee(student.id, {
          month: 1,
          total_amount: 1000,
          paid_amount: 200,
          discount_amount: 100,
          standing_discount_amount: 100,
          status: FeeStatus.PARTIALLY_PAID,
        }),
      );
      await studentFeeRepo.save(
        makeFee(student.id, {
          month: 2,
          total_amount: 500,
          paid_amount: 0,
          discount_amount: 0,
          status: FeeStatus.PENDING,
        }),
      );

      const result = await service.getDues({ page: 1, limit: 10 }, TENANT_ID);

      // (1000 - 200 - 100) + (500 - 0 - 0) = 700 + 500 = 1200
      expect(result.data[0].total_due).toBe(1200);
      expect(result.data[0].dues).toHaveLength(2);
    });

    it('includes previous month dues even when filtering by a later month', async () => {
      const student = await studentRepo.save(makeStudent());
      await studentFeeRepo.save(makeFee(student.id, { month: 1, year: 2026, total_amount: 500 }));
      await studentFeeRepo.save(makeFee(student.id, { month: 2, year: 2026, total_amount: 700 }));

      const result = await service.getDues({ month: 2, year: 2026, page: 1, limit: 10 }, TENANT_ID);

      // Filtered to students with a due fee in month 2, but the breakdown carries January's due too.
      expect(result.total).toBe(1);
      expect(result.data[0].dues.map((d) => d.month).sort()).toEqual([1, 2]);
      expect(result.data[0].total_due).toBe(1200);
    });

    it('counts months_overdue as fees whose due_date has passed', async () => {
      const student = await studentRepo.save(makeStudent());
      await studentFeeRepo.save(makeFee(student.id, { month: 1, due_date: YESTERDAY }));
      await studentFeeRepo.save(makeFee(student.id, { month: 2, due_date: TOMORROW }));
      await studentFeeRepo.save(makeFee(student.id, { month: 3, due_date: null }));

      const result = await service.getDues({ page: 1, limit: 10 }, TENANT_ID);

      expect(result.data[0].months_overdue).toBe(1);
    });

    it('does not count a fee due today as overdue', async () => {
      // `due_date` is a `date` column, so the old `< NOW()` widened it to
      // midnight and counted today's fee from 00:00 onwards — telling a
      // parent they were late on the day they were asked to pay.
      // `< :today` (the school's day) is the fix; this pins it.
      const student = await studentRepo.save(makeStudent());
      await studentFeeRepo.save(makeFee(student.id, { month: 1, due_date: TODAY }));

      const result = await service.getDues({ page: 1, limit: 10 }, TENANT_ID);

      expect(result.data[0].months_overdue).toBe(0);
    });

    describe('months_overdue at the Dhaka midnight boundary', () => {
      // Postgres CURRENT_DATE cannot be frozen, so these use June 2030: the
      // real DB date (2026) can never match the frozen app clock, and the old
      // CURRENT_DATE code fails them in any DB timezone.
      afterEach(() => vi.useRealTimers());
      const freeze = (iso: string) => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(iso));
      };
      const dueOn = async (...dates: string[]) => {
        const student = await studentRepo.save(makeStudent());
        for (const [i, date] of dates.entries()) {
          const [y, m, d] = date.split('-').map(Number);
          await studentFeeRepo.save(
            makeFee(student.id, { month: i + 1, due_date: new Date(y, m - 1, d) }),
          );
        }
      };

      it('23:59 Dhaka on the due day: not overdue', async () => {
        freeze('2030-06-14T17:59:00Z');
        await dueOn('2030-06-14');
        const result = await service.getDues({ page: 1, limit: 10 }, TENANT_ID);
        expect(result.data[0].months_overdue).toBe(0);
      });

      it('00:00 Dhaka the next day: overdue (not 6 hours later)', async () => {
        freeze('2030-06-14T18:00:00Z');
        await dueOn('2030-06-14');
        const result = await service.getDues({ page: 1, limit: 10 }, TENANT_ID);
        expect(result.data[0].months_overdue).toBe(1);
      });

      it('05:59 Dhaka: the fee due today is not late, the earlier one is', async () => {
        freeze('2030-06-14T23:59:00Z');
        await dueOn('2030-06-14', '2030-06-15');
        const result = await service.getDues({ page: 1, limit: 10 }, TENANT_ID);
        expect(result.data[0].months_overdue).toBe(1);
      });

      it('06:00 Dhaka: still only the earlier fee', async () => {
        freeze('2030-06-15T00:00:00Z');
        await dueOn('2030-06-14', '2030-06-15');
        const result = await service.getDues({ page: 1, limit: 10 }, TENANT_ID);
        expect(result.data[0].months_overdue).toBe(1);
      });
    });

    it('filters by class_id', async () => {
      const inClass1 = await studentRepo.save(makeStudent({ class_section_id: SEED_SECTION_1_ID }));
      const inClass2 = await studentRepo.save(
        makeStudent({ class_section_id: SEED_CLASS_2_SECTION_ID }),
      );
      await studentFeeRepo.save(makeFee(inClass1.id));
      await studentFeeRepo.save(makeFee(inClass2.id));

      const result = await service.getDues(
        { class_id: SEED_CLASS_1_ID, page: 1, limit: 10 },
        TENANT_ID,
      );

      expect(result.total).toBe(1);
      expect(result.data[0].student_id).toBe(inClass1.id);
    });

    it('filters by section_id', async () => {
      const inSection1 = await studentRepo.save(
        makeStudent({ class_section_id: SEED_SECTION_1_ID }),
      );
      const inSection2 = await studentRepo.save(
        makeStudent({ class_section_id: SEED_SECTION_2_ID }),
      );
      await studentFeeRepo.save(makeFee(inSection1.id));
      await studentFeeRepo.save(makeFee(inSection2.id));

      const result = await service.getDues(
        { section_id: SEED_SECTION_1_ID, page: 1, limit: 10 },
        TENANT_ID,
      );

      expect(result.total).toBe(1);
      expect(result.data[0].student_id).toBe(inSection1.id);
    });

    it('filters by status', async () => {
      const pending = await studentRepo.save(makeStudent());
      const partial = await studentRepo.save(makeStudent());
      await studentFeeRepo.save(makeFee(pending.id, { status: FeeStatus.PENDING }));
      await studentFeeRepo.save(
        makeFee(partial.id, { status: FeeStatus.PARTIALLY_PAID, paid_amount: 200 }),
      );

      const result = await service.getDues(
        { status: FeeStatus.PARTIALLY_PAID as any, page: 1, limit: 10 },
        TENANT_ID,
      );

      expect(result.total).toBe(1);
      expect(result.data[0].student_id).toBe(partial.id);
    });

    // [8.14.9] search matches student full_name, registration_number
    // (ILIKE, escaped), or exact roll_number — applied at the SQL stage
    // that produces matching student IDs, so total/totalPages are never
    // corrupted by a post-aggregation filter.
    it('searches by full_name', async () => {
      const match = await studentRepo.save(makeStudent({ full_name: 'Karim Rahman' }));
      const other = await studentRepo.save(makeStudent({ full_name: 'Salma Begum' }));
      await studentFeeRepo.save(makeFee(match.id));
      await studentFeeRepo.save(makeFee(other.id));

      const result = await service.getDues({ search: 'karim', page: 1, limit: 10 }, TENANT_ID);

      expect(result.total).toBe(1);
      expect(result.data[0].student_id).toBe(match.id);
    });

    it('searches by registration_number', async () => {
      const match = await studentRepo.save(makeStudent({ registration_number: 'REG-DUES-9999' }));
      const other = await studentRepo.save(makeStudent());
      await studentFeeRepo.save(makeFee(match.id));
      await studentFeeRepo.save(makeFee(other.id));

      const result = await service.getDues({ search: 'DUES-9999', page: 1, limit: 10 }, TENANT_ID);

      expect(result.total).toBe(1);
      expect(result.data[0].student_id).toBe(match.id);
    });

    // A Bengali-digit roll number search must convert to Latin before
    // matching the integer roll_number column.
    it('searches by roll number typed in Bengali digits', async () => {
      const match = await studentRepo.save(makeStudent({ roll_number: 42 }));
      const other = await studentRepo.save(makeStudent({ roll_number: 7 }));
      await studentFeeRepo.save(makeFee(match.id));
      await studentFeeRepo.save(makeFee(other.id));

      // ৪২ is the Bengali-digit spelling of 42.
      const result = await service.getDues({ search: '৪২', page: 1, limit: 10 }, TENANT_ID);

      expect(result.total).toBe(1);
      expect(result.data[0].student_id).toBe(match.id);
    });

    // A bare % would match every student's name if left unescaped.
    it('treats % in search as literal text, not a wildcard', async () => {
      const literal = await studentRepo.save(makeStudent({ full_name: '100% Attendance' }));
      const other = await studentRepo.save(makeStudent({ full_name: 'Regular Student' }));
      await studentFeeRepo.save(makeFee(literal.id));
      await studentFeeRepo.save(makeFee(other.id));

      const result = await service.getDues({ search: '100%', page: 1, limit: 10 }, TENANT_ID);

      expect(result.total).toBe(1);
      expect(result.data[0].student_id).toBe(literal.id);
    });

    // Cross-tenant: a search term must never surface another tenant's
    // student, even one with a matching name.
    it('does not match a student belonging to another tenant', async () => {
      const otherTenantStudent = await studentRepo.save(
        makeStudent({ full_name: 'Karim Rahman', tenant_id: OTHER_TENANT_ID }),
      );
      await studentFeeRepo.save(makeFee(otherTenantStudent.id));

      const result = await service.getDues({ search: 'karim', page: 1, limit: 10 }, TENANT_ID);

      expect(result.total).toBe(0);
      expect(result.data).toEqual([]);
    });

    it('sorts by due_amount descending by default', async () => {
      const low = await studentRepo.save(makeStudent({ full_name: 'Aaron' }));
      const high = await studentRepo.save(makeStudent({ full_name: 'Zoe' }));
      await studentFeeRepo.save(makeFee(low.id, { total_amount: 100 }));
      await studentFeeRepo.save(makeFee(high.id, { total_amount: 900 }));

      const result = await service.getDues({ page: 1, limit: 10 }, TENANT_ID);

      expect(result.data.map((d) => d.student_id)).toEqual([high.id, low.id]);
    });

    it('sorts by name ascending when requested', async () => {
      const zoe = await studentRepo.save(makeStudent({ full_name: 'Zoe' }));
      const aaron = await studentRepo.save(makeStudent({ full_name: 'Aaron' }));
      await studentFeeRepo.save(makeFee(zoe.id));
      await studentFeeRepo.save(makeFee(aaron.id));

      const result = await service.getDues({ sort_by: 'name', page: 1, limit: 10 }, TENANT_ID);

      expect(result.data.map((d) => d.full_name)).toEqual(['Aaron', 'Zoe']);
    });

    it('sorts by class ascending when requested', async () => {
      const inClass1 = await studentRepo.save(makeStudent({ class_section_id: SEED_SECTION_1_ID }));
      const inClass2 = await studentRepo.save(
        makeStudent({ class_section_id: SEED_CLASS_2_SECTION_ID }),
      );
      await studentFeeRepo.save(makeFee(inClass1.id));
      await studentFeeRepo.save(makeFee(inClass2.id));

      const result = await service.getDues(
        { sort_by: 'class', sort_order: 'ASC', page: 1, limit: 10 },
        TENANT_ID,
      );

      // "Class One" sorts before "Class Two"
      expect(result.data.map((d) => d.class_name)).toEqual(['Class One', 'Class Two']);
    });

    it('paginates results', async () => {
      const first = await studentRepo.save(makeStudent({ full_name: 'A Student' }));
      const second = await studentRepo.save(makeStudent({ full_name: 'B Student' }));
      await studentFeeRepo.save(makeFee(first.id, { total_amount: 500 }));
      await studentFeeRepo.save(makeFee(second.id, { total_amount: 300 }));

      const result = await service.getDues(
        { page: 2, limit: 1, sort_by: 'name', sort_order: 'ASC' },
        TENANT_ID,
      );

      expect(result.total).toBe(2);
      expect(result.totalPages).toBe(2);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].student_id).toBe(second.id);
    });

    it('excludes students belonging to a different tenant', async () => {
      const otherSchoolSection = SEED_SECTION_1_ID;
      const student = await studentRepo.save(
        makeStudent({ class_section_id: otherSchoolSection, tenant_id: OTHER_TENANT_ID }),
      );
      await studentFeeRepo.save(makeFee(student.id));

      const result = await service.getDues({ page: 1, limit: 10 }, TENANT_ID);

      expect(result.data.some((d) => d.student_id === student.id)).toBe(false);
    });

    it('returns an empty page when no students have open dues', async () => {
      const result = await service.getDues({ page: 1, limit: 10 }, TENANT_ID);

      expect(result).toEqual({ data: [], total: 0, page: 1, limit: 10, totalPages: 0 });
    });

    it('excludes a soft-deleted student', async () => {
      const student = await studentRepo.save(makeStudent());
      await studentFeeRepo.save(makeFee(student.id));

      await studentRepo.softDelete({ id: student.id });
      const reloaded = await studentRepo.findOne({ where: { id: student.id }, withDeleted: true });
      expect(reloaded?.deleted_at).not.toBeNull();

      const result = await service.getDues({ page: 1, limit: 10 }, TENANT_ID);

      expect(result.data.some((d) => d.student_id === student.id)).toBe(false);
    });
  });

  /**
   * 16.1.3 — `student_fees` is one bill per student × fee structure ×
   * period now, instead of one row per student × month that summed every
   * applicable fee together. These pin the shape of the dues API on top
   * of that: several bills for the same student in the same month still
   * collapse into one summary row, with each bill showing up as its own
   * entry in `dues[]`.
   */
  describe('bill semantics (16.1.3)', () => {
    it('collapses two bills for the same student and month into one summary row', async () => {
      const student = await studentRepo.save(makeStudent());
      await studentFeeRepo.save(
        makeFee(student.id, {
          fee_structure_id: TUITION_STRUCTURE_ID,
          total_amount: 1000,
        }),
      );
      await studentFeeRepo.save(
        makeFee(student.id, {
          fee_structure_id: EXAM_STRUCTURE_ID,
          total_amount: 500,
        }),
      );

      const result = await service.getDues({ page: 1, limit: 10 }, TENANT_ID);

      expect(result.total).toBe(1);
      expect(result.data[0].total_due).toBe(1500);
      expect(result.data[0].dues).toHaveLength(2);
      expect(result.data[0].dues.map((d) => d.fee_name).sort()).toEqual([
        'Exam Fee',
        'Tuition Fee',
      ]);
    });

    it('filters by fee_type, narrowing to students with an open bill of that type', async () => {
      const tuitionOnly = await studentRepo.save(makeStudent());
      const examOnly = await studentRepo.save(makeStudent());
      await studentFeeRepo.save(
        makeFee(tuitionOnly.id, { fee_structure_id: TUITION_STRUCTURE_ID }),
      );
      await studentFeeRepo.save(makeFee(examOnly.id, { fee_structure_id: EXAM_STRUCTURE_ID }));

      const result = await service.getDues(
        { fee_type: FeeType.EXAM_FEE, page: 1, limit: 10 },
        TENANT_ID,
      );

      expect(result.total).toBe(1);
      expect(result.data[0].student_id).toBe(examOnly.id);
    });

    it('flags a bill as a late fee via is_late_fee', async () => {
      const student = await studentRepo.save(makeStudent());
      const original = await studentFeeRepo.save(
        makeFee(student.id, { fee_structure_id: TUITION_STRUCTURE_ID }),
      );
      await studentFeeRepo.save(
        makeFee(student.id, {
          fee_structure_id: EXAM_STRUCTURE_ID,
          late_fee_for_student_fee_id: original.id,
        }),
      );

      const result = await service.getDues({ page: 1, limit: 10 }, TENANT_ID);

      const entries = result.data[0].dues;
      expect(entries.find((d) => d.student_fee_id === original.id)?.is_late_fee).toBe(false);
      expect(entries.find((d) => d.student_fee_id !== original.id)?.is_late_fee).toBe(true);
    });

    it('flags a FINE bill via is_fine and carries its note; a tuition bill does not', async () => {
      const student = await studentRepo.save(makeStudent());
      await studentFeeRepo.save(makeFee(student.id, { fee_structure_id: TUITION_STRUCTURE_ID }));
      await studentFeeRepo.save(
        makeFee(student.id, {
          fee_structure_id: FINE_STRUCTURE_ID,
          total_amount: 50,
          note: 'Uniform violation',
          incident_date: new Date('2026-01-05'),
        }),
      );

      const result = await service.getDues({ page: 1, limit: 10 }, TENANT_ID);

      const entries = result.data[0].dues;
      const tuition = entries.find((d) => d.fee_name === 'Tuition Fee')!;
      const fine = entries.find((d) => d.fee_name === 'Uniform Fine')!;
      expect(tuition.is_fine).toBe(false);
      expect(tuition.note).toBeNull();
      expect(fine.is_fine).toBe(true);
      expect(fine.note).toBe('Uniform violation');
    });

    it('keeps bills scoped to their own tenant', async () => {
      const otherStructure = '00000000-0000-4000-8000-000000000053';
      await dataSource.getRepository(FeeStructure).save(
        dataSource.getRepository(FeeStructure).create({
          id: otherStructure,
          fee_type: FeeType.MONTHLY_TUITION,
          name: 'Other Tenant Tuition',
          amount: 1000,
          class_id: SEED_CLASS_1_ID,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          tenant_id: OTHER_TENANT_ID,
        }),
      );
      const otherStudent = await studentRepo.save(makeStudent({ tenant_id: OTHER_TENANT_ID }));
      await studentFeeRepo.save(makeFee(otherStudent.id, { fee_structure_id: otherStructure }));

      const result = await service.getDues({ page: 1, limit: 10 }, TENANT_ID);

      expect(result.data.some((d) => d.student_id === otherStudent.id)).toBe(false);
    });
  });

  /**
   * [5.1] — the seam a PARENT/STUDENT caller comes through. `FeeController`
   * resolves the caller's linked students via `FamilyAccessService` and
   * hands them to `getDues`; everything below is what the service must do
   * with that list. Staff callers pass `undefined` and are unaffected.
   */
  describe('getDues with restrictToStudentIds', () => {
    it('narrows the result to the given students', async () => {
      const mine = await studentRepo.save(makeStudent());
      const theirs = await studentRepo.save(makeStudent());
      await studentFeeRepo.save(makeFee(mine.id));
      await studentFeeRepo.save(makeFee(theirs.id));

      const result = await service.getDues({ page: 1, limit: 10 }, TENANT_ID, [mine.id]);

      expect(result.total).toBe(1);
      expect(result.data[0].student_id).toBe(mine.id);
    });

    // The distinction that matters: `undefined` means "no restriction"
    // (staff), while `[]` means "linked to nobody". Collapsing the two would
    // hand a childless parent the entire tenant.
    it('returns an empty page for an empty list, not the whole tenant', async () => {
      const student = await studentRepo.save(makeStudent());
      await studentFeeRepo.save(makeFee(student.id));

      const restricted = await service.getDues({ page: 1, limit: 10 }, TENANT_ID, []);
      const unrestricted = await service.getDues({ page: 1, limit: 10 }, TENANT_ID);

      expect(restricted).toEqual({ data: [], total: 0, page: 1, limit: 10, totalPages: 0 });
      expect(unrestricted.total).toBe(1);
    });

    it('leaves staff callers unrestricted when the argument is omitted', async () => {
      const one = await studentRepo.save(makeStudent());
      const two = await studentRepo.save(makeStudent());
      await studentFeeRepo.save(makeFee(one.id));
      await studentFeeRepo.save(makeFee(two.id));

      const result = await service.getDues({ page: 1, limit: 10 }, TENANT_ID);

      expect(result.total).toBe(2);
    });

    // A section filter is caller-controlled; it may only narrow the
    // restricted set further, never reach past it.
    it('intersects with the other query filters rather than replacing them', async () => {
      const mine = await studentRepo.save(makeStudent());
      const theirs = await studentRepo.save(makeStudent());
      await studentFeeRepo.save(makeFee(mine.id, { month: 1 }));
      await studentFeeRepo.save(makeFee(theirs.id, { month: 1 }));

      const bothInSection = await service.getDues(
        { section_id: SEED_SECTION_1_ID, page: 1, limit: 10 },
        TENANT_ID,
        [mine.id],
      );
      expect(bothInSection.data.map((d) => d.student_id)).toEqual([mine.id]);

      // A month with no fees still yields nothing, restriction or not.
      const wrongMonth = await service.getDues(
        { month: 9, year: 2026, page: 1, limit: 10 },
        TENANT_ID,
        [mine.id],
      );
      expect(wrongMonth.total).toBe(0);
    });

    // The restriction is not a substitute for the tenant filter — both are
    // applied, so an id from another tenant matches nothing.
    it('still enforces the tenant filter on top of the restriction', async () => {
      const student = await studentRepo.save(makeStudent());
      await studentFeeRepo.save(makeFee(student.id));

      const result = await service.getDues({ page: 1, limit: 10 }, OTHER_TENANT_ID, [student.id]);

      expect(result.total).toBe(0);
    });

    /**
     * `getDues` short-circuits on an empty list before the query is built,
     * so this case can only be reached through the private helper. Tested
     * directly because the helper is shared: a future caller (a widened
     * `getFlaggedDues`, say) that passes `[]` must get "nobody" rather than
     * the whole tenant — and must not hit an invalid `IN ()`, which is what
     * a naive truthiness check on `[]` would produce.
     */
    it('fails closed inside findMatchingStudentIds when the restriction is empty', async () => {
      const student = await studentRepo.save(makeStudent());
      await studentFeeRepo.save(makeFee(student.id));

      const findMatching = (
        service as unknown as {
          findMatchingStudentIds: (
            tenantId: string,
            statuses: FeeStatus[],
            filters: { restrictToStudentIds?: string[] },
          ) => Promise<string[]>;
        }
      ).findMatchingStudentIds.bind(service);

      await expect(
        findMatching(TENANT_ID, [FeeStatus.PENDING], { restrictToStudentIds: [] }),
      ).resolves.toEqual([]);

      // `undefined` still means "no restriction", so the two are not
      // collapsed into one another.
      await expect(findMatching(TENANT_ID, [FeeStatus.PENDING], {})).resolves.toEqual([student.id]);
    });

    it('excludes a soft-deleted student even when their id is in the restriction', async () => {
      const student = await studentRepo.save(makeStudent());
      await studentFeeRepo.save(makeFee(student.id));
      await studentRepo.softDelete(student.id);

      const result = await service.getDues({ page: 1, limit: 10 }, TENANT_ID, [student.id]);

      expect(result.total).toBe(0);
    });
  });

  describe('getFlaggedDues', () => {
    // [75.6-d] TEACHER scope: the optional third argument narrows the flagged set.
    it('restrictToStudentIds: [] returns nobody; [idA] returns only A; omitted is unchanged', async () => {
      const a = await studentRepo.save(makeStudent());
      const b = await studentRepo.save(makeStudent());
      await studentFeeRepo.save(makeFee(a.id, { reminder_threshold_date: YESTERDAY }));
      await studentFeeRepo.save(makeFee(b.id, { reminder_threshold_date: YESTERDAY }));
      const q = { page: 1, limit: 10 };

      expect((await service.getFlaggedDues(q, TENANT_ID, [])).total).toBe(0);
      const only = await service.getFlaggedDues(q, TENANT_ID, [a.id]);
      expect(only.data.map((d) => d.student_id)).toEqual([a.id]);
      expect((await service.getFlaggedDues(q, TENANT_ID)).total).toBe(2);
    });

    it('returns only students past their reminder_threshold_date', async () => {
      const flagged = await studentRepo.save(makeStudent());
      const notYet = await studentRepo.save(makeStudent());
      await studentFeeRepo.save(makeFee(flagged.id, { reminder_threshold_date: YESTERDAY }));
      await studentFeeRepo.save(makeFee(notYet.id, { reminder_threshold_date: TOMORROW }));

      const result = await service.getFlaggedDues({ page: 1, limit: 10 }, TENANT_ID);

      expect(result.total).toBe(1);
      expect(result.data[0].student_id).toBe(flagged.id);
    });

    it('excludes fees with no reminder_threshold_date set', async () => {
      const student = await studentRepo.save(makeStudent());
      await studentFeeRepo.save(makeFee(student.id, { reminder_threshold_date: null }));

      const result = await service.getFlaggedDues({ page: 1, limit: 10 }, TENANT_ID);

      expect(result.total).toBe(0);
    });

    it('includes guardian contact info for reminders', async () => {
      const student = await studentRepo.save(makeStudent());
      const guardian = await guardianRepo.save(
        guardianRepo.create({
          full_name: 'Jane Guardian',
          relationship: 'Mother',
          phone: '+8801711111111',
          email: 'jane@example.com',
          preferred_communication: CommunicationMedium.SMS,
          is_primary_contact: true,
          tenant_id: TENANT_ID,
        }),
      );
      await dataSource.query(
        'INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)',
        [student.id, guardian.id],
      );
      await studentFeeRepo.save(makeFee(student.id, { reminder_threshold_date: YESTERDAY }));

      const result = await service.getFlaggedDues({ page: 1, limit: 10 }, TENANT_ID);

      expect(result.data[0].guardians).toHaveLength(1);
      expect(result.data[0].guardians[0]).toMatchObject({
        full_name: 'Jane Guardian',
        phone: '+8801711111111',
        is_primary_contact: true,
      });
    });

    it('filters flagged dues by class_id and section_id', async () => {
      const inSection1 = await studentRepo.save(
        makeStudent({ class_section_id: SEED_SECTION_1_ID }),
      );
      const inSection2 = await studentRepo.save(
        makeStudent({ class_section_id: SEED_SECTION_2_ID }),
      );
      await studentFeeRepo.save(makeFee(inSection1.id, { reminder_threshold_date: YESTERDAY }));
      await studentFeeRepo.save(makeFee(inSection2.id, { reminder_threshold_date: YESTERDAY }));

      const result = await service.getFlaggedDues(
        { section_id: SEED_SECTION_1_ID, page: 1, limit: 10 },
        TENANT_ID,
      );

      expect(result.total).toBe(1);
      expect(result.data[0].student_id).toBe(inSection1.id);
    });

    it('excludes flagged fees belonging to a different tenant', async () => {
      const student = await studentRepo.save(makeStudent({ tenant_id: OTHER_TENANT_ID }));
      await studentFeeRepo.save(makeFee(student.id, { reminder_threshold_date: YESTERDAY }));

      const result = await service.getFlaggedDues({ page: 1, limit: 10 }, TENANT_ID);

      expect(result.data.some((d) => d.student_id === student.id)).toBe(false);
    });

    it('excludes a soft-deleted student', async () => {
      const student = await studentRepo.save(makeStudent());
      await studentFeeRepo.save(makeFee(student.id, { reminder_threshold_date: YESTERDAY }));

      await studentRepo.softDelete({ id: student.id });
      const reloaded = await studentRepo.findOne({ where: { id: student.id }, withDeleted: true });
      expect(reloaded?.deleted_at).not.toBeNull();

      const result = await service.getFlaggedDues({ page: 1, limit: 10 }, TENANT_ID);

      expect(result.data.some((d) => d.student_id === student.id)).toBe(false);
    });
  });

  describe('getDueSnapshots', () => {
    it('sums the open balance for each requested student', async () => {
      const student = await studentRepo.save(makeStudent());
      await studentFeeRepo.save(
        makeFee(student.id, {
          month: 1,
          total_amount: 1000,
          paid_amount: 200,
          discount_amount: 100,
          standing_discount_amount: 100,
          status: FeeStatus.PARTIALLY_PAID,
        }),
      );
      await studentFeeRepo.save(makeFee(student.id, { month: 2, total_amount: 500 }));

      const result = await service.getDueSnapshots([student.id], TENANT_ID);

      expect(result.get(student.id)?.total_due).toBe(1200);
    });

    it('reports the oldest open fee, crossing a year boundary correctly', async () => {
      // The MIN(year * 12 + month - 1) encoding exists precisely so that
      // December 2025 sorts before January 2026 — a naive MIN(month) would
      // pick January and put the wrong month in every reminder.
      const student = await studentRepo.save(makeStudent());
      await studentFeeRepo.save(makeFee(student.id, { month: 1, year: 2026 }));
      await studentFeeRepo.save(makeFee(student.id, { month: 12, year: 2025 }));

      const snapshot = (await service.getDueSnapshots([student.id], TENANT_ID)).get(student.id);

      expect(snapshot?.earliest_due_month).toBe(12);
      expect(snapshot?.earliest_due_year).toBe(2025);
    });

    it('ignores PAID fees when summing and dating', async () => {
      const student = await studentRepo.save(makeStudent());
      await studentFeeRepo.save(
        makeFee(student.id, { month: 1, status: FeeStatus.PAID, paid_amount: 1000 }),
      );
      await studentFeeRepo.save(makeFee(student.id, { month: 5, total_amount: 300 }));

      const snapshot = (await service.getDueSnapshots([student.id], TENANT_ID)).get(student.id);

      expect(snapshot?.total_due).toBe(300);
      expect(snapshot?.earliest_due_month).toBe(5);
    });

    it('omits a student with no open fees rather than returning a zero', async () => {
      const student = await studentRepo.save(makeStudent());
      await studentFeeRepo.save(makeFee(student.id, { status: FeeStatus.PAID, paid_amount: 1000 }));

      const result = await service.getDueSnapshots([student.id], TENANT_ID);

      expect(result.has(student.id)).toBe(false);
    });

    it('does not return dues for a student in another tenant', async () => {
      const other = await studentRepo.save(makeStudent({ tenant_id: OTHER_TENANT_ID }));
      await studentFeeRepo.save(makeFee(other.id));

      const result = await service.getDueSnapshots([other.id], TENANT_ID);

      expect(result.has(other.id)).toBe(false);
    });

    it('excludes soft-deleted students', async () => {
      const student = await studentRepo.save(makeStudent());
      await studentFeeRepo.save(makeFee(student.id));
      await studentRepo.softDelete(student.id);

      const result = await service.getDueSnapshots([student.id], TENANT_ID);

      expect(result.has(student.id)).toBe(false);
    });

    it('keys several students independently in one query', async () => {
      const a = await studentRepo.save(makeStudent());
      const b = await studentRepo.save(makeStudent());
      await studentFeeRepo.save(makeFee(a.id, { total_amount: 100 }));
      await studentFeeRepo.save(makeFee(b.id, { total_amount: 700 }));

      const result = await service.getDueSnapshots([a.id, b.id], TENANT_ID);

      expect(result.get(a.id)?.total_due).toBe(100);
      expect(result.get(b.id)?.total_due).toBe(700);
    });

    it('short-circuits on an empty id list without querying', async () => {
      expect(await service.getDueSnapshots([], TENANT_ID)).toEqual(new Map());
    });
  });

  /**
   * 16.1.3 D2/D8 — the unique key moved from (student, academic_year,
   * month, year) to (student, fee_structure, period_start, occurrence),
   * and `discount_amount` must equal the sum of its two split columns.
   * These exercise the actual Postgres constraints, not application code.
   */
  describe('DB constraints (16.1.3)', () => {
    it('rejects a second bill for the same student/structure/period/occurrence', async () => {
      const student = await studentRepo.save(makeStudent());
      await studentFeeRepo.save(makeFee(student.id));

      await expect(studentFeeRepo.save(makeFee(student.id))).rejects.toThrow();
    });

    it('allows a second occurrence for the same student/structure/period', async () => {
      const student = await studentRepo.save(makeStudent());
      await studentFeeRepo.save(makeFee(student.id, { occurrence: 1 }));

      await expect(
        studentFeeRepo.save(makeFee(student.id, { occurrence: 2 })),
      ).resolves.toBeDefined();
    });

    it('rejects a discount_amount that does not equal the split sum', async () => {
      const student = await studentRepo.save(makeStudent());

      await expect(
        studentFeeRepo.save(
          makeFee(student.id, {
            discount_amount: 100,
            standing_discount_amount: 40,
            one_off_discount_amount: 40,
          }),
        ),
      ).rejects.toThrow();
    });

    it('accepts a discount_amount that equals the split sum', async () => {
      const student = await studentRepo.save(makeStudent());

      await expect(
        studentFeeRepo.save(
          makeFee(student.id, {
            discount_amount: 80,
            standing_discount_amount: 40,
            one_off_discount_amount: 40,
          }),
        ),
      ).resolves.toBeDefined();
    });
  });

  /**
   * [8.10.7.3.07] Accountant dashboard widgets. Every figure must agree with
   * the list behind the matching page (`getDues` / `getFlaggedDues`).
   */
  describe('dashboard widgets (8.10.7.3.07)', () => {
    const TZ = 'Asia/Dhaka';
    const dayStr = (offset: number) => localDate(new Date(Date.now() + offset * 86400000), TZ);

    // `agedDays` = how many days ago the fee was due (negative = not yet due).
    async function feeDue(
      agedDays: number | null,
      overrides: Partial<StudentFee> = {},
      studentOverrides: Partial<Student> = {},
    ) {
      const s = await studentRepo.save(makeStudent(studentOverrides));
      await studentFeeRepo.save(
        makeFee(s.id, {
          due_date: agedDays === null ? null : (day(-agedDays) as Date),
          ...overrides,
        }),
      );
      return s;
    }

    async function sumAllDues(filter: { class_id?: string } = {}) {
      let total = 0;
      for (let page = 1; ; page++) {
        const r = await service.getDues({ ...filter, page, limit: 100 }, TENANT_ID);
        total += r.data.reduce((a, d) => a + d.total_due, 0);
        if (page >= r.totalPages) return total;
      }
    }

    async function log(
      studentId: string,
      status: string,
      trigger: string,
      createdAt: string,
      tenantId = TENANT_ID,
    ) {
      await dataSource.query(
        `INSERT INTO communication_logs (tenant_id, medium, recipient_address, recipient_name, message_body, status, trigger, student_id, created_at, updated_at)
         VALUES ($1, 'SMS', '+8801700000000', 'G', 'x', $2, $3, $4, $5, $5)`,
        [tenantId, status, trigger, studentId, createdAt],
      );
    }

    beforeEach(async () => {
      await dataSource.query('DELETE FROM communication_logs');
    });

    describe('getAgeing', () => {
      it('buckets on exact day edges; part-paid counts balance; PAID ignored; not-yet-due and no due date go to 0_30', async () => {
        await feeDue(0); // 1000, age 0
        await feeDue(30); // 1000, age 30 -> 0_30
        await feeDue(31); // 1000, age 31 -> 31_60
        await feeDue(60, {
          paid_amount: 400,
          discount_amount: 100,
          standing_discount_amount: 100,
          status: FeeStatus.PARTIALLY_PAID,
        }); // balance 500, age 60 -> 31_60
        await feeDue(61); // 1000, age 61 -> 60_PLUS
        await feeDue(-5); // 1000, not yet due -> 0_30
        await feeDue(null); // 1000, no due date -> 0_30
        await feeDue(90, { paid_amount: 1000, status: FeeStatus.PAID });

        const r = await service.getAgeing(TENANT_ID, localToday(TZ));

        expect(r.as_of).toBe(localToday(TZ));
        expect(r.buckets.map((b) => b.bucket)).toEqual(['0_30', '31_60', '60_PLUS']);
        expect(r.buckets.map((b) => b.amount)).toEqual([4000, 1500, 1000]);
        expect(r.total_due).toBe(6500);
        expect(r.buckets.map((b) => b.share_pct)).toEqual([62, 23, 15]);
      });

      it('empty tenant: three zero buckets, share_pct 0, not NaN', async () => {
        const r = await service.getAgeing(TENANT_ID, localToday(TZ));
        expect(r.total_due).toBe(0);
        expect(r.buckets).toEqual([
          { bucket: '0_30', amount: 0, share_pct: 0 },
          { bucket: '31_60', amount: 0, share_pct: 0 },
          { bucket: '60_PLUS', amount: 0, share_pct: 0 },
        ]);
      });

      it('Dhaka midnight: 18:30Z on the 7th is the 8th, so the 30/31 day edge moves with it', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-10-07T18:30:00Z'));
        try {
          const today = localToday(TZ);
          expect(today).toBe('2026-10-08');
          const s1 = await studentRepo.save(makeStudent());
          await studentFeeRepo.save(makeFee(s1.id, { due_date: new Date(2026, 8, 8) })); // 8 Sep: age 30
          const s2 = await studentRepo.save(makeStudent());
          await studentFeeRepo.save(makeFee(s2.id, { due_date: new Date(2026, 8, 7) })); // 7 Sep: age 31
          const r = await service.getAgeing(TENANT_ID, today);
          expect(r.buckets.map((b) => b.amount)).toEqual([1000, 1000, 0]);
        } finally {
          vi.useRealTimers();
        }
      });

      it('excludes a soft-deleted student and another tenant', async () => {
        const gone = await feeDue(10);
        await studentRepo.softDelete({ id: gone.id });
        await feeDue(10, {}, { tenant_id: OTHER_TENANT_ID });
        const r = await service.getAgeing(TENANT_ID, localToday(TZ));
        expect(r.total_due).toBe(0);
      });

      it('reconciles with getDues: total_due equals the sum over every page', async () => {
        for (let i = 0; i < 12; i++) {
          await feeDue(i * 7, {
            paid_amount: i % 3 === 0 ? 250 : 0,
            status: i % 3 === 0 ? FeeStatus.PARTIALLY_PAID : FeeStatus.PENDING,
          });
        }
        await feeDue(5, { paid_amount: 1000, status: FeeStatus.PAID });
        const r = await service.getAgeing(TENANT_ID, localToday(TZ));
        expect(r.total_due).toBeGreaterThan(0);
        expect(r.total_due).toBe(await sumAllDues());
      });
    });

    describe('getDuesByClass', () => {
      it('groups by class, amount desc, distinct students; reconciles with getDues per class', async () => {
        const a = await feeDue(10, {}, { class_section_id: SEED_SECTION_1_ID });
        await studentFeeRepo.save(makeFee(a.id, { month: 2, due_date: day(0) as Date })); // 2nd open fee, same student
        await feeDue(10, {}, { class_section_id: SEED_SECTION_2_ID }); // same class, other section
        await feeDue(10, { total_amount: 5000 }, { class_section_id: SEED_CLASS_2_SECTION_ID });
        await feeDue(10, { paid_amount: 1000, status: FeeStatus.PAID });

        const r = await service.getDuesByClass(TENANT_ID);

        expect(r.classes.map((c) => [c.class_id, c.class_name, c.amount, c.student_count])).toEqual(
          [
            [SEED_CLASS_2_ID, 'Class Two', 5000, 1],
            [SEED_CLASS_1_ID, 'Class One', 3000, 2],
          ],
        );
        expect(r.total_due).toBe(8000);
        expect(r.total_due).toBe(await sumAllDues());
        for (const c of r.classes) {
          expect(c.amount).toBe(await sumAllDues({ class_id: c.class_id }));
        }
      });

      it('excludes soft-deleted students and other tenants; empty is []', async () => {
        const gone = await feeDue(10);
        await studentRepo.softDelete({ id: gone.id });
        await feeDue(10, {}, { tenant_id: OTHER_TENANT_ID });
        expect(await service.getDuesByClass(TENANT_ID)).toEqual({ total_due: 0, classes: [] });
      });
    });

    describe('countRemindersPending', () => {
      const past = (n: number) => day(-n) as Date;

      it('counts flagged students with no non-FAILED reminder since threshold; guardians counted once', async () => {
        const notReminded = await feeDue(20, { reminder_threshold_date: past(10) });
        const remindedAfter = await feeDue(20, { reminder_threshold_date: past(10) });
        const remindedBefore = await feeDue(20, { reminder_threshold_date: past(10) });
        const failedOnly = await feeDue(20, { reminder_threshold_date: past(10) });
        await feeDue(20, { reminder_threshold_date: day(3) as Date }); // not flagged yet
        const nowIso = new Date().toISOString();
        await log(remindedAfter.id, 'SENT', 'BULK_REMINDER', nowIso);
        await log(
          remindedBefore.id,
          'SENT',
          'SINGLE_REMINDER',
          new Date(Date.now() - 20 * 86400000).toISOString(),
        );
        await log(failedOnly.id, 'FAILED', 'BULK_REMINDER', nowIso);
        await log(notReminded.id, 'SENT', 'MANUAL', nowIso); // not a reminder trigger
        await log(notReminded.id, 'SENT', 'BULK_REMINDER', nowIso, OTHER_TENANT_ID); // other tenant's log never counts

        const g = await guardianRepo.save(
          guardianRepo.create({
            full_name: 'Shared',
            relationship: 'Mother',
            phone: '+8801711111111',
            email: null,
            preferred_communication: CommunicationMedium.SMS,
            is_primary_contact: true,
            tenant_id: TENANT_ID,
          }),
        );
        for (const s of [notReminded, remindedBefore]) {
          await dataSource.query(
            'INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)',
            [s.id, g.id],
          );
        }

        const r = await service.countRemindersPending(TENANT_ID, localToday(TZ), TZ);

        expect(r).toEqual({
          student_count: 3,
          guardian_count: 1,
          oldest_threshold_date: dayStr(-10),
        });
      });

      it('reconciles with getFlaggedDues when no reminder logs exist', async () => {
        for (let i = 0; i < 4; i++) await feeDue(20, { reminder_threshold_date: past(i + 1) });
        await feeDue(20, { reminder_threshold_date: day(2) as Date });
        await feeDue(20, { reminder_threshold_date: null });
        const r = await service.countRemindersPending(TENANT_ID, localToday(TZ), TZ);
        const flagged = await service.getFlaggedDues({ page: 1, limit: 100 }, TENANT_ID);
        expect(r.student_count).toBe(flagged.total);
        expect(r.student_count).toBe(4);
        expect(r.oldest_threshold_date).toBe(dayStr(-4));
      });

      it('none flagged: zeros and null date; excludes soft-deleted and other-tenant', async () => {
        const gone = await feeDue(20, { reminder_threshold_date: past(3) });
        await studentRepo.softDelete({ id: gone.id });
        await feeDue(20, { reminder_threshold_date: past(3) }, { tenant_id: OTHER_TENANT_ID });
        expect(await service.countRemindersPending(TENANT_ID, localToday(TZ), TZ)).toEqual({
          student_count: 0,
          guardian_count: 0,
          oldest_threshold_date: null,
        });
      });
    });
  });
});

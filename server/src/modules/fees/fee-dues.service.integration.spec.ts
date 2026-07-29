import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Repository, DataSource } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FeeDuesService } from './fee-dues.service';
import { StudentFee } from './entities/student-fee.entity';
import { Student } from '../students/entities/student.entity';
import { Guardian } from '../students/entities/guardian.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { School } from '../schools/entities/school.entity';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID, SEED_CLASS_1_ID, SEED_SECTION_1_ID, SEED_ACADEMIC_YEAR_ID } from '@test/constants';
import { EnrollmentStatus, CommunicationMedium, FeeStatus } from '@beton-boi/shared';

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

  await schoolRepo.save(schoolRepo.create({ id: SEED_TENANT_ID, name: 'Test School', slug: 'test-school' }));
  await ayRepo.save(ayRepo.create({ id: SEED_ACADEMIC_YEAR_ID, name: '2026-2027', start_date: new Date('2026-01-01'), end_date: new Date('2026-12-31'), is_current: true, tenant_id: SEED_TENANT_ID }));
  await classRepo.save(classRepo.create({ id: SEED_CLASS_1_ID, name: 'Class One', academic_year_id: SEED_ACADEMIC_YEAR_ID, tenant_id: SEED_TENANT_ID }));
  await classRepo.save(classRepo.create({ id: SEED_CLASS_2_ID, name: 'Class Two', academic_year_id: SEED_ACADEMIC_YEAR_ID, tenant_id: SEED_TENANT_ID }));
  await sectionRepo.save(sectionRepo.create({ id: SEED_SECTION_1_ID, section_name: 'Section A', class_id: SEED_CLASS_1_ID, tenant_id: SEED_TENANT_ID }));
  await sectionRepo.save(sectionRepo.create({ id: SEED_SECTION_2_ID, section_name: 'Section B', class_id: SEED_CLASS_1_ID, tenant_id: SEED_TENANT_ID }));
  await sectionRepo.save(sectionRepo.create({ id: SEED_CLASS_2_SECTION_ID, section_name: 'Class Two Section', class_id: SEED_CLASS_2_ID, tenant_id: SEED_TENANT_ID }));

  await schoolRepo.save(schoolRepo.create({ id: OTHER_TENANT_ID, name: 'Other School', slug: 'other-school' }));
}

describe('FeeDuesService (integration)', () => {
  let service: FeeDuesService;
  let studentFeeRepo: Repository<StudentFee>;
  let studentRepo: Repository<Student>;
  let guardianRepo: Repository<Guardian>;
  let dataSource: DataSource;

  const TENANT_ID = SEED_TENANT_ID;
  const YESTERDAY = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const TOMORROW = new Date(Date.now() + 24 * 60 * 60 * 1000);

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

  function makeFee(studentId: string, overrides: Partial<StudentFee> = {}) {
    return studentFeeRepo.create({
      student_id: studentId,
      academic_year_id: SEED_ACADEMIC_YEAR_ID,
      month: 1,
      year: 2026,
      total_amount: 1000,
      paid_amount: 0,
      discount_amount: 0,
      status: FeeStatus.PENDING,
      ...overrides,
    });
  }

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [FeeDuesService],
      [],
      { synchronize: true, dropSchema: true },
    );

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

    it('computes total_due as the sum of balances across all open fees for a student', async () => {
      const student = await studentRepo.save(makeStudent());
      await studentFeeRepo.save(makeFee(student.id, { month: 1, total_amount: 1000, paid_amount: 200, discount_amount: 100, status: FeeStatus.PARTIALLY_PAID }));
      await studentFeeRepo.save(makeFee(student.id, { month: 2, total_amount: 500, paid_amount: 0, discount_amount: 0, status: FeeStatus.PENDING }));

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

    it('filters by class_id', async () => {
      const inClass1 = await studentRepo.save(makeStudent({ class_section_id: SEED_SECTION_1_ID }));
      const inClass2 = await studentRepo.save(makeStudent({ class_section_id: SEED_CLASS_2_SECTION_ID }));
      await studentFeeRepo.save(makeFee(inClass1.id));
      await studentFeeRepo.save(makeFee(inClass2.id));

      const result = await service.getDues({ class_id: SEED_CLASS_1_ID, page: 1, limit: 10 }, TENANT_ID);

      expect(result.total).toBe(1);
      expect(result.data[0].student_id).toBe(inClass1.id);
    });

    it('filters by section_id', async () => {
      const inSection1 = await studentRepo.save(makeStudent({ class_section_id: SEED_SECTION_1_ID }));
      const inSection2 = await studentRepo.save(makeStudent({ class_section_id: SEED_SECTION_2_ID }));
      await studentFeeRepo.save(makeFee(inSection1.id));
      await studentFeeRepo.save(makeFee(inSection2.id));

      const result = await service.getDues({ section_id: SEED_SECTION_1_ID, page: 1, limit: 10 }, TENANT_ID);

      expect(result.total).toBe(1);
      expect(result.data[0].student_id).toBe(inSection1.id);
    });

    it('filters by status', async () => {
      const pending = await studentRepo.save(makeStudent());
      const partial = await studentRepo.save(makeStudent());
      await studentFeeRepo.save(makeFee(pending.id, { status: FeeStatus.PENDING }));
      await studentFeeRepo.save(makeFee(partial.id, { status: FeeStatus.PARTIALLY_PAID, paid_amount: 200 }));

      const result = await service.getDues({ status: FeeStatus.PARTIALLY_PAID as any, page: 1, limit: 10 }, TENANT_ID);

      expect(result.total).toBe(1);
      expect(result.data[0].student_id).toBe(partial.id);
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
      const inClass2 = await studentRepo.save(makeStudent({ class_section_id: SEED_CLASS_2_SECTION_ID }));
      await studentFeeRepo.save(makeFee(inClass1.id));
      await studentFeeRepo.save(makeFee(inClass2.id));

      const result = await service.getDues({ sort_by: 'class', sort_order: 'ASC', page: 1, limit: 10 }, TENANT_ID);

      // "Class One" sorts before "Class Two"
      expect(result.data.map((d) => d.class_name)).toEqual(['Class One', 'Class Two']);
    });

    it('paginates results', async () => {
      const first = await studentRepo.save(makeStudent({ full_name: 'A Student' }));
      const second = await studentRepo.save(makeStudent({ full_name: 'B Student' }));
      await studentFeeRepo.save(makeFee(first.id, { total_amount: 500 }));
      await studentFeeRepo.save(makeFee(second.id, { total_amount: 300 }));

      const result = await service.getDues({ page: 2, limit: 1, sort_by: 'name', sort_order: 'ASC' }, TENANT_ID);

      expect(result.total).toBe(2);
      expect(result.totalPages).toBe(2);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].student_id).toBe(second.id);
    });

    it('excludes students belonging to a different tenant', async () => {
      const otherSchoolSection = SEED_SECTION_1_ID;
      const student = await studentRepo.save(makeStudent({ class_section_id: otherSchoolSection, tenant_id: OTHER_TENANT_ID }));
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

  describe('getFlaggedDues', () => {
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
      const inSection1 = await studentRepo.save(makeStudent({ class_section_id: SEED_SECTION_1_ID }));
      const inSection2 = await studentRepo.save(makeStudent({ class_section_id: SEED_SECTION_2_ID }));
      await studentFeeRepo.save(makeFee(inSection1.id, { reminder_threshold_date: YESTERDAY }));
      await studentFeeRepo.save(makeFee(inSection2.id, { reminder_threshold_date: YESTERDAY }));

      const result = await service.getFlaggedDues({ section_id: SEED_SECTION_1_ID, page: 1, limit: 10 }, TENANT_ID);

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
        makeFee(student.id, { month: 1, total_amount: 1000, paid_amount: 200, discount_amount: 100, status: FeeStatus.PARTIALLY_PAID }),
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
      await studentFeeRepo.save(makeFee(student.id, { month: 1, status: FeeStatus.PAID, paid_amount: 1000 }));
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
});

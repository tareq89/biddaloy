import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource, Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { TestingModule } from '@nestjs/testing';
import { School } from '../../../schools/entities/school.entity';
import { AcademicYear } from '../../../academics/entities/academic-year.entity';
import { Class } from '../../../academics/entities/class.entity';
import { ClassSection } from '../../../academics/entities/class-section.entity';
import { Student } from '../../../students/entities/student.entity';
import { FeeStructure } from '../../../fees/entities/fee-structure.entity';
import { FineRule } from '../../../fees/entities/fine-rule.entity';
import { StudentFee } from '../../../fees/entities/student-fee.entity';
import { Invoice } from '../../../invoices/entities/invoice.entity';
import { Payment } from '../../../fees/entities/payment.entity';
import { PaymentAllocation } from '../../../fees/entities/payment-allocation.entity';
import {
  FeeStatus,
  FeeType,
  FineTrigger,
  InvoiceKind,
  InvoiceStatus,
  PaymentAllocationType,
  PaymentMethod,
  PaymentStatus,
} from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { feeStructuresTab, type FeeStructureRow } from './fee-structures.tab';
import { fineRulesTab, type FineRuleRow } from './fine-rules.tab';
import { studentFeesTab, type StudentFeeRow } from './student-fees.tab';
import { invoicesTab, type InvoiceRow } from './invoices.tab';
import { paymentsTab, type PaymentRow } from './payments.tab';
import { paymentAllocationsTab, type PaymentAllocationRow } from './payment-allocations.tab';

/**
 * Integration tests for the fees lane's tabs against a real Postgres
 * database, mirroring `academics.tabs.integration.spec.ts`.
 *
 * `students` is a forward reference to a tab this worktree does not have
 * (14.5, a different parallel group). These tests never route through that
 * tab: they insert `Student` rows directly with the real repository and
 * supply a hand-written `ImportContext` whose `ref('students', key)` looks
 * students up by `registration_number` — exactly the contract the real
 * `students.tab.ts` will implement, without depending on its existence.
 */
describe('fees tabs (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let schoolRepo: Repository<School>;
  let yearRepo: Repository<AcademicYear>;
  let classRepo: Repository<Class>;
  let sectionRepo: Repository<ClassSection>;
  let studentRepo: Repository<Student>;
  let feeStructureRepo: Repository<FeeStructure>;
  let fineRuleRepo: Repository<FineRule>;
  let studentFeeRepo: Repository<StudentFee>;
  let invoiceRepo: Repository<Invoice>;
  let paymentRepo: Repository<Payment>;
  let paymentAllocationRepo: Repository<PaymentAllocation>;

  const TENANT_A = '11111111-1111-4111-8111-111111111111';
  const TENANT_B = '22222222-2222-4222-8222-222222222222';

  let yearAId: string;
  let classAId: string;
  let sectionAId: string;
  let studentA1: Student;
  let studentA2: Student;
  let feeStructureAId: string;
  // `feeStructuresTab.keyOf`'s composite: class|year|section|fee_type|month|name.
  // The shared fee structure below has no section, hence the empty segment.
  // `classesTab.keyOf` now embeds shift/version ([33.2.1]) — this class has
  // neither set, so its embedded key carries two trailing empty segments
  // (`Class 5|2026-2027||`) before `feeStructuresTab`'s own fields resume.
  const FEE_STRUCTURE_A_KEY = 'Class 5|2026-2027|||2026-2027||MONTHLY_TUITION|Tuition - January';

  beforeAll(async () => {
    module = await createTestModule(ALL_ENTITIES, []);
    dataSource = module.get(DataSource);
    schoolRepo = module.get<Repository<School>>(getRepositoryToken(School));
    yearRepo = module.get<Repository<AcademicYear>>(getRepositoryToken(AcademicYear));
    classRepo = module.get<Repository<Class>>(getRepositoryToken(Class));
    sectionRepo = module.get<Repository<ClassSection>>(getRepositoryToken(ClassSection));
    studentRepo = module.get<Repository<Student>>(getRepositoryToken(Student));
    feeStructureRepo = module.get<Repository<FeeStructure>>(getRepositoryToken(FeeStructure));
    fineRuleRepo = module.get<Repository<FineRule>>(getRepositoryToken(FineRule));
    studentFeeRepo = module.get<Repository<StudentFee>>(getRepositoryToken(StudentFee));
    invoiceRepo = module.get<Repository<Invoice>>(getRepositoryToken(Invoice));
    paymentRepo = module.get<Repository<Payment>>(getRepositoryToken(Payment));
    paymentAllocationRepo = module.get<Repository<PaymentAllocation>>(
      getRepositoryToken(PaymentAllocation),
    );
  });

  afterAll(async () => {
    await module?.close();
  });

  beforeEach(async () => {
    await paymentAllocationRepo.createQueryBuilder().delete().execute();
    await paymentRepo.createQueryBuilder().delete().execute();
    await invoiceRepo.createQueryBuilder().delete().execute();
    await studentFeeRepo.createQueryBuilder().delete().execute();
    await fineRuleRepo.delete({ tenant_id: TENANT_A });
    await fineRuleRepo.delete({ tenant_id: TENANT_B });
    await feeStructureRepo.delete({ tenant_id: TENANT_A });
    await feeStructureRepo.delete({ tenant_id: TENANT_B });
    await studentRepo.delete({ tenant_id: TENANT_A });
    await studentRepo.delete({ tenant_id: TENANT_B });
    await sectionRepo.delete({ tenant_id: TENANT_A });
    await sectionRepo.delete({ tenant_id: TENANT_B });
    await classRepo.delete({ tenant_id: TENANT_A });
    await classRepo.delete({ tenant_id: TENANT_B });
    await yearRepo.delete({ tenant_id: TENANT_A });
    await yearRepo.delete({ tenant_id: TENANT_B });
    await schoolRepo.delete({ id: TENANT_A });
    await schoolRepo.delete({ id: TENANT_B });

    await schoolRepo.save(
      schoolRepo.create({ id: TENANT_A, name: 'Tenant A School', slug: 'tenant-a-fees' }),
    );
    await schoolRepo.save(
      schoolRepo.create({ id: TENANT_B, name: 'Tenant B School', slug: 'tenant-b-fees' }),
    );

    const year = await yearRepo.save(
      yearRepo.create({
        tenant_id: TENANT_A,
        name: '2026-2027',
        start_date: '2026-01-01',
        end_date: '2026-12-31',
        is_current: true,
      }),
    );
    yearAId = year.id;

    const klass = await classRepo.save(
      classRepo.create({ tenant_id: TENANT_A, name: 'Class 5', academic_year_id: yearAId }),
    );
    classAId = klass.id;

    const section = await sectionRepo.save(
      sectionRepo.create({
        tenant_id: TENANT_A,
        class_id: classAId,
        section_name: 'A',
        capacity: 40,
      }),
    );
    sectionAId = section.id;

    studentA1 = await studentRepo.save(
      studentRepo.create({
        tenant_id: TENANT_A,
        full_name: 'Student One',
        registration_number: 'REG-A-001',
        roll_number: 1,
        class_section_id: sectionAId,
      }),
    );
    studentA2 = await studentRepo.save(
      studentRepo.create({
        tenant_id: TENANT_A,
        full_name: 'Student Two',
        registration_number: 'REG-A-002',
        roll_number: 2,
        class_section_id: sectionAId,
      }),
    );
  });

  /**
   * A real fee structure to bill against — `student_fees`/`invoices`/
   * `payment_allocations` all need one now that 16.1.3 made
   * `fee_structure_id` NOT NULL. Scoped to those describes' own
   * `beforeEach` (not the top-level one above) so it doesn't add an extra
   * row to `fee_structures`' own tenant-isolation tests.
   */
  async function seedFeeStructureA(): Promise<void> {
    const feeStructure = await feeStructureRepo.save(
      feeStructureRepo.create({
        tenant_id: TENANT_A,
        fee_type: FeeType.MONTHLY_TUITION,
        name: 'Tuition - January',
        amount: '1500.00',
        class_id: classAId,
        academic_year_id: yearAId,
      }),
    );
    feeStructureAId = feeStructure.id;
  }

  describe('fee_structures', () => {
    function rowFor(overrides: Partial<FeeStructureRow> = {}): FeeStructureRow {
      return {
        id: '00000000-0000-4000-8000-000000000001',
        name: 'Tuition - January',
        fee_type: FeeType.MONTHLY_TUITION,
        amount: '1500.00',
        class_id: classAId,
        class_key: 'Class 5|2026-2027',
        academic_year_id: yearAId,
        academic_year_key: '2026-2027',
        section_id: sectionAId,
        section_key: 'Class 5|2026-2027|A',
        ...overrides,
      };
    }

    it('upsert creates a new row', async () => {
      const created = await feeStructuresTab.upsert(rowFor(), null, TENANT_A, dataSource.manager);
      expect(created.id).toBeDefined();
      expect(created.tenant_id).toBe(TENANT_A);
    });

    it('upsert with a changed field updates only that field', async () => {
      const created = await feeStructuresTab.upsert(rowFor(), null, TENANT_A, dataSource.manager);
      const updated = await feeStructuresTab.upsert(
        rowFor({ amount: '2000.00' }),
        created,
        TENANT_A,
        dataSource.manager,
      );
      expect(updated.amount).toBe('2000.00');
      expect(updated.name).toBe('Tuition - January');
    });

    it('remove soft-deletes', async () => {
      const created = await feeStructuresTab.upsert(rowFor(), null, TENANT_A, dataSource.manager);
      await feeStructuresTab.remove(created, dataSource.manager);
      const found = await feeStructureRepo.findOne({
        where: { id: created.id },
        withDeleted: true,
      });
      expect(found?.deleted_at).not.toBeNull();
    });

    it('load(tenantA) never returns tenant B rows', async () => {
      await feeStructuresTab.upsert(rowFor(), null, TENANT_A, dataSource.manager);
      const rowsA = await feeStructuresTab.load(TENANT_A, dataSource.manager);
      const rowsB = await feeStructuresTab.load(TENANT_B, dataSource.manager);
      expect(rowsA.length).toBe(1);
      expect(rowsB.length).toBe(0);
    });

    it('upsert persists a structure with a null class', async () => {
      const created = await feeStructuresTab.upsert(
        rowFor({ class_id: null, class_key: null, section_id: null, section_key: null }),
        null,
        TENANT_A,
        dataSource.manager,
      );
      const [loaded] = await feeStructuresTab.load(TENANT_A, dataSource.manager);
      expect(loaded.id).toBe(created.id);
      expect(loaded.class_id).toBeNull();
    });
  });

  describe('fine_rules', () => {
    beforeEach(seedFeeStructureA);

    function rowFor(overrides: Partial<FineRuleRow> = {}): FineRuleRow {
      return {
        id: '00000000-0000-4000-8000-000000000009',
        trigger: FineTrigger.ATTENDANCE_ABSENT,
        fee_structure_id: feeStructureAId,
        fee_structure_key: FEE_STRUCTURE_A_KEY,
        class_id: null,
        class_key: null,
        academic_year_id: yearAId,
        academic_year_key: '2026-2027',
        free_per_period: 2,
        cap_per_period: '200.00',
        conditions: { min_minutes_late: 10 },
        is_active: true,
        ...overrides,
      };
    }

    it('upsert creates a new row', async () => {
      const created = await fineRulesTab.upsert(rowFor(), null, TENANT_A, dataSource.manager);
      expect(created.id).toBeDefined();
      expect(created.tenant_id).toBe(TENANT_A);
    });

    it('upsert with a changed field updates only that field', async () => {
      const created = await fineRulesTab.upsert(rowFor(), null, TENANT_A, dataSource.manager);
      const updated = await fineRulesTab.upsert(
        rowFor({ free_per_period: 5 }),
        created,
        TENANT_A,
        dataSource.manager,
      );
      expect(updated.free_per_period).toBe(5);
      expect(updated.trigger).toBe(FineTrigger.ATTENDANCE_ABSENT);
    });

    it('remove soft-deletes', async () => {
      const created = await fineRulesTab.upsert(rowFor(), null, TENANT_A, dataSource.manager);
      await fineRulesTab.remove(created, dataSource.manager);
      const found = await fineRuleRepo.findOne({ where: { id: created.id }, withDeleted: true });
      expect(found?.deleted_at).not.toBeNull();
    });

    it('load(tenantA) never returns tenant B rows', async () => {
      await fineRulesTab.upsert(rowFor(), null, TENANT_A, dataSource.manager);
      const rowsA = await fineRulesTab.load(TENANT_A, dataSource.manager);
      const rowsB = await fineRulesTab.load(TENANT_B, dataSource.manager);
      expect(rowsA.length).toBe(1);
      expect(rowsB.length).toBe(0);
    });

    it('the DB rejects a second active rule for the same tenant/year/trigger/null-class', async () => {
      await fineRulesTab.upsert(rowFor(), null, TENANT_A, dataSource.manager);
      await expect(
        fineRulesTab.upsert(
          rowFor({ id: '00000000-0000-4000-8000-00000000000a' }),
          null,
          TENANT_A,
          dataSource.manager,
        ),
      ).rejects.toThrow(
        expect.objectContaining({
          code: '23505',
          constraint: 'IDX_fine_rules_tenant_year_trigger_class',
        }),
      );
    });

    it('persists a rule with a null class and jsonb conditions intact', async () => {
      const created = await fineRulesTab.upsert(rowFor(), null, TENANT_A, dataSource.manager);
      const [loaded] = await fineRulesTab.load(TENANT_A, dataSource.manager);
      expect(loaded.id).toBe(created.id);
      expect(loaded.class_id).toBeNull();
      expect(loaded.conditions).toEqual({ min_minutes_late: 10 });
    });
  });

  describe('fine_rules + student_fees restore', () => {
    beforeEach(seedFeeStructureA);

    it('restore recreates both a fine rule and a FINE bill referencing it', async () => {
      const ruleRow: FineRuleRow = {
        id: '00000000-0000-4000-8000-000000000011',
        academic_year_id: yearAId,
        academic_year_key: '2026-2027',
        trigger: FineTrigger.ATTENDANCE_ABSENT,
        fee_structure_id: feeStructureAId,
        fee_structure_key: FEE_STRUCTURE_A_KEY,
        class_id: null,
        class_key: null,
        free_per_period: 1,
        cap_per_period: '200.00',
        conditions: {},
        is_active: true,
      };
      const rule = await fineRulesTab.upsert(ruleRow, null, TENANT_A, dataSource.manager);

      const fineBillRow: StudentFeeRow = {
        id: '00000000-0000-4000-8000-000000000012',
        student_id: studentA1.id,
        student_key: studentA1.registration_number,
        academic_year_id: yearAId,
        academic_year_key: '2026-2027',
        fee_structure_id: feeStructureAId,
        fee_structure_key: FEE_STRUCTURE_A_KEY,
        month: 1,
        year: 2026,
        occurrence: 1,
        total_amount: '20.00',
        paid_amount: '0.00',
        discount_amount: '0.00',
        standing_discount_amount: '0.00',
        one_off_discount_amount: '0.00',
        status: FeeStatus.PENDING,
        due_date: null,
        reminder_threshold_date: null,
        note: 'Absent without notice',
        incident_date: '2026-01-12',
        fine_rule_id: rule.id,
        fine_rule_key: fineRulesTab.keyOf(ruleRow),
      };
      const bill = await studentFeesTab.upsert(fineBillRow, null, TENANT_A, dataSource.manager);

      const [loadedRule] = await fineRulesTab.load(TENANT_A, dataSource.manager);
      const [loadedBill] = await studentFeesTab.load(TENANT_A, dataSource.manager);
      expect(loadedRule.id).toBe(rule.id);
      expect(loadedBill.id).toBe(bill.id);
      expect(loadedBill.fine_rule_id).toBe(rule.id);
      expect(loadedBill.note).toBe('Absent without notice');
    });

    it("restore updates an existing bill's fine_rule_id, and clearing it to null sticks", async () => {
      const ruleRow: FineRuleRow = {
        id: '00000000-0000-4000-8000-000000000021',
        academic_year_id: yearAId,
        academic_year_key: '2026-2027',
        trigger: FineTrigger.ATTENDANCE_ABSENT,
        fee_structure_id: feeStructureAId,
        fee_structure_key: FEE_STRUCTURE_A_KEY,
        class_id: null,
        class_key: null,
        free_per_period: 1,
        cap_per_period: '200.00',
        conditions: {},
        is_active: true,
      };
      const rule = await fineRulesTab.upsert(ruleRow, null, TENANT_A, dataSource.manager);

      const otherRuleRow: FineRuleRow = {
        ...ruleRow,
        id: '00000000-0000-4000-8000-000000000022',
        trigger: FineTrigger.ATTENDANCE_LATE,
      };
      const otherRule = await fineRulesTab.upsert(otherRuleRow, null, TENANT_A, dataSource.manager);

      const billRow: StudentFeeRow = {
        id: '00000000-0000-4000-8000-000000000023',
        student_id: studentA1.id,
        student_key: studentA1.registration_number,
        academic_year_id: yearAId,
        academic_year_key: '2026-2027',
        fee_structure_id: feeStructureAId,
        fee_structure_key: FEE_STRUCTURE_A_KEY,
        month: 1,
        year: 2026,
        occurrence: 1,
        total_amount: '20.00',
        paid_amount: '0.00',
        discount_amount: '0.00',
        standing_discount_amount: '0.00',
        one_off_discount_amount: '0.00',
        status: FeeStatus.PENDING,
        due_date: null,
        reminder_threshold_date: null,
        note: 'Absent without notice',
        incident_date: '2026-01-12',
        fine_rule_id: rule.id,
        fine_rule_key: fineRulesTab.keyOf(ruleRow),
      };
      await studentFeesTab.upsert(billRow, null, TENANT_A, dataSource.manager);

      // `load()` hands `upsert` the previously-loaded entity as `existing` —
      // this is the exact path where a loaded `fine_rule` relation used to
      // shadow a changed `fine_rule_id` column on save (see student-fees.tab.ts).
      const [existing] = await studentFeesTab.load(TENANT_A, dataSource.manager);
      const updated = await studentFeesTab.upsert(
        { ...billRow, fine_rule_id: otherRule.id, fine_rule_key: fineRulesTab.keyOf(otherRuleRow) },
        existing,
        TENANT_A,
        dataSource.manager,
      );
      expect(updated.fine_rule_id).toBe(otherRule.id);
      const [reloadedAfterChange] = await studentFeesTab.load(TENANT_A, dataSource.manager);
      expect(reloadedAfterChange.fine_rule_id).toBe(otherRule.id);

      const cleared = await studentFeesTab.upsert(
        { ...billRow, fine_rule_id: null, fine_rule_key: null },
        reloadedAfterChange,
        TENANT_A,
        dataSource.manager,
      );
      expect(cleared.fine_rule_id).toBeNull();
      const [reloadedAfterClear] = await studentFeesTab.load(TENANT_A, dataSource.manager);
      expect(reloadedAfterClear.fine_rule_id).toBeNull();
    });
  });

  describe('student_fees', () => {
    beforeEach(seedFeeStructureA);

    function rowFor(overrides: Partial<StudentFeeRow> = {}): StudentFeeRow {
      return {
        id: '00000000-0000-4000-8000-000000000002',
        student_id: studentA1.id,
        student_key: studentA1.registration_number,
        academic_year_id: yearAId,
        academic_year_key: '2026-2027',
        fee_structure_id: feeStructureAId,
        fee_structure_key: FEE_STRUCTURE_A_KEY,
        month: 1,
        year: 2026,
        occurrence: 1,
        total_amount: '1500.00',
        paid_amount: '0.00',
        discount_amount: '0.00',
        standing_discount_amount: '0.00',
        one_off_discount_amount: '0.00',
        status: FeeStatus.PENDING,
        due_date: '2026-01-10',
        reminder_threshold_date: '2026-01-05',
        note: null,
        incident_date: null,
        fine_rule_id: null,
        fine_rule_key: null,
        ...overrides,
      };
    }

    it('upsert creates a new row', async () => {
      const created = await studentFeesTab.upsert(rowFor(), null, TENANT_A, dataSource.manager);
      expect(created.id).toBeDefined();
      expect(created.student_id).toBe(studentA1.id);
    });

    it('upsert persists a FINE bill with note/incident_date/fine_rule_id', async () => {
      const rule = await fineRulesTab.upsert(
        {
          id: '00000000-0000-4000-8000-000000000013',
          academic_year_id: yearAId,
          academic_year_key: '2026-2027',
          trigger: FineTrigger.ATTENDANCE_ABSENT,
          fee_structure_id: feeStructureAId,
          fee_structure_key: FEE_STRUCTURE_A_KEY,
          class_id: null,
          class_key: null,
          free_per_period: 2,
          cap_per_period: '200.00',
          conditions: {},
          is_active: true,
        },
        null,
        TENANT_A,
        dataSource.manager,
      );
      const created = await studentFeesTab.upsert(
        rowFor({
          note: 'Missed 3 days without notice',
          incident_date: '2026-01-12',
          fine_rule_id: rule.id,
          fine_rule_key: `2026-2027|${FineTrigger.ATTENDANCE_ABSENT}|`,
        }),
        null,
        TENANT_A,
        dataSource.manager,
      );
      expect(created.note).toBe('Missed 3 days without notice');
      expect(created.fine_rule_id).toBe(rule.id);
      const [loaded] = await studentFeesTab.load(TENANT_A, dataSource.manager);
      expect(loaded.fine_rule_id).toBe(rule.id);
    });

    it('upsert with a changed field updates only that field', async () => {
      const created = await studentFeesTab.upsert(rowFor(), null, TENANT_A, dataSource.manager);
      const updated = await studentFeesTab.upsert(
        rowFor({ paid_amount: '500.00' }),
        created,
        TENANT_A,
        dataSource.manager,
      );
      expect(updated.paid_amount).toBe('500.00');
      expect(updated.total_amount).toBe('1500.00');
    });

    it('remove hard-deletes (no deleted_at column)', async () => {
      const created = await studentFeesTab.upsert(rowFor(), null, TENANT_A, dataSource.manager);
      await studentFeesTab.remove(created, dataSource.manager);
      const found = await studentFeeRepo.findOne({ where: { id: created.id } });
      expect(found).toBeNull();
    });

    it('remove surfaces a clear error when referenced by a payment allocation', async () => {
      const created = await studentFeesTab.upsert(rowFor(), null, TENANT_A, dataSource.manager);
      const payment = await dataSource.manager.query(
        `INSERT INTO payments (student_id, total_amount, payment_method, payment_status, payment_date, tenant_id)
         VALUES ($1, '500.00', 'CASH', 'SUCCESS', now(), $2) RETURNING id`,
        [studentA1.id, TENANT_A],
      );
      await dataSource.manager.query(
        `INSERT INTO payment_allocations (payment_id, student_fee_id, allocated_amount, allocation_type)
         VALUES ($1, $2, '500.00', 'CURRENT')`,
        [payment[0].id, created.id],
      );

      await expect(studentFeesTab.remove(created, dataSource.manager)).rejects.toThrow(
        /referenced by a payment/,
      );

      await dataSource.manager.query(`DELETE FROM payment_allocations WHERE student_fee_id = $1`, [
        created.id,
      ]);
      await dataSource.manager.query(`DELETE FROM payments WHERE id = $1`, [payment[0].id]);
    });

    it('load(tenantA) never returns tenant B rows', async () => {
      await studentFeesTab.upsert(rowFor(), null, TENANT_A, dataSource.manager);
      const rowsA = await studentFeesTab.load(TENANT_A, dataSource.manager);
      const rowsB = await studentFeesTab.load(TENANT_B, dataSource.manager);
      expect(rowsA.length).toBe(1);
      expect(rowsB.length).toBe(0);
    });

    it('keyOf reads the student registration_number off the loaded entity', async () => {
      await studentFeesTab.upsert(rowFor(), null, TENANT_A, dataSource.manager);
      const [loaded] = await studentFeesTab.load(TENANT_A, dataSource.manager);
      expect(studentFeesTab.keyOf(loaded)).toBe(
        `${studentA1.registration_number}|2026-2027|${FEE_STRUCTURE_A_KEY}|1|2026|1`,
      );
    });
  });

  describe('invoices', () => {
    let feeId: string;

    beforeEach(async () => {
      await seedFeeStructureA();
      const fee = await studentFeesTab.upsert(
        {
          id: '00000000-0000-4000-8000-000000000003',
          student_id: studentA1.id,
          student_key: studentA1.registration_number,
          academic_year_id: yearAId,
          academic_year_key: '2026-2027',
          fee_structure_id: feeStructureAId,
          fee_structure_key: FEE_STRUCTURE_A_KEY,
          month: 1,
          year: 2026,
          occurrence: 1,
          total_amount: '1500.00',
          paid_amount: '0.00',
          discount_amount: '0.00',
          standing_discount_amount: '0.00',
          one_off_discount_amount: '0.00',
          status: FeeStatus.PENDING,
          due_date: '2026-01-10',
          reminder_threshold_date: '2026-01-05',
          note: null,
          incident_date: null,
          fine_rule_id: null,
          fine_rule_key: null,
        },
        null,
        TENANT_A,
        dataSource.manager,
      );
      feeId = fee.id;
    });

    function rowFor(overrides: Partial<InvoiceRow> = {}): InvoiceRow {
      return {
        id: '00000000-0000-4000-8000-000000000004',
        invoice_number: 'INV-2026-00001',
        kind: InvoiceKind.INVOICE,
        student_id: studentA1.id,
        student_key: studentA1.registration_number,
        total_amount: '1500.00',
        tax_amount: '0.00',
        discount_amount: '0.00',
        status: InvoiceStatus.ISSUED,
        issued_date: '2026-01-05',
        due_date: '2026-01-15',
        snapshot: { issuer: {}, students: [], totals: {}, payment: {} },
        issued_by_id: null,
        issued_by_key: null,
        notes: null,
        ...overrides,
      };
    }

    it('upsert creates a new row with issuer_snapshot null', async () => {
      const created = await invoicesTab.upsert(rowFor(), null, TENANT_A, dataSource.manager);
      expect(created.id).toBeDefined();
      expect(created.invoice_number).toBe('INV-2026-00001');
      expect(created.issuer_snapshot).toBeNull();
    });

    it('upsert with a changed field updates only that field', async () => {
      const created = await invoicesTab.upsert(rowFor(), null, TENANT_A, dataSource.manager);
      const updated = await invoicesTab.upsert(
        rowFor({ status: InvoiceStatus.PAID }),
        created,
        TENANT_A,
        dataSource.manager,
      );
      expect(updated.status).toBe(InvoiceStatus.PAID);
      expect(updated.invoice_number).toBe('INV-2026-00001');
    });

    it('remove soft-deletes', async () => {
      const created = await invoicesTab.upsert(rowFor(), null, TENANT_A, dataSource.manager);
      await invoicesTab.remove(created, dataSource.manager);
      const found = await invoiceRepo.findOne({ where: { id: created.id }, withDeleted: true });
      expect(found?.deleted_at).not.toBeNull();
    });

    it('load(tenantA) never returns tenant B rows', async () => {
      await invoicesTab.upsert(rowFor(), null, TENANT_A, dataSource.manager);
      const rowsA = await invoicesTab.load(TENANT_A, dataSource.manager);
      const rowsB = await invoicesTab.load(TENANT_B, dataSource.manager);
      expect(rowsA.length).toBe(1);
      expect(rowsB.length).toBe(0);
    });

    it('keyOf is the invoice_number for both a row and a loaded entity', async () => {
      const created = await invoicesTab.upsert(rowFor(), null, TENANT_A, dataSource.manager);
      expect(invoicesTab.keyOf(created)).toBe('INV-2026-00001');
    });
  });

  describe('payments', () => {
    function rowFor(overrides: Partial<PaymentRow> = {}): PaymentRow {
      return {
        id: '00000000-0000-4000-8000-000000000005',
        student_id: studentA1.id,
        student_key: studentA1.registration_number,
        total_amount: '1500.00',
        payment_method: PaymentMethod.CASH,
        payment_status: PaymentStatus.SUCCESS,
        transaction_reference: 'TXN-001',
        remarks: null,
        received_by_id: null,
        received_by_key: null,
        invoice_id: null,
        invoice_key: null,
        payment_date: '2026-01-05T10:00:00.000Z',
        ...overrides,
      };
    }

    it('upsert creates a new row with issuer_snapshot null', async () => {
      const created = await paymentsTab.upsert(rowFor(), null, TENANT_A, dataSource.manager);
      expect(created.id).toBeDefined();
      expect(created.tenant_id).toBe(TENANT_A);
      expect(created.issuer_snapshot).toBeNull();
    });

    it('upsert with a changed field updates only that field', async () => {
      const created = await paymentsTab.upsert(rowFor(), null, TENANT_A, dataSource.manager);
      const updated = await paymentsTab.upsert(
        rowFor({ remarks: 'Updated remark' }),
        created,
        TENANT_A,
        dataSource.manager,
      );
      expect(updated.remarks).toBe('Updated remark');
      expect(updated.total_amount).toBe('1500.00');
    });

    it('remove soft-deletes', async () => {
      const created = await paymentsTab.upsert(rowFor(), null, TENANT_A, dataSource.manager);
      await paymentsTab.remove(created, dataSource.manager);
      const found = await paymentRepo.findOne({ where: { id: created.id }, withDeleted: true });
      expect(found?.deleted_at).not.toBeNull();
    });

    it('load(tenantA) never returns tenant B rows', async () => {
      await paymentsTab.upsert(rowFor(), null, TENANT_A, dataSource.manager);
      const rowsA = await paymentsTab.load(TENANT_A, dataSource.manager);
      const rowsB = await paymentsTab.load(TENANT_B, dataSource.manager);
      expect(rowsA.length).toBe(1);
      expect(rowsB.length).toBe(0);
    });

    it('keyOf uses transaction_reference off a loaded entity', async () => {
      await paymentsTab.upsert(rowFor(), null, TENANT_A, dataSource.manager);
      const [loaded] = await paymentsTab.load(TENANT_A, dataSource.manager);
      expect(paymentsTab.keyOf(loaded)).toBe('TXN-001');
    });

    it('keyOf(entity) uses the real registration_number, not a raw student uuid, on the fallback path', async () => {
      await paymentsTab.upsert(
        rowFor({ transaction_reference: null }),
        null,
        TENANT_A,
        dataSource.manager,
      );
      const [loaded] = await paymentsTab.load(TENANT_A, dataSource.manager);
      const key = paymentsTab.keyOf(loaded);
      expect(key.startsWith(`${studentA1.registration_number}|`)).toBe(true);
      expect(key).not.toContain(studentA1.id);
    });
  });

  describe('payment_allocations', () => {
    let feeId: string;
    let paymentId: string;

    beforeEach(async () => {
      await seedFeeStructureA();
      const fee = await studentFeesTab.upsert(
        {
          id: '00000000-0000-4000-8000-000000000006',
          student_id: studentA1.id,
          student_key: studentA1.registration_number,
          academic_year_id: yearAId,
          academic_year_key: '2026-2027',
          fee_structure_id: feeStructureAId,
          fee_structure_key: FEE_STRUCTURE_A_KEY,
          month: 1,
          year: 2026,
          occurrence: 1,
          total_amount: '1500.00',
          paid_amount: '0.00',
          discount_amount: '0.00',
          standing_discount_amount: '0.00',
          one_off_discount_amount: '0.00',
          status: FeeStatus.PENDING,
          due_date: '2026-01-10',
          reminder_threshold_date: '2026-01-05',
          note: null,
          incident_date: null,
          fine_rule_id: null,
          fine_rule_key: null,
        },
        null,
        TENANT_A,
        dataSource.manager,
      );
      feeId = fee.id;

      const payment = await paymentsTab.upsert(
        {
          id: '00000000-0000-4000-8000-000000000007',
          student_id: studentA1.id,
          student_key: studentA1.registration_number,
          total_amount: '500.00',
          payment_method: PaymentMethod.CASH,
          payment_status: PaymentStatus.SUCCESS,
          transaction_reference: 'TXN-002',
          remarks: null,
          received_by_id: null,
          received_by_key: null,
          invoice_id: null,
          invoice_key: null,
          payment_date: '2026-01-06T10:00:00.000Z',
        },
        null,
        TENANT_A,
        dataSource.manager,
      );
      paymentId = payment.id;
    });

    function rowFor(overrides: Partial<PaymentAllocationRow> = {}): PaymentAllocationRow {
      return {
        id: '00000000-0000-4000-8000-000000000008',
        payment_id: paymentId,
        payment_key: 'TXN-002',
        student_fee_id: feeId,
        student_fee_key: `${studentA1.registration_number}|2026-2027|${FEE_STRUCTURE_A_KEY}|1|2026|1`,
        allocated_amount: '500.00',
        allocation_type: PaymentAllocationType.CURRENT,
        notes: null,
        ...overrides,
      };
    }

    it('upsert creates a new row', async () => {
      const created = await paymentAllocationsTab.upsert(
        rowFor(),
        null,
        TENANT_A,
        dataSource.manager,
      );
      expect(created.id).toBeDefined();
      expect(created.payment_id).toBe(paymentId);
    });

    it('upsert with a changed field updates only that field', async () => {
      const created = await paymentAllocationsTab.upsert(
        rowFor(),
        null,
        TENANT_A,
        dataSource.manager,
      );
      const updated = await paymentAllocationsTab.upsert(
        rowFor({ notes: 'Adjusted' }),
        created,
        TENANT_A,
        dataSource.manager,
      );
      expect(updated.notes).toBe('Adjusted');
      expect(updated.allocated_amount).toBe('500.00');
    });

    it('remove hard-deletes (no deleted_at column)', async () => {
      const created = await paymentAllocationsTab.upsert(
        rowFor(),
        null,
        TENANT_A,
        dataSource.manager,
      );
      await paymentAllocationsTab.remove(created, dataSource.manager);
      const found = await paymentAllocationRepo.findOne({ where: { id: created.id } });
      expect(found).toBeNull();
    });

    it('load(tenantA) never returns tenant B rows', async () => {
      await paymentAllocationsTab.upsert(rowFor(), null, TENANT_A, dataSource.manager);
      const rowsA = await paymentAllocationsTab.load(TENANT_A, dataSource.manager);
      const rowsB = await paymentAllocationsTab.load(TENANT_B, dataSource.manager);
      expect(rowsA.length).toBe(1);
      expect(rowsB.length).toBe(0);
    });

    it('keyOf joins the payment and student_fee keys off the loaded entity', async () => {
      await paymentAllocationsTab.upsert(rowFor(), null, TENANT_A, dataSource.manager);
      const [loaded] = await paymentAllocationsTab.load(TENANT_A, dataSource.manager);
      expect(paymentAllocationsTab.keyOf(loaded)).toBe(
        `TXN-002|${studentA1.registration_number}|2026-2027|${FEE_STRUCTURE_A_KEY}|1|2026|1`,
      );
    });
  });
});

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
import { FeeStructureStudent } from '../../../fees/entities/fee-structure-student.entity';
import { StudentFee } from '../../../fees/entities/student-fee.entity';
import { Invoice } from '../../../invoices/entities/invoice.entity';
import { Payment } from '../../../fees/entities/payment.entity';
import { PaymentAllocation } from '../../../fees/entities/payment-allocation.entity';
import {
  FeeApplicability,
  FeeStatus,
  FeeType,
  InvoiceStatus,
  PaymentAllocationType,
  PaymentMethod,
  PaymentStatus,
} from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { feeStructuresTab, type FeeStructureRow } from './fee-structures.tab';
import { studentFeesTab, type StudentFeeRow } from './student-fees.tab';
import { invoicesTab, type InvoiceRow } from './invoices.tab';
import { paymentsTab, type PaymentRow } from './payments.tab';
import { paymentAllocationsTab, type PaymentAllocationRow } from './payment-allocations.tab';
import type { ImportContext } from '../../codec/tab-spec';

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
  let feeStructureStudentRepo: Repository<FeeStructureStudent>;
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

  function importCtx(): ImportContext {
    return {
      tenantId: TENANT_A,
      ref: () => undefined,
      warn: () => undefined,
    };
  }

  beforeAll(async () => {
    module = await createTestModule(ALL_ENTITIES, []);
    dataSource = module.get(DataSource);
    schoolRepo = module.get<Repository<School>>(getRepositoryToken(School));
    yearRepo = module.get<Repository<AcademicYear>>(getRepositoryToken(AcademicYear));
    classRepo = module.get<Repository<Class>>(getRepositoryToken(Class));
    sectionRepo = module.get<Repository<ClassSection>>(getRepositoryToken(ClassSection));
    studentRepo = module.get<Repository<Student>>(getRepositoryToken(Student));
    feeStructureRepo = module.get<Repository<FeeStructure>>(getRepositoryToken(FeeStructure));
    feeStructureStudentRepo = module.get<Repository<FeeStructureStudent>>(
      getRepositoryToken(FeeStructureStudent),
    );
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
    await feeStructureStudentRepo.createQueryBuilder().delete().execute();
    await studentFeeRepo.createQueryBuilder().delete().execute();
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

  describe('fee_structures', () => {
    function rowFor(overrides: Partial<FeeStructureRow> = {}): FeeStructureRow {
      return {
        id: '00000000-0000-4000-8000-000000000001',
        name: 'Tuition - January',
        fee_type: FeeType.MONTHLY_TUITION,
        amount: '1500.00',
        applicability: FeeApplicability.SELECTED,
        class_id: classAId,
        class_key: 'Class 5|2026-2027',
        academic_year_id: yearAId,
        academic_year_key: '2026-2027',
        section_id: sectionAId,
        section_key: 'Class 5|2026-2027|A',
        month: 1,
        is_recurring: true,
        selected_student_ids: [studentA1.id, studentA2.id],
        selected_student_keys: ['REG-A-001', 'REG-A-002'],
        ...overrides,
      };
    }

    it('upsert creates a new row and the selected-student pivot', async () => {
      const created = await feeStructuresTab.upsert(rowFor(), null, TENANT_A, dataSource.manager);
      expect(created.id).toBeDefined();
      expect(created.tenant_id).toBe(TENANT_A);

      const links = await feeStructureStudentRepo.find({ where: { fee_structure_id: created.id } });
      expect(links.map((l) => l.student_id).sort()).toEqual([studentA1.id, studentA2.id].sort());
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

    it('upsert replaces selected_students to match the row', async () => {
      const created = await feeStructuresTab.upsert(rowFor(), null, TENANT_A, dataSource.manager);
      const updated = await feeStructuresTab.upsert(
        rowFor({ selected_student_ids: [studentA1.id], selected_student_keys: ['REG-A-001'] }),
        created,
        TENANT_A,
        dataSource.manager,
      );
      const links = await feeStructureStudentRepo.find({ where: { fee_structure_id: updated.id } });
      expect(links.map((l) => l.student_id)).toEqual([studentA1.id]);
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

    it('fromRow resolves selected_students via a real student registration_number lookup', () => {
      const ctx: ImportContext = {
        ...importCtx(),
        ref: (tab, key) => {
          if (tab === 'classes' && key === 'Class 5|2026-2027') return classAId;
          if (tab === 'academic_years' && key === '2026-2027') return yearAId;
          if (tab === 'sections' && key === 'Class 5|2026-2027|A') return sectionAId;
          if (tab === 'students' && key === studentA1.registration_number) return studentA1.id;
          if (tab === 'students' && key === studentA2.registration_number) return studentA2.id;
          return undefined;
        },
      };
      const result = feeStructuresTab.fromRow(
        {
          id: '00000000-0000-4000-8000-000000000001',
          name: 'Tuition',
          fee_type: FeeType.MONTHLY_TUITION,
          amount: '1500.00',
          applicability: FeeApplicability.SELECTED,
          class: 'Class 5|2026-2027',
          academic_year: '2026-2027',
          section: 'Class 5|2026-2027|A',
          month: '1',
          is_recurring: 'TRUE',
          selected_students: `${studentA1.registration_number};${studentA2.registration_number}`,
        },
        2,
        ctx,
      );
      expect('row' in result).toBe(true);
      const row = (result as { row: FeeStructureRow }).row;
      expect(row.selected_student_ids).toEqual([studentA1.id, studentA2.id]);
    });
  });

  describe('student_fees', () => {
    function rowFor(overrides: Partial<StudentFeeRow> = {}): StudentFeeRow {
      return {
        id: '00000000-0000-4000-8000-000000000002',
        student_id: studentA1.id,
        student_key: studentA1.registration_number,
        academic_year_id: yearAId,
        academic_year_key: '2026-2027',
        month: 1,
        year: 2026,
        total_amount: '1500.00',
        paid_amount: '0.00',
        discount_amount: '0.00',
        status: FeeStatus.PENDING,
        due_date: '2026-01-10',
        reminder_threshold_date: '2026-01-05',
        is_advance_payment: false,
        original_advance_month: null,
        original_advance_year: null,
        ...overrides,
      };
    }

    it('upsert creates a new row', async () => {
      const created = await studentFeesTab.upsert(rowFor(), null, TENANT_A, dataSource.manager);
      expect(created.id).toBeDefined();
      expect(created.student_id).toBe(studentA1.id);
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
        `${studentA1.registration_number}|2026-2027|1|2026`,
      );
    });
  });

  describe('invoices', () => {
    let feeId: string;

    beforeEach(async () => {
      const fee = await studentFeesTab.upsert(
        {
          id: '00000000-0000-4000-8000-000000000003',
          student_id: studentA1.id,
          student_key: studentA1.registration_number,
          academic_year_id: yearAId,
          academic_year_key: '2026-2027',
          month: 1,
          year: 2026,
          total_amount: '1500.00',
          paid_amount: '0.00',
          discount_amount: '0.00',
          status: FeeStatus.PENDING,
          due_date: '2026-01-10',
          reminder_threshold_date: '2026-01-05',
          is_advance_payment: false,
          original_advance_month: null,
          original_advance_year: null,
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
        student_id: studentA1.id,
        student_key: studentA1.registration_number,
        student_fee_id: feeId,
        student_fee_key: `${studentA1.registration_number}|2026-2027|1|2026`,
        total_amount: '1500.00',
        tax_amount: '0.00',
        discount_amount: '0.00',
        status: InvoiceStatus.ISSUED,
        issued_date: '2026-01-05',
        due_date: '2026-01-15',
        line_items: [{ description: 'Tuition', amount: 1500, quantity: 1, total: 1500 }],
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
      const fee = await studentFeesTab.upsert(
        {
          id: '00000000-0000-4000-8000-000000000006',
          student_id: studentA1.id,
          student_key: studentA1.registration_number,
          academic_year_id: yearAId,
          academic_year_key: '2026-2027',
          month: 1,
          year: 2026,
          total_amount: '1500.00',
          paid_amount: '0.00',
          discount_amount: '0.00',
          status: FeeStatus.PENDING,
          due_date: '2026-01-10',
          reminder_threshold_date: '2026-01-05',
          is_advance_payment: false,
          original_advance_month: null,
          original_advance_year: null,
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
        student_fee_key: `${studentA1.registration_number}|2026-2027|1|2026`,
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
        `TXN-002|${studentA1.registration_number}|2026-2027|1|2026`,
      );
    });
  });
});

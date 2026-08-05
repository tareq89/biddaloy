import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { Repository, DataSource } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { InvoicesService } from './invoices.service';
import { Invoice } from './entities/invoice.entity';
import { StudentFee } from '../fees/entities/student-fee.entity';
import { Payment } from '../fees/entities/payment.entity';
import { PaymentAllocation } from '../fees/entities/payment-allocation.entity';
import { Student } from '../students/entities/student.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { School } from '../schools/entities/school.entity';
import { User } from '../users/entities/user.entity';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import {
  SEED_TENANT_ID,
  SEED_CLASS_1_ID,
  SEED_SECTION_1_ID,
  SEED_ACADEMIC_YEAR_ID,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';
import { FeeStatus, InvoiceStatus } from '@beton-boi/shared';

/**
 * Integration tests for InvoicesService (issue #14 — Invoice Generation & Printing).
 *
 * Runs against a real PostgreSQL database. Verifies manual invoice creation
 * (default line item from a StudentFee vs. explicit line_items override),
 * tenant isolation, listing/filtering, printable HTML rendering, and
 * sequential invoice numbering under concurrency.
 */

const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000000099';

let studentSeq = 0;

async function seedReferenceData(ds: DataSource): Promise<void> {
  await ds.query('DELETE FROM payment_allocations');
  await ds.query('DELETE FROM invoices');
  await ds.query('DELETE FROM payments');
  await ds.query('DELETE FROM student_fees');
  await ds.query('DELETE FROM student_guardians');
  await ds.query('DELETE FROM students');
  await ds.query('DELETE FROM class_sections');
  await ds.query('DELETE FROM classes');
  await ds.query('DELETE FROM academic_years');
  await ds.query('DELETE FROM users');
  await ds.query('DELETE FROM schools');

  const schoolRepo = ds.getRepository(School);
  const classRepo = ds.getRepository(Class);
  const sectionRepo = ds.getRepository(ClassSection);
  const ayRepo = ds.getRepository(AcademicYear);
  const userRepo = ds.getRepository(User);

  await schoolRepo.save(
    schoolRepo.create({ id: SEED_TENANT_ID, name: 'Test School', slug: 'test-school' }),
  );
  await userRepo.save(
    userRepo.create({
      id: SEED_ADMIN_USER_ID,
      email: SEED_ADMIN_EMAIL,
      password_hash: SEED_ADMIN_PASSWORD_HASH,
      full_name: 'Test Admin',
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
      id: SEED_CLASS_1_ID,
      name: 'Class One',
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
    schoolRepo.create({ id: OTHER_TENANT_ID, name: 'Other School', slug: 'other-school' }),
  );
}

describe('InvoicesService (integration)', () => {
  let service: InvoicesService;
  let studentRepo: Repository<Student>;
  let studentFeeRepo: Repository<StudentFee>;
  let invoiceRepo: Repository<Invoice>;
  let dataSource: DataSource;

  const TENANT_ID = SEED_TENANT_ID;

  function makeStudent(overrides: Partial<Student> = {}) {
    studentSeq += 1;
    return studentRepo.create({
      full_name: `Student ${studentSeq}`,
      registration_number: `REG-INV-${String(studentSeq).padStart(4, '0')}`,
      roll_number: studentSeq,
      class_section_id: SEED_SECTION_1_ID,
      tenant_id: TENANT_ID,
      date_of_birth: new Date('2010-01-01'),
      preferred_communication: 'SMS' as any,
      ...overrides,
    });
  }

  function makeFee(studentId: string, overrides: Partial<StudentFee> = {}) {
    return studentFeeRepo.create({
      student_id: studentId,
      academic_year_id: SEED_ACADEMIC_YEAR_ID,
      month: 3,
      year: 2026,
      total_amount: 1000,
      paid_amount: 0,
      discount_amount: 0,
      status: FeeStatus.PENDING,
      ...overrides,
    });
  }

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [InvoicesService], [], {
      synchronize: true,
      dropSchema: true,
    });

    service = module.get<InvoicesService>(InvoicesService);
    studentRepo = module.get<Repository<Student>>(getRepositoryToken(Student));
    studentFeeRepo = module.get<Repository<StudentFee>>(getRepositoryToken(StudentFee));
    invoiceRepo = module.get<Repository<Invoice>>(getRepositoryToken(Invoice));
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
      await dataSource.query('DELETE FROM invoices');
      await dataSource.query('DELETE FROM payments');
      await dataSource.query('DELETE FROM student_fees');
      await dataSource.query('DELETE FROM students');
    }
  });

  describe('create', () => {
    it('defaults to a single "Fee for M/Y" line item from student_fee_id', async () => {
      const student = await studentRepo.save(makeStudent());
      const fee = await studentFeeRepo.save(
        makeFee(student.id, { total_amount: 1500, month: 4, year: 2026 }),
      );

      const invoice = await service.create(
        { student_id: student.id, student_fee_id: fee.id },
        TENANT_ID,
        SEED_ADMIN_USER_ID,
      );

      // Invoice numbers must follow the sequential INV-YYYY-XXXXX format.
      expect(invoice.invoice_number).toMatch(/^INV-\d{4}-\d{5}$/);
      // With no explicit line_items, total_amount is derived straight from the StudentFee.
      expect(Number(invoice.total_amount)).toBe(1500);
      expect(invoice.line_items).toHaveLength(1);
      expect(invoice.line_items![0].description).toBe('Fee for 4/2026');
      expect(invoice.status).toBe(InvoiceStatus.ISSUED);
    });

    it('uses explicit line_items when provided, summing to total_amount', async () => {
      const student = await studentRepo.save(makeStudent());

      const invoice = await service.create(
        {
          student_id: student.id,
          line_items: [
            { description: 'Tuition', amount: 800, quantity: 1 },
            { description: 'Transport', amount: 200, quantity: 1 },
          ],
        },
        TENANT_ID,
        SEED_ADMIN_USER_ID,
      );

      expect(invoice.line_items).toHaveLength(2);
      // total_amount is not caller-supplied — it's always the sum of line item totals.
      expect(Number(invoice.total_amount)).toBe(1000);
    });

    it('assigns sequential invoice numbers across separate creates', async () => {
      const student1 = await studentRepo.save(makeStudent());
      const student2 = await studentRepo.save(makeStudent());
      const fee1 = await studentFeeRepo.save(makeFee(student1.id));
      const fee2 = await studentFeeRepo.save(makeFee(student2.id));

      const inv1 = await service.create(
        { student_id: student1.id, student_fee_id: fee1.id },
        TENANT_ID,
        SEED_ADMIN_USER_ID,
      );
      const inv2 = await service.create(
        { student_id: student2.id, student_fee_id: fee2.id },
        TENANT_ID,
        SEED_ADMIN_USER_ID,
      );

      const seq1 = parseInt(inv1.invoice_number.split('-')[2], 10);
      const seq2 = parseInt(inv2.invoice_number.split('-')[2], 10);
      expect(seq2).toBe(seq1 + 1);
    });

    it('assigns distinct invoice numbers under concurrent creates', async () => {
      const studentA = await studentRepo.save(makeStudent());
      const studentB = await studentRepo.save(makeStudent());
      const feeA = await studentFeeRepo.save(makeFee(studentA.id));
      const feeB = await studentFeeRepo.save(makeFee(studentB.id));

      const [invA, invB] = await Promise.all([
        service.create(
          { student_id: studentA.id, student_fee_id: feeA.id },
          TENANT_ID,
          SEED_ADMIN_USER_ID,
        ),
        service.create(
          { student_id: studentB.id, student_fee_id: feeB.id },
          TENANT_ID,
          SEED_ADMIN_USER_ID,
        ),
      ]);

      expect(invA.invoice_number).not.toBe(invB.invoice_number);
    });

    it('throws BadRequestException when neither student_fee_id nor line_items is given', async () => {
      const student = await studentRepo.save(makeStudent());

      await expect(
        service.create({ student_id: student.id }, TENANT_ID, SEED_ADMIN_USER_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when student belongs to a different tenant', async () => {
      const student = await studentRepo.save(makeStudent({ tenant_id: OTHER_TENANT_ID }));

      await expect(
        service.create(
          {
            student_id: student.id,
            line_items: [{ description: 'Fee', amount: 100, quantity: 1 }],
          },
          TENANT_ID,
          SEED_ADMIN_USER_ID,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when student_fee_id does not belong to the student', async () => {
      const student = await studentRepo.save(makeStudent());
      const otherStudent = await studentRepo.save(makeStudent());
      const foreignFee = await studentFeeRepo.save(makeFee(otherStudent.id));

      await expect(
        service.create(
          { student_id: student.id, student_fee_id: foreignFee.id },
          TENANT_ID,
          SEED_ADMIN_USER_ID,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findOne', () => {
    it('returns the invoice for the owning tenant', async () => {
      const student = await studentRepo.save(makeStudent());
      const fee = await studentFeeRepo.save(makeFee(student.id));
      const created = await service.create(
        { student_id: student.id, student_fee_id: fee.id },
        TENANT_ID,
        SEED_ADMIN_USER_ID,
      );

      const found = await service.findOne(created.id, TENANT_ID);
      expect(found.id).toBe(created.id);
      expect(found.student.full_name).toBe(student.full_name);
    });

    it('throws NotFoundException for a different tenant', async () => {
      const student = await studentRepo.save(makeStudent());
      const fee = await studentFeeRepo.save(makeFee(student.id));
      const created = await service.create(
        { student_id: student.id, student_fee_id: fee.id },
        TENANT_ID,
        SEED_ADMIN_USER_ID,
      );

      await expect(service.findOne(created.id, OTHER_TENANT_ID)).rejects.toThrow(NotFoundException);
    });

    it('excludes a soft-deleted invoice', async () => {
      const student = await studentRepo.save(makeStudent());
      const fee = await studentFeeRepo.save(makeFee(student.id));
      const created = await service.create(
        { student_id: student.id, student_fee_id: fee.id },
        TENANT_ID,
        SEED_ADMIN_USER_ID,
      );

      await invoiceRepo.softDelete(created.id);
      const deleted = await invoiceRepo.findOne({ where: { id: created.id }, withDeleted: true });
      expect(deleted!.deleted_at).not.toBeNull();

      await expect(service.findOne(created.id, TENANT_ID)).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAll', () => {
    it('filters by student_id and status, and paginates', async () => {
      const student1 = await studentRepo.save(makeStudent());
      const student2 = await studentRepo.save(makeStudent());
      const fee1 = await studentFeeRepo.save(makeFee(student1.id));
      const fee2 = await studentFeeRepo.save(makeFee(student2.id));
      await service.create(
        { student_id: student1.id, student_fee_id: fee1.id },
        TENANT_ID,
        SEED_ADMIN_USER_ID,
      );
      await service.create(
        { student_id: student2.id, student_fee_id: fee2.id },
        TENANT_ID,
        SEED_ADMIN_USER_ID,
      );

      const result = await service.findAll(
        { student_id: student1.id, page: 1, limit: 10 },
        TENANT_ID,
      );
      expect(result.total).toBe(1);
      expect(result.data[0].student_id).toBe(student1.id);

      const statusResult = await service.findAll(
        { status: InvoiceStatus.ISSUED, page: 1, limit: 10 },
        TENANT_ID,
      );
      expect(statusResult.total).toBe(2);
    });

    it('does not return invoices belonging to another tenant', async () => {
      const student = await studentRepo.save(makeStudent());
      const fee = await studentFeeRepo.save(makeFee(student.id));
      await service.create(
        { student_id: student.id, student_fee_id: fee.id },
        TENANT_ID,
        SEED_ADMIN_USER_ID,
      );

      const result = await service.findAll({ page: 1, limit: 10 }, OTHER_TENANT_ID);
      expect(result.total).toBe(0);
    });

    it('excludes soft-deleted invoices', async () => {
      const student = await studentRepo.save(makeStudent());
      const fee = await studentFeeRepo.save(makeFee(student.id));
      const created = await service.create(
        { student_id: student.id, student_fee_id: fee.id },
        TENANT_ID,
        SEED_ADMIN_USER_ID,
      );

      await invoiceRepo.softDelete(created.id);

      const result = await service.findAll({ page: 1, limit: 10 }, TENANT_ID);
      expect(result.data.find((inv) => inv.id === created.id)).toBeUndefined();
    });
  });

  describe('getPrintableHtml', () => {
    it('renders an HTML document containing the invoice number, student name, and line items', async () => {
      const student = await studentRepo.save(makeStudent({ full_name: 'Printable Student' }));
      const fee = await studentFeeRepo.save(makeFee(student.id, { total_amount: 750 }));
      const invoice = await service.create(
        { student_id: student.id, student_fee_id: fee.id },
        TENANT_ID,
        SEED_ADMIN_USER_ID,
      );

      const html = await service.getPrintableHtml(invoice.id, TENANT_ID);

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain(invoice.invoice_number);
      expect(html).toContain('Printable Student');
      expect(html).toContain('750.00');
    });

    it('throws NotFoundException for a different tenant', async () => {
      const student = await studentRepo.save(makeStudent());
      const fee = await studentFeeRepo.save(makeFee(student.id));
      const invoice = await service.create(
        { student_id: student.id, student_fee_id: fee.id },
        TENANT_ID,
        SEED_ADMIN_USER_ID,
      );

      await expect(service.getPrintableHtml(invoice.id, OTHER_TENANT_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});

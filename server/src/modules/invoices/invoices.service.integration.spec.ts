import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { Repository, DataSource } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { InvoicesService } from './invoices.service';
import { Invoice } from './entities/invoice.entity';
import { StudentFee } from '../fees/entities/student-fee.entity';
import { FeeStructure } from '../fees/entities/fee-structure.entity';
import { Payment } from '../fees/entities/payment.entity';
import { PaymentAllocation } from '../fees/entities/payment-allocation.entity';
import { Student } from '../students/entities/student.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { School } from '../schools/entities/school.entity';
import { User } from '../users/entities/user.entity';
import { StorageModule } from '../storage/storage.module';
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
import {
  FeeStatus,
  FeeType,
  InvoiceStatus,
  InvoiceKind,
  PaymentMethod,
  PaymentStatus,
  PaymentAllocationType,
} from '@biddaloy/shared';

/**
 * Integration tests for InvoicesService [16.5.1] — an invoice is always
 * built from an already-recorded payment's committed allocations, never
 * from a free-form DTO. Covers snapshot construction (single- and
 * multi-student), sequential numbering, the frozen issuer snapshot,
 * DB-level immutability once issued, `createCreditNote`, listing/finding,
 * and printable HTML.
 */

const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000000099';

let studentSeq = 0;
// Set by the per-test `beforeEach` — every `makeFee` bill (16.1.3 made
// `fee_structure_id` NOT NULL) is charged against this one fixture.
let feeStructureId: string;

async function seedReferenceData(ds: DataSource): Promise<void> {
  await ds.query('DELETE FROM payment_allocations');
  await ds.query('DELETE FROM invoices');
  await ds.query('DELETE FROM payments');
  await ds.query('DELETE FROM student_fees');
  await ds.query('DELETE FROM student_guardians');
  await ds.query('DELETE FROM students');
  await ds.query('DELETE FROM fee_structures');
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
  let paymentRepo: Repository<Payment>;
  let allocationRepo: Repository<PaymentAllocation>;
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

  function makeFee(
    studentId: string,
    overrides: Partial<StudentFee> & { month?: number; year?: number } = {},
  ) {
    // `month`/`year` are stored generated columns derived from
    // `period_start` (16.1.3, D2) — TypeORM rejects a direct write to
    // them, so a caller-supplied month/year picks the period instead.
    const { month, year, ...rest } = overrides;
    return studentFeeRepo.create({
      student_id: studentId,
      academic_year_id: SEED_ACADEMIC_YEAR_ID,
      fee_structure_id: feeStructureId,
      period_start: new Date(Date.UTC(year ?? 2026, (month ?? 3) - 1, 1)),
      total_amount: 1000,
      paid_amount: 0,
      discount_amount: 0,
      status: FeeStatus.PENDING,
      ...rest,
    });
  }

  /** Records a payment fully allocated against one or more already-saved
   * fees (in `[fee, amount]` pairs), and marks each fee PAID — mirroring
   * what `CheckoutService`/`PaymentAllocationService` do before either
   * ever calls `InvoicesService.create`. */
  async function makePayment(
    primaryStudentId: string,
    allocations: Array<[StudentFee, number]>,
    overrides: Partial<Payment> = {},
  ): Promise<Payment> {
    const totalAmount = allocations.reduce((sum, [, amount]) => sum + amount, 0);
    const payment = await paymentRepo.save(
      paymentRepo.create({
        student_id: primaryStudentId,
        total_amount: totalAmount,
        payment_method: PaymentMethod.CASH,
        payment_status: PaymentStatus.SUCCESS,
        received_by_user_id: SEED_ADMIN_USER_ID,
        payment_date: new Date(),
        tenant_id: TENANT_ID,
        ...overrides,
      }),
    );
    await allocationRepo.save(
      allocations.map(([fee, amount]) =>
        allocationRepo.create({
          payment_id: payment.id,
          student_fee_id: fee.id,
          allocated_amount: amount,
          allocation_type: PaymentAllocationType.CURRENT,
        }),
      ),
    );
    for (const [fee, amount] of allocations) {
      await studentFeeRepo.update(fee.id, {
        paid_amount: Number(fee.paid_amount) + amount,
        status: FeeStatus.PAID,
      });
    }
    return payment;
  }

  function createInvoice(paymentId: string): Promise<Invoice> {
    return dataSource.manager.transaction((manager) => service.create(paymentId, manager));
  }

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [InvoicesService], [StorageModule], {
      synchronize: true,
      dropSchema: true,
    });

    service = module.get<InvoicesService>(InvoicesService);
    studentRepo = module.get<Repository<Student>>(getRepositoryToken(Student));
    studentFeeRepo = module.get<Repository<StudentFee>>(getRepositoryToken(StudentFee));
    paymentRepo = module.get<Repository<Payment>>(getRepositoryToken(Payment));
    allocationRepo = module.get<Repository<PaymentAllocation>>(
      getRepositoryToken(PaymentAllocation),
    );
    invoiceRepo = module.get<Repository<Invoice>>(getRepositoryToken(Invoice));
    dataSource = module.get(DataSource);

    await seedReferenceData(dataSource);

    // This spec uses `{ synchronize: true, dropSchema: true }`, which
    // rebuilds the schema from entity metadata only — it never runs
    // migrations, so migration-only DB objects like the [D21] immutability
    // trigger (`server/src/migrations/1789800008000-InvoiceImmutableSnapshot.ts`)
    // don't exist here. Recreate it directly so the '[D21] immutability'
    // tests below exercise the real trigger, not just its absence.
    // See server/CLAUDE.md's "Integration Test Database" section.
    await dataSource.query(`
      CREATE OR REPLACE FUNCTION "public"."enforce_invoice_immutability"() RETURNS TRIGGER AS $$
      BEGIN
        IF OLD."status" <> 'DRAFT' AND (
          NEW."invoice_number" IS DISTINCT FROM OLD."invoice_number" OR
          NEW."kind" IS DISTINCT FROM OLD."kind" OR
          NEW."student_id" IS DISTINCT FROM OLD."student_id" OR
          NEW."payment_id" IS DISTINCT FROM OLD."payment_id" OR
          NEW."related_invoice_id" IS DISTINCT FROM OLD."related_invoice_id" OR
          NEW."total_amount" IS DISTINCT FROM OLD."total_amount" OR
          NEW."tax_amount" IS DISTINCT FROM OLD."tax_amount" OR
          NEW."discount_amount" IS DISTINCT FROM OLD."discount_amount" OR
          NEW."issued_date" IS DISTINCT FROM OLD."issued_date" OR
          NEW."due_date" IS DISTINCT FROM OLD."due_date" OR
          NEW."snapshot" IS DISTINCT FROM OLD."snapshot" OR
          NEW."issued_by_user_id" IS DISTINCT FROM OLD."issued_by_user_id" OR
          NEW."notes" IS DISTINCT FROM OLD."notes" OR
          NEW."issuer_snapshot" IS DISTINCT FROM OLD."issuer_snapshot" OR
          NEW."created_at" IS DISTINCT FROM OLD."created_at"
        ) THEN
          RAISE EXCEPTION 'invoices is immutable once issued: only status, updated_at, deleted_at may change (id=%)', OLD."id";
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await dataSource.query(
      `DROP TRIGGER IF EXISTS "trg_enforce_invoice_immutability" ON "invoices"`,
    );
    await dataSource.query(
      `CREATE TRIGGER "trg_enforce_invoice_immutability" BEFORE UPDATE ON "invoices" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_invoice_immutability"()`,
    );
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
      // `fee_structures` is one of the globally-truncated transactional
      // tables (`test/setup.ts`'s per-test `beforeEach`, which runs before
      // this file's own) — re-seed it every test rather than once in
      // `beforeAll`, same fix as `fees.tabs.integration.spec.ts` (16.1.3).
      const feeStructureRepo = dataSource.getRepository(FeeStructure);
      const feeStructure = await feeStructureRepo.save(
        feeStructureRepo.create({
          name: 'Tuition',
          fee_type: FeeType.MONTHLY_TUITION,
          amount: '1000.00',
          class_id: SEED_CLASS_1_ID,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          tenant_id: TENANT_ID,
        }),
      );
      feeStructureId = feeStructure.id;
    }
  });

  describe('create', () => {
    it('builds a single-student snapshot from the payment’s allocations', async () => {
      const student = await studentRepo.save(makeStudent());
      const fee = await studentFeeRepo.save(
        makeFee(student.id, { total_amount: 1500, month: 4, year: 2026 }),
      );
      const payment = await makePayment(student.id, [[fee, 1500]]);

      const invoice = await createInvoice(payment.id);

      // Invoice numbers must follow the sequential INV-YYYY-XXXXX format.
      expect(invoice.invoice_number).toMatch(/^INV-\d{4}-\d{5}$/);
      expect(invoice.kind).toBe(InvoiceKind.INVOICE);
      expect(invoice.payment_id).toBe(payment.id);
      expect(Number(invoice.total_amount)).toBe(1500);
      expect(invoice.status).toBe(InvoiceStatus.ISSUED);
      expect(invoice.snapshot.students).toHaveLength(1);
      expect(invoice.snapshot.students[0].id).toBe(student.id);
      expect(invoice.snapshot.students[0].lines).toHaveLength(1);
      expect(invoice.snapshot.students[0].lines[0].period_label).toBe('April 2026');
      expect(invoice.snapshot.students[0].lines[0].paid_this_time).toBe(1500);
      expect(invoice.snapshot.totals.paid).toBe(1500);
    });

    it('groups lines by student for a multi-student (sibling) payment', async () => {
      const sibling1 = await studentRepo.save(makeStudent({ full_name: 'Sibling One' }));
      const sibling2 = await studentRepo.save(makeStudent({ full_name: 'Sibling Two' }));
      const fee1 = await studentFeeRepo.save(makeFee(sibling1.id, { total_amount: 600 }));
      const fee2 = await studentFeeRepo.save(makeFee(sibling2.id, { total_amount: 400 }));
      const payment = await makePayment(sibling1.id, [
        [fee1, 600],
        [fee2, 400],
      ]);

      const invoice = await createInvoice(payment.id);

      expect(invoice.snapshot.students).toHaveLength(2);
      const byId = new Map(invoice.snapshot.students.map((s) => [s.id, s]));
      expect(byId.get(sibling1.id)?.lines[0].paid_this_time).toBe(600);
      expect(byId.get(sibling2.id)?.lines[0].paid_this_time).toBe(400);
      expect(invoice.snapshot.totals.paid).toBe(1000);
      // `student_id` on the row stays the payment's primary student.
      expect(invoice.student_id).toBe(sibling1.id);
    });

    it('assigns sequential invoice numbers across separate creates', async () => {
      const student1 = await studentRepo.save(makeStudent());
      const student2 = await studentRepo.save(makeStudent());
      const fee1 = await studentFeeRepo.save(makeFee(student1.id));
      const fee2 = await studentFeeRepo.save(makeFee(student2.id));
      const payment1 = await makePayment(student1.id, [[fee1, 1000]]);
      const payment2 = await makePayment(student2.id, [[fee2, 1000]]);

      const inv1 = await createInvoice(payment1.id);
      const inv2 = await createInvoice(payment2.id);

      const seq1 = parseInt(inv1.invoice_number.split('-')[2], 10);
      const seq2 = parseInt(inv2.invoice_number.split('-')[2], 10);
      expect(seq2).toBe(seq1 + 1);
    });

    it('assigns distinct invoice numbers under concurrent creates', async () => {
      const studentA = await studentRepo.save(makeStudent());
      const studentB = await studentRepo.save(makeStudent());
      const feeA = await studentFeeRepo.save(makeFee(studentA.id));
      const feeB = await studentFeeRepo.save(makeFee(studentB.id));
      const paymentA = await makePayment(studentA.id, [[feeA, 1000]]);
      const paymentB = await makePayment(studentB.id, [[feeB, 1000]]);

      const [invA, invB] = await Promise.all([
        createInvoice(paymentA.id),
        createInvoice(paymentB.id),
      ]);

      expect(invA.invoice_number).not.toBe(invB.invoice_number);
    });

    it('throws BadRequestException for a payment with no allocations', async () => {
      const student = await studentRepo.save(makeStudent());
      const payment = await paymentRepo.save(
        paymentRepo.create({
          student_id: student.id,
          total_amount: 100,
          payment_method: PaymentMethod.CASH,
          payment_status: PaymentStatus.SUCCESS,
          payment_date: new Date(),
          tenant_id: TENANT_ID,
        }),
      );

      await expect(createInvoice(payment.id)).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException for an unknown payment id', async () => {
      await expect(createInvoice('00000000-0000-4000-8000-000000000001')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('createCreditNote', () => {
    it('mints an ISSUED credit note with negated amounts, linked back to the original invoice (now CANCELLED), in its own CN series', async () => {
      const student = await studentRepo.save(makeStudent());
      const fee = await studentFeeRepo.save(makeFee(student.id, { total_amount: 1000 }));
      const payment = await makePayment(student.id, [[fee, 1000]]);
      const invoice = await createInvoice(payment.id);

      const creditNote = await dataSource.manager.transaction((manager) =>
        service.createCreditNote(payment.id, 'Refund requested', manager),
      );

      expect(creditNote.invoice_number).toMatch(/^CN-\d{4}-\d{6}$/);
      expect(creditNote.kind).toBe(InvoiceKind.CREDIT_NOTE);
      expect(creditNote.related_invoice_id).toBe(invoice.id);
      // credit note nets the original invoice to zero
      expect(Number(creditNote.total_amount)).toBeCloseTo(-Number(invoice.total_amount));
      expect(Number(creditNote.tax_amount)).toBeCloseTo(-Number(invoice.tax_amount));
      expect(Number(creditNote.discount_amount)).toBeCloseTo(-Number(invoice.discount_amount));
      // the credit note itself is a real, final document — not cancelled
      expect(creditNote.status).toBe(InvoiceStatus.ISSUED);
      expect(creditNote.notes).toBe('Refund requested');

      // CANCELLED is written on the ORIGINAL invoice, not the credit note
      const reloadedOriginal = await invoiceRepo.findOneByOrFail({ id: invoice.id });
      expect(reloadedOriginal.status).toBe(InvoiceStatus.CANCELLED);
    });

    it('throws NotFoundException when the payment has no invoice to reverse', async () => {
      const student = await studentRepo.save(makeStudent());
      const payment = await paymentRepo.save(
        paymentRepo.create({
          student_id: student.id,
          total_amount: 100,
          payment_method: PaymentMethod.CASH,
          payment_status: PaymentStatus.SUCCESS,
          payment_date: new Date(),
          tenant_id: TENANT_ID,
        }),
      );

      await expect(
        dataSource.manager.transaction((manager) =>
          service.createCreditNote(payment.id, 'no invoice', manager),
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('[D21] immutability', () => {
    it('rejects a direct UPDATE that changes a frozen column once issued', async () => {
      const student = await studentRepo.save(makeStudent());
      const fee = await studentFeeRepo.save(makeFee(student.id));
      const payment = await makePayment(student.id, [[fee, 1000]]);
      const invoice = await createInvoice(payment.id);

      await expect(
        dataSource.query('UPDATE invoices SET total_amount = $1 WHERE id = $2', [9999, invoice.id]),
      ).rejects.toThrow(/immutable/i);
    });

    it('still allows status/updated_at/deleted_at to change', async () => {
      const student = await studentRepo.save(makeStudent());
      const fee = await studentFeeRepo.save(makeFee(student.id));
      const payment = await makePayment(student.id, [[fee, 1000]]);
      const invoice = await createInvoice(payment.id);

      await expect(
        dataSource.query('UPDATE invoices SET status = $1 WHERE id = $2', [
          InvoiceStatus.PAID,
          invoice.id,
        ]),
      ).resolves.toBeDefined();
      const reloaded = await invoiceRepo.findOneOrFail({ where: { id: invoice.id } });
      expect(reloaded.status).toBe(InvoiceStatus.PAID);
    });
  });

  describe('[15.5.5] issuer snapshot', () => {
    it('freezes the school profile at issue time, unaffected by a later edit', async () => {
      const schoolRepo = dataSource.getRepository(School);
      await schoolRepo.update(TENANT_ID, { name: 'Name At Issue Time' });

      const student = await studentRepo.save(makeStudent());
      const fee = await studentFeeRepo.save(makeFee(student.id));
      const payment = await makePayment(student.id, [[fee, 1000]]);
      const created = await createInvoice(payment.id);
      expect(created.issuer_snapshot?.name).toBe('Name At Issue Time');
      expect(created.snapshot.issuer.name).toBe('Name At Issue Time');

      // Edit the profile after the invoice was issued.
      await schoolRepo.update(TENANT_ID, { name: 'Name After Edit' });

      const reFound = await service.findOne(created.id, TENANT_ID);
      expect(reFound.issuer.name).toBe('Name At Issue Time');

      await schoolRepo.update(TENANT_ID, { name: 'Test School' });
    });

    it('falls back to the live profile for a pre-existing row with a null snapshot', async () => {
      const schoolRepo = dataSource.getRepository(School);
      const student = await studentRepo.save(makeStudent());
      const fee = await studentFeeRepo.save(makeFee(student.id));
      const payment = await makePayment(student.id, [[fee, 1000]]);
      const created = await createInvoice(payment.id);

      // Simulate a legacy row created before `issuer_snapshot` existed.
      // The [D21] trigger (migration 1789800008000) freezes
      // `issuer_snapshot` too once a row leaves DRAFT, same as every
      // other column — so a *real* post-issue UPDATE can't produce this
      // state. Bypass the trigger for this one session-local statement
      // (`session_replication_role = 'replica'`, same trick Postgres
      // itself uses for logical-replication apply) purely to fabricate
      // the legacy fixture; it is not something application code does.
      await dataSource.query("SET session_replication_role = 'replica'");
      try {
        await dataSource.query('UPDATE invoices SET issuer_snapshot = NULL WHERE id = $1', [
          created.id,
        ]);
      } finally {
        await dataSource.query("SET session_replication_role = 'origin'");
      }
      await schoolRepo.update(TENANT_ID, { name: 'Legacy Fallback Name' });

      const found = await service.findOne(created.id, TENANT_ID);
      expect(found.issuer.name).toBe('Legacy Fallback Name');

      await schoolRepo.update(TENANT_ID, { name: 'Test School' });
    });
  });

  describe('findOne', () => {
    it('returns the invoice for the owning tenant', async () => {
      const student = await studentRepo.save(makeStudent());
      const fee = await studentFeeRepo.save(makeFee(student.id));
      const payment = await makePayment(student.id, [[fee, 1000]]);
      const created = await createInvoice(payment.id);

      const found = await service.findOne(created.id, TENANT_ID);
      expect(found.id).toBe(created.id);
      expect(found.student.full_name).toBe(student.full_name);
    });

    it('throws NotFoundException for a different tenant', async () => {
      const student = await studentRepo.save(makeStudent());
      const fee = await studentFeeRepo.save(makeFee(student.id));
      const payment = await makePayment(student.id, [[fee, 1000]]);
      const created = await createInvoice(payment.id);

      await expect(service.findOne(created.id, OTHER_TENANT_ID)).rejects.toThrow(NotFoundException);
    });

    it('excludes a soft-deleted invoice', async () => {
      const student = await studentRepo.save(makeStudent());
      const fee = await studentFeeRepo.save(makeFee(student.id));
      const payment = await makePayment(student.id, [[fee, 1000]]);
      const created = await createInvoice(payment.id);

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
      await createInvoice((await makePayment(student1.id, [[fee1, 1000]])).id);
      await createInvoice((await makePayment(student2.id, [[fee2, 1000]])).id);

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

    /**
     * [5.1] — `restrictToStudentIds` is how a PARENT/STUDENT caller reaches
     * this list. `InvoicesController` fills it from `FamilyAccessService`;
     * `query.student_id` stays caller-controlled and must only intersect
     * with it.
     */
    it('narrows the result to restrictToStudentIds', async () => {
      const mine = await studentRepo.save(makeStudent());
      const theirs = await studentRepo.save(makeStudent());
      const feeMine = await studentFeeRepo.save(makeFee(mine.id));
      const feeTheirs = await studentFeeRepo.save(makeFee(theirs.id));
      await createInvoice((await makePayment(mine.id, [[feeMine, 1000]])).id);
      await createInvoice((await makePayment(theirs.id, [[feeTheirs, 1000]])).id);

      const result = await service.findAll({ page: 1, limit: 10 }, TENANT_ID, [mine.id]);

      expect(result.total).toBe(1);
      expect(result.data[0].student_id).toBe(mine.id);
    });

    // The URL-manipulation case at the service layer: asking for someone
    // else's invoices while restricted to your own yields nothing, rather
    // than the caller's filter winning.
    it('returns an empty page when student_id names a student outside the restriction', async () => {
      const mine = await studentRepo.save(makeStudent());
      const theirs = await studentRepo.save(makeStudent());
      const feeTheirs = await studentFeeRepo.save(makeFee(theirs.id));
      await createInvoice((await makePayment(theirs.id, [[feeTheirs, 1000]])).id);

      const result = await service.findAll(
        { student_id: theirs.id, page: 1, limit: 10 },
        TENANT_ID,
        [mine.id],
      );

      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });

    // `[]` ("linked to nobody") must not collapse into `undefined`
    // ("no restriction"), or a childless parent would see the tenant.
    it('returns an empty page for an empty restriction, not the whole tenant', async () => {
      const student = await studentRepo.save(makeStudent());
      const fee = await studentFeeRepo.save(makeFee(student.id));
      await createInvoice((await makePayment(student.id, [[fee, 1000]])).id);

      const restricted = await service.findAll({ page: 1, limit: 10 }, TENANT_ID, []);
      const unrestricted = await service.findAll({ page: 1, limit: 10 }, TENANT_ID);

      expect(restricted.total).toBe(0);
      expect(restricted.data).toEqual([]);
      expect(unrestricted.total).toBe(1);
    });

    it('still enforces the tenant filter on top of the restriction', async () => {
      const student = await studentRepo.save(makeStudent());
      const fee = await studentFeeRepo.save(makeFee(student.id));
      await createInvoice((await makePayment(student.id, [[fee, 1000]])).id);

      const result = await service.findAll({ page: 1, limit: 10 }, OTHER_TENANT_ID, [student.id]);

      expect(result.total).toBe(0);
    });

    it('does not return invoices belonging to another tenant', async () => {
      const student = await studentRepo.save(makeStudent());
      const fee = await studentFeeRepo.save(makeFee(student.id));
      await createInvoice((await makePayment(student.id, [[fee, 1000]])).id);

      const result = await service.findAll({ page: 1, limit: 10 }, OTHER_TENANT_ID);
      expect(result.total).toBe(0);
    });

    it('searches by invoice number or student name', async () => {
      const student = await studentRepo.save(makeStudent({ full_name: 'Ahmed Khan' }));
      const fee = await studentFeeRepo.save(makeFee(student.id));
      const payment = await makePayment(student.id, [[fee, 1000]]);
      const invoice = await createInvoice(payment.id);

      const byNumber = await service.findAll(
        { search: invoice.invoice_number, page: 1, limit: 10 },
        TENANT_ID,
      );
      expect(byNumber.total).toBe(1);
      expect(byNumber.data[0].id).toBe(invoice.id);

      const byName = await service.findAll({ search: 'Ahmed', page: 1, limit: 10 }, TENANT_ID);
      expect(byName.total).toBe(1);

      const noMatch = await service.findAll({ search: 'Nobody', page: 1, limit: 10 }, TENANT_ID);
      expect(noMatch.total).toBe(0);
    });

    it("does not return another tenant's invoice when searching by invoice number or student name", async () => {
      const student = await studentRepo.save(makeStudent({ full_name: 'Ahmed Khan' }));
      const fee = await studentFeeRepo.save(makeFee(student.id));
      const payment = await makePayment(student.id, [[fee, 1000]]);
      const invoice = await createInvoice(payment.id);

      const byNumber = await service.findAll(
        { search: invoice.invoice_number, page: 1, limit: 10 },
        OTHER_TENANT_ID,
      );
      expect(byNumber.total).toBe(0);

      const byName = await service.findAll(
        { search: 'Ahmed', page: 1, limit: 10 },
        OTHER_TENANT_ID,
      );
      expect(byName.total).toBe(0);
    });

    it('does not return a soft-deleted invoice when searching by invoice number or student name', async () => {
      const student = await studentRepo.save(makeStudent({ full_name: 'Ahmed Khan' }));
      const fee = await studentFeeRepo.save(makeFee(student.id));
      const payment = await makePayment(student.id, [[fee, 1000]]);
      const invoice = await createInvoice(payment.id);
      await invoiceRepo.softDelete(invoice.id);

      const byNumber = await service.findAll(
        { search: invoice.invoice_number, page: 1, limit: 10 },
        TENANT_ID,
      );
      expect(byNumber.total).toBe(0);

      const byName = await service.findAll({ search: 'Ahmed', page: 1, limit: 10 }, TENANT_ID);
      expect(byName.total).toBe(0);
    });

    it('filters by min_amount and max_amount', async () => {
      const student1 = await studentRepo.save(makeStudent());
      const student2 = await studentRepo.save(makeStudent());
      const fee1 = await studentFeeRepo.save(makeFee(student1.id, { total_amount: 500 }));
      const fee2 = await studentFeeRepo.save(makeFee(student2.id, { total_amount: 1500 }));
      await createInvoice((await makePayment(student1.id, [[fee1, 500]])).id);
      await createInvoice((await makePayment(student2.id, [[fee2, 1500]])).id);

      const result = await service.findAll(
        { min_amount: 1000, max_amount: 2000, page: 1, limit: 10 },
        TENANT_ID,
      );

      expect(result.total).toBe(1);
      expect(Number(result.data[0].total_amount)).toBe(1500);
    });

    it('sorts by total_amount ascending', async () => {
      const student1 = await studentRepo.save(makeStudent());
      const student2 = await studentRepo.save(makeStudent());
      const fee1 = await studentFeeRepo.save(makeFee(student1.id, { total_amount: 1500 }));
      const fee2 = await studentFeeRepo.save(makeFee(student2.id, { total_amount: 500 }));
      await createInvoice((await makePayment(student1.id, [[fee1, 1500]])).id);
      await createInvoice((await makePayment(student2.id, [[fee2, 500]])).id);

      const result = await service.findAll(
        { sort: 'total_amount', order: 'asc', page: 1, limit: 10 },
        TENANT_ID,
      );

      expect(result.data.map((inv) => Number(inv.total_amount))).toEqual([500, 1500]);
    });

    // Cross-tenant: the amount range filter must not become a way to read
    // another tenant's invoice totals.
    it('does not return another tenant’s invoice when filtering by amount range', async () => {
      const student = await studentRepo.save(makeStudent());
      const fee = await studentFeeRepo.save(makeFee(student.id, { total_amount: 1500 }));
      await createInvoice((await makePayment(student.id, [[fee, 1500]])).id);

      const result = await service.findAll(
        { min_amount: 1000, max_amount: 2000, page: 1, limit: 10 },
        OTHER_TENANT_ID,
      );

      expect(result.total).toBe(0);
    });

    it('excludes soft-deleted invoices', async () => {
      const student = await studentRepo.save(makeStudent());
      const fee = await studentFeeRepo.save(makeFee(student.id));
      const created = await createInvoice((await makePayment(student.id, [[fee, 1000]])).id);

      await invoiceRepo.softDelete(created.id);

      const result = await service.findAll({ page: 1, limit: 10 }, TENANT_ID);
      expect(result.data.find((inv) => inv.id === created.id)).toBeUndefined();
    });
  });

  describe('getPrintableHtml', () => {
    it('renders an HTML document containing the invoice number, student name, and line items', async () => {
      const student = await studentRepo.save(makeStudent({ full_name: 'Printable Student' }));
      const fee = await studentFeeRepo.save(makeFee(student.id, { total_amount: 750 }));
      const payment = await makePayment(student.id, [[fee, 750]]);
      const invoice = await createInvoice(payment.id);

      const html = await service.getPrintableHtml(invoice.id, TENANT_ID);

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain(invoice.invoice_number);
      expect(html).toContain('Printable Student');
      expect(html).toContain('750.00');
    });

    it('[15.5.7] renders the frozen issuer name/address/EIIN, not a later profile edit', async () => {
      const schoolRepo = dataSource.getRepository(School);
      await schoolRepo.update(TENANT_ID, {
        name: 'Printed School Name',
        address: 'Printed Address',
        registration_id: 'EIIN-777',
      });

      const student = await studentRepo.save(makeStudent());
      const fee = await studentFeeRepo.save(makeFee(student.id));
      const payment = await makePayment(student.id, [[fee, 1000]]);
      const invoice = await createInvoice(payment.id);

      await schoolRepo.update(TENANT_ID, { name: 'Renamed After Issue' });

      const html = await service.getPrintableHtml(invoice.id, TENANT_ID);

      expect(html).toContain('Printed School Name');
      expect(html).toContain('Printed Address');
      expect(html).toContain('EIIN: EIIN-777');
      expect(html).not.toContain('Renamed After Issue');

      await schoolRepo.update(TENANT_ID, {
        name: 'Test School',
        address: null,
        registration_id: null,
      });
    });

    it('throws NotFoundException for a different tenant', async () => {
      const student = await studentRepo.save(makeStudent());
      const fee = await studentFeeRepo.save(makeFee(student.id));
      const payment = await makePayment(student.id, [[fee, 1000]]);
      const invoice = await createInvoice(payment.id);

      await expect(service.getPrintableHtml(invoice.id, OTHER_TENANT_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});

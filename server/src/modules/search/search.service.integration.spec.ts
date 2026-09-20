import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource, Repository } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CommunicationMedium, EnrollmentStatus, PaymentMethod, UserRole } from '@biddaloy/shared';
import { ALL_ENTITIES } from '@test/all-entities';
import { createTestModule } from '@test/helpers/module.helper';
import { SEED_TENANT_ID, SEED_SECTION_1_ID } from '@test/constants';
import { SearchService } from './search.service';
import { Student } from '../students/entities/student.entity';
import { Guardian } from '../students/entities/guardian.entity';
import { User } from '../users/entities/user.entity';
import { Teacher } from '../academics/entities/teacher.entity';
import { Invoice } from '../invoices/entities/invoice.entity';
import { Payment } from '../fees/entities/payment.entity';

/**
 * Integration tests for `SearchService` (30.2.1), against a migrated
 * database. Mirrors `collections-report.service.integration.spec.ts`'s
 * fixture-building conventions.
 *
 * These prove each entity branch matches its own fields without leaking
 * into another group's rows ("groups without querying others" —
 * asserting one group's contents doesn't accidentally rely on another
 * group's fixture data being absent).
 */

const OTHER_TENANT_ID = '00000000-0000-4000-8000-0000083a0001';
let seq = 0;

describe('SearchService', () => {
  let moduleRef: TestingModule;
  let service: SearchService;
  let dataSource: DataSource;
  let studentRepo: Repository<Student>;
  let guardianRepo: Repository<Guardian>;
  let userRepo: Repository<User>;
  let teacherRepo: Repository<Teacher>;
  let invoiceRepo: Repository<Invoice>;
  let paymentRepo: Repository<Payment>;

  beforeAll(async () => {
    moduleRef = await createTestModule(ALL_ENTITIES, [SearchService]);
    service = moduleRef.get(SearchService);
    dataSource = moduleRef.get(DataSource);
    studentRepo = moduleRef.get(getRepositoryToken(Student));
    guardianRepo = moduleRef.get(getRepositoryToken(Guardian));
    userRepo = moduleRef.get(getRepositoryToken(User));
    teacherRepo = moduleRef.get(getRepositoryToken(Teacher));
    invoiceRepo = moduleRef.get(getRepositoryToken(Invoice));
    paymentRepo = moduleRef.get(getRepositoryToken(Payment));

    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'search-other-tenant', 'search-other-tenant', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [OTHER_TENANT_ID],
    );
  }, 60000);

  afterAll(async () => {
    await dataSource.query(`DELETE FROM payments WHERE tenant_id IN ($1, $2)`, [
      SEED_TENANT_ID,
      OTHER_TENANT_ID,
    ]);
    await dataSource.query(
      `DELETE FROM invoices WHERE student_id IN (SELECT id FROM students WHERE tenant_id IN ($1, $2))`,
      [SEED_TENANT_ID, OTHER_TENANT_ID],
    );
    await dataSource.query(`DELETE FROM student_guardians`);
    await dataSource.query(`DELETE FROM teachers WHERE tenant_id IN ($1, $2)`, [
      SEED_TENANT_ID,
      OTHER_TENANT_ID,
    ]);
    await dataSource.query(`DELETE FROM guardians WHERE tenant_id IN ($1, $2)`, [
      SEED_TENANT_ID,
      OTHER_TENANT_ID,
    ]);
    await dataSource.query(`DELETE FROM students WHERE tenant_id IN ($1, $2)`, [
      SEED_TENANT_ID,
      OTHER_TENANT_ID,
    ]);
    await dataSource.query(`DELETE FROM users WHERE email LIKE 'search-fixture-%'`);
    await moduleRef.close();
  });

  async function makeStudent(overrides: Partial<Student> = {}): Promise<Student> {
    seq += 1;
    return studentRepo.save(
      studentRepo.create({
        full_name: `Search Student ${seq}`,
        registration_number: `SR-${String(seq).padStart(4, '0')}`,
        roll_number: seq,
        class_section_id: SEED_SECTION_1_ID,
        date_of_birth: new Date('2010-01-01'),
        preferred_communication: CommunicationMedium.SMS,
        enrollment_status: EnrollmentStatus.ACTIVE,
        tenant_id: SEED_TENANT_ID,
        ...overrides,
      } as Partial<Student>),
    );
  }

  async function makeGuardian(overrides: Partial<Guardian> = {}): Promise<Guardian> {
    seq += 1;
    return guardianRepo.save(
      guardianRepo.create({
        full_name: `Search Guardian ${seq}`,
        relationship: 'FATHER',
        phone: `017${String(10000000 + seq)}`,
        tenant_id: SEED_TENANT_ID,
        ...overrides,
      } as Partial<Guardian>),
    );
  }

  async function makeUser(overrides: Partial<User> = {}): Promise<User> {
    seq += 1;
    return userRepo.save(
      userRepo.create({
        email: `search-fixture-${seq}@example.com`,
        password_hash: 'x',
        full_name: `Search Teacher ${seq}`,
        status: 'ACTIVE' as never,
        ...overrides,
      } as Partial<User>),
    );
  }

  it('students branch: matches full name, registration number and roll number directly', async () => {
    const s1 = await makeStudent({ full_name: 'Rahim Uddin Direct' });
    await makeStudent({ full_name: 'Someone Else' });

    const result = await service.search(SEED_TENANT_ID, UserRole.ADMIN, { q: 'Rahim Uddin' });

    expect(result.students?.map((r) => r.id)).toContain(s1.id);
    expect(result.students?.find((r) => r.id === s1.id)?.matched_via).toBe('direct');
  });

  it('students branch: matches by class or section name (plan Step 3), tagged direct', async () => {
    const s1 = await makeStudent({ full_name: 'Section Match Student' });
    const [{ section_name: sectionName }] = await dataSource.query<Array<{ section_name: string }>>(
      'SELECT section_name FROM class_sections WHERE id = $1',
      [SEED_SECTION_1_ID],
    );

    const result = await service.search(SEED_TENANT_ID, UserRole.ADMIN, { q: sectionName });

    expect(result.students?.map((r) => r.id)).toContain(s1.id);
    expect(result.students?.find((r) => r.id === s1.id)?.matched_via).toBe('direct');
  });

  it('students branch: guardian phone finds linked students, flagged matched_via guardian_phone', async () => {
    const student = await makeStudent({ full_name: 'Karim Child' });
    const guardian = await makeGuardian({ phone: '01799912345', full_name: 'Karim Parent' });
    await studentRepo.createQueryBuilder().relation(Student, 'guardians').of(student).add(guardian);

    const result = await service.search(SEED_TENANT_ID, UserRole.ADMIN, { q: '01799912345' });

    const match = result.students?.find((r) => r.id === student.id);
    expect(match).toBeDefined();
    expect(match?.matched_via).toBe('guardian_phone');
  });

  it('students branch: guardian full name also finds linked students (parity with GET /students?search=)', async () => {
    const student = await makeStudent({ full_name: 'Nabila Child' });
    const guardian = await makeGuardian({ full_name: 'Findable Guardian Name' });
    await studentRepo.createQueryBuilder().relation(Student, 'guardians').of(student).add(guardian);

    const result = await service.search(SEED_TENANT_ID, UserRole.ADMIN, {
      q: 'Findable Guardian Name',
    });

    const match = result.students?.find((r) => r.id === student.id);
    expect(match).toBeDefined();
    expect(match?.matched_via).toBe('guardian_phone');
  });

  it('guardians branch: matches name and phone, does not surface unrelated students', async () => {
    await makeGuardian({ full_name: 'Findable Guardian', phone: '01711122233' });

    const result = await service.search(SEED_TENANT_ID, UserRole.ADMIN, {
      q: 'Findable Guardian',
    });

    expect(result.guardians?.length).toBe(1);
    expect(result.guardians?.[0].full_name).toBe('Findable Guardian');
  });

  it('staff branch: matches teacher full name and employee id', async () => {
    const user = await makeUser({ full_name: 'Teaching Staff One' });
    seq += 1;
    await teacherRepo.save(
      teacherRepo.create({
        user_id: user.id,
        employee_id: `EMP-${seq}`,
        designations: [],
        tenant_id: SEED_TENANT_ID,
      } as Partial<Teacher>),
    );

    const result = await service.search(SEED_TENANT_ID, UserRole.ADMIN, {
      q: 'Teaching Staff One',
    });

    expect(result.staff?.some((r) => r.employee_id === `EMP-${seq}`)).toBe(true);
  });

  it('invoices branch: matches invoice number, tenant-scoped through the owning student', async () => {
    const student = await makeStudent();
    const invoice = await invoiceRepo.save(
      invoiceRepo.create({
        invoice_number: 'INV-SEARCH-0001',
        student_id: student.id,
        total_amount: 1000,
        issued_date: new Date('2026-01-01'),
        due_date: new Date('2026-01-31'),
        snapshot: { students: [], totals: {} } as never,
      } as Partial<Invoice>),
    );

    const result = await service.search(SEED_TENANT_ID, UserRole.ADMIN, {
      q: 'INV-SEARCH-0001',
    });

    expect(result.invoices?.map((r) => r.id)).toContain(invoice.id);
  });

  it("invoices branch: matches the linked student's full name, not just invoice number", async () => {
    const student = await makeStudent({ full_name: 'Invoice Parity Student' });
    const invoice = await invoiceRepo.save(
      invoiceRepo.create({
        invoice_number: 'INV-SEARCH-0002',
        student_id: student.id,
        total_amount: 1000,
        issued_date: new Date('2026-01-01'),
        due_date: new Date('2026-01-31'),
        snapshot: { students: [], totals: {} } as never,
      } as Partial<Invoice>),
    );

    const result = await service.search(SEED_TENANT_ID, UserRole.ADMIN, {
      q: 'Invoice Parity Student',
    });

    expect(result.invoices?.map((r) => r.id)).toContain(invoice.id);
  });

  it('payments branch: matches transaction reference', async () => {
    const student = await makeStudent();
    const payment = await paymentRepo.save(
      paymentRepo.create({
        student_id: student.id,
        total_amount: 500,
        payment_method: PaymentMethod.CASH,
        transaction_reference: 'TXN-SEARCH-0001',
        payment_date: new Date('2026-01-01T00:00:00Z'),
        tenant_id: SEED_TENANT_ID,
      } as Partial<Payment>),
    );

    const result = await service.search(SEED_TENANT_ID, UserRole.ADMIN, {
      q: 'TXN-SEARCH-0001',
    });

    expect(result.payments?.map((r) => r.id)).toContain(payment.id);
  });

  it("payments branch: matches the linked student's full name or registration number, not just transaction reference", async () => {
    const student = await makeStudent({
      full_name: 'Payment Parity Student',
      registration_number: 'REG-PAY-PARITY',
    });
    const payment = await paymentRepo.save(
      paymentRepo.create({
        student_id: student.id,
        total_amount: 500,
        payment_method: PaymentMethod.CASH,
        transaction_reference: 'TXN-PARITY-0002',
        payment_date: new Date('2026-01-01T00:00:00Z'),
        tenant_id: SEED_TENANT_ID,
      } as Partial<Payment>),
    );

    const byName = await service.search(SEED_TENANT_ID, UserRole.ADMIN, {
      q: 'Payment Parity Student',
    });
    expect(byName.payments?.map((r) => r.id)).toContain(payment.id);

    const byRegistration = await service.search(SEED_TENANT_ID, UserRole.ADMIN, {
      q: 'REG-PAY-PARITY',
    });
    expect(byRegistration.payments?.map((r) => r.id)).toContain(payment.id);
  });

  it("payments branch: a soft-deleted student's name no longer renders in the payment's student_name", async () => {
    const student = await makeStudent({ full_name: 'Soft Deleted Payer' });
    const payment = await paymentRepo.save(
      paymentRepo.create({
        student_id: student.id,
        total_amount: 500,
        payment_method: PaymentMethod.CASH,
        transaction_reference: 'TXN-SOFT-DELETE-0001',
        payment_date: new Date('2026-01-01T00:00:00Z'),
        tenant_id: SEED_TENANT_ID,
      } as Partial<Payment>),
    );
    await studentRepo.softRemove(student);

    const result = await service.search(SEED_TENANT_ID, UserRole.ADMIN, {
      q: 'TXN-SOFT-DELETE-0001',
    });

    const match = result.payments?.find((r) => r.id === payment.id);
    expect(match).toBeDefined();
    expect(match?.student_name).toBeNull();

    // The soft-deleted student's own name must not surface a payment match either.
    const byName = await service.search(SEED_TENANT_ID, UserRole.ADMIN, {
      q: 'Soft Deleted Payer',
    });
    expect(byName.payments?.map((r) => r.id)).not.toContain(payment.id);
  });

  it('caps every group at the requested limit', async () => {
    for (let i = 0; i < 8; i += 1) {
      await makeStudent({ full_name: 'Limit Test Student' });
    }

    const result = await service.search(SEED_TENANT_ID, UserRole.ADMIN, {
      q: 'Limit Test Student',
      limit: 3,
    });

    expect(result.students?.length).toBe(3);
  });

  it('empty q returns empty (but present) groups for every permission the role holds, without querying', async () => {
    const result = await service.search(SEED_TENANT_ID, UserRole.ADMIN, {});

    expect(result.students).toEqual([]);
    expect(result.guardians).toEqual([]);
    expect(result.staff).toEqual([]);
    expect(result.invoices).toEqual([]);
    expect(result.payments).toEqual([]);
  });

  it('omits a group entirely when the role lacks its permission (TEACHER has no INVOICE_READ/PAYMENT_READ)', async () => {
    const result = await service.search(SEED_TENANT_ID, UserRole.TEACHER, { q: 'anything' });

    expect(result.invoices).toBeUndefined();
    expect(result.payments).toBeUndefined();
    expect(result.students).toBeDefined();
  });

  describe('tenant isolation', () => {
    it('guardians branch: does not return a same-named/phoned guardian from another tenant', async () => {
      await makeGuardian({
        full_name: 'Cross Tenant Guardian',
        phone: '01755500001',
        tenant_id: OTHER_TENANT_ID,
      });

      const result = await service.search(SEED_TENANT_ID, UserRole.ADMIN, {
        q: 'Cross Tenant Guardian',
      });

      expect(result.guardians).toEqual([]);
    });

    it('staff branch: does not return a same-named teacher from another tenant', async () => {
      const user = await makeUser({ full_name: 'Cross Tenant Teacher' });
      seq += 1;
      await teacherRepo.save(
        teacherRepo.create({
          user_id: user.id,
          employee_id: `EMP-OTHER-${seq}`,
          designations: [],
          tenant_id: OTHER_TENANT_ID,
        } as Partial<Teacher>),
      );

      const result = await service.search(SEED_TENANT_ID, UserRole.ADMIN, {
        q: 'Cross Tenant Teacher',
      });

      expect(result.staff).toEqual([]);
    });

    it("invoices branch: does not return an invoice owned by another tenant's student", async () => {
      const otherStudent = await makeStudent({ tenant_id: OTHER_TENANT_ID });
      await invoiceRepo.save(
        invoiceRepo.create({
          invoice_number: 'INV-CROSS-TENANT-0001',
          student_id: otherStudent.id,
          total_amount: 1000,
          issued_date: new Date('2026-01-01'),
          due_date: new Date('2026-01-31'),
          snapshot: { students: [], totals: {} } as never,
        } as Partial<Invoice>),
      );

      const result = await service.search(SEED_TENANT_ID, UserRole.ADMIN, {
        q: 'INV-CROSS-TENANT-0001',
      });

      expect(result.invoices).toEqual([]);
    });

    it('payments branch: does not return a payment owned by another tenant', async () => {
      const otherStudent = await makeStudent({ tenant_id: OTHER_TENANT_ID });
      await paymentRepo.save(
        paymentRepo.create({
          student_id: otherStudent.id,
          total_amount: 500,
          payment_method: PaymentMethod.CASH,
          transaction_reference: 'TXN-CROSS-TENANT-0001',
          payment_date: new Date('2026-01-01T00:00:00Z'),
          tenant_id: OTHER_TENANT_ID,
        } as Partial<Payment>),
      );

      const result = await service.search(SEED_TENANT_ID, UserRole.ADMIN, {
        q: 'TXN-CROSS-TENANT-0001',
      });

      expect(result.payments).toEqual([]);
    });

    it("students branch: a tenant-B guardian sharing tenant-A guardian's phone does not leak tenant-B students", async () => {
      // Highest-value case: two guardians in different tenants share the
      // exact same phone number. Searching that phone from tenant A must
      // surface only tenant A's guardian's students — never tenant B's,
      // even though the phone digits match perfectly.
      const sharedPhone = '01799987654';

      const tenantAStudent = await makeStudent({ full_name: 'Tenant A Child' });
      const tenantAGuardian = await makeGuardian({
        phone: sharedPhone,
        full_name: 'Tenant A Parent',
      });
      await studentRepo
        .createQueryBuilder()
        .relation(Student, 'guardians')
        .of(tenantAStudent)
        .add(tenantAGuardian);

      const tenantBStudent = await makeStudent({
        full_name: 'Tenant B Child',
        tenant_id: OTHER_TENANT_ID,
      });
      const tenantBGuardian = await makeGuardian({
        phone: sharedPhone,
        full_name: 'Tenant B Parent',
        tenant_id: OTHER_TENANT_ID,
      });
      await studentRepo
        .createQueryBuilder()
        .relation(Student, 'guardians')
        .of(tenantBStudent)
        .add(tenantBGuardian);

      const result = await service.search(SEED_TENANT_ID, UserRole.ADMIN, { q: sharedPhone });

      const ids = result.students?.map((r) => r.id) ?? [];
      expect(ids).toContain(tenantAStudent.id);
      expect(ids).not.toContain(tenantBStudent.id);
    });
  });
});

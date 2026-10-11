import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ApprovalScope, WalletTransactionKind } from '@biddaloy/shared';
import { ALL_ENTITIES } from '@test/all-entities';
import { createTestModule } from '@test/helpers/module.helper';
import { SEED_TENANT_ID, SEED_SECTION_1_ID, SEED_ADMIN_USER_ID } from '@test/constants';
import { WalletService } from './wallet.service';
import { AuditService } from '../audit/audit.service';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { StudentWallet } from './entities/student-wallet.entity';
import { WalletTransaction } from './entities/wallet-transaction.entity';
import { Student } from '../students/entities/student.entity';

/**
 * Integration tests for WalletService (16.1.5), against a real, migrated
 * database — deliberately *not* `dropSchema`, so `wallet_transactions`'
 * migration-only `trg_wallet_transactions_write_only` trigger is present
 * (see server/CLAUDE.md's dropSchema warning: a `synchronize`-rebuilt
 * schema has no triggers, since they aren't entity metadata).
 */

const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000005b01';

let studentSeq = 0;

describe('WalletService (integration)', () => {
  let moduleRef: TestingModule;
  let service: WalletService;
  let dataSource: DataSource;
  let studentRepo: Repository<Student>;
  let walletRepo: Repository<StudentWallet>;
  let transactionRepo: Repository<WalletTransaction>;

  beforeAll(async () => {
    moduleRef = await createTestModule(ALL_ENTITIES, [WalletService, AuditService]);
    service = moduleRef.get(WalletService);
    dataSource = moduleRef.get(DataSource);
    studentRepo = moduleRef.get(getRepositoryToken(Student));
    walletRepo = moduleRef.get(getRepositoryToken(StudentWallet));
    transactionRepo = moduleRef.get(getRepositoryToken(WalletTransaction));

    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Wallet Test Other Tenant', 'wallet-test-other-tenant', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [OTHER_TENANT_ID],
    );
  }, 60000);

  afterAll(async () => {
    // wallet_transactions is append-only (trg_wallet_transactions_write_only
    // rejects DELETE) — TRUNCATE bypasses row triggers, DELETE does not.
    await dataSource.query(`TRUNCATE TABLE wallet_transactions`);
    await dataSource.query(`DELETE FROM student_wallets`);
    await dataSource.query(`DELETE FROM students WHERE tenant_id = $1`, [OTHER_TENANT_ID]);
    await dataSource.query(`DELETE FROM schools WHERE id = $1`, [OTHER_TENANT_ID]);
    await moduleRef.close();
  });

  beforeEach(async () => {
    await dataSource.query(`TRUNCATE TABLE wallet_transactions`);
    await dataSource.query(`DELETE FROM student_wallets`);
  });

  async function makeStudent(tenantId = SEED_TENANT_ID): Promise<Student> {
    studentSeq += 1;
    return studentRepo.save(
      studentRepo.create({
        full_name: `Wallet Student ${studentSeq}`,
        registration_number: `WAL-${String(studentSeq).padStart(4, '0')}`,
        roll_number: studentSeq,
        // `students.class_section_id` is NOT NULL; the wallet's own logic
        // never touches this column, and this spec has no reason to
        // isolate class-section data by tenant, so every student — even
        // the OTHER_TENANT_ID one — reuses the globally-seeded section.
        class_section_id: SEED_SECTION_1_ID,
        tenant_id: tenantId,
      } as Partial<Student>),
    );
  }

  describe('credit then debit', () => {
    it('accumulates the balance and records signed ledger entries', async () => {
      const student = await makeStudent();

      await dataSource.transaction(async (manager) => {
        await service.credit(
          {
            studentId: student.id,
            tenantId: SEED_TENANT_ID,
            amount: 500,
            kind: WalletTransactionKind.CREDIT_OVERPAYMENT,
          },
          manager,
        );
      });
      await dataSource.transaction(async (manager) => {
        await service.debit(
          {
            studentId: student.id,
            tenantId: SEED_TENANT_ID,
            amount: 200,
            kind: WalletTransactionKind.DEBIT_CHECKOUT,
          },
          manager,
        );
      });

      const balance = await service.balance(student.id, SEED_TENANT_ID);
      expect(balance).toBe(300);

      const history = await service.history(student.id, SEED_TENANT_ID);
      expect(history.total).toBe(2);
      expect(history.data.map((t) => Number(t.amount)).sort((a, b) => a - b)).toEqual([-200, 500]);
    });
  });

  describe('debit beyond balance', () => {
    it('throws INSUFFICIENT_WALLET_BALANCE and leaves the balance unchanged', async () => {
      const student = await makeStudent();

      await dataSource.transaction(async (manager) => {
        await service.credit(
          {
            studentId: student.id,
            tenantId: SEED_TENANT_ID,
            amount: 100,
            kind: WalletTransactionKind.CREDIT_OVERPAYMENT,
          },
          manager,
        );
      });

      await expect(
        dataSource.transaction(async (manager) => {
          await service.debit(
            {
              studentId: student.id,
              tenantId: SEED_TENANT_ID,
              amount: 150,
              kind: WalletTransactionKind.DEBIT_CHECKOUT,
            },
            manager,
          );
        }),
      ).rejects.toThrow(BadRequestException);

      const balance = await service.balance(student.id, SEED_TENANT_ID);
      expect(balance).toBe(100);
      const history = await service.history(student.id, SEED_TENANT_ID);
      expect(history.total).toBe(1); // only the original credit — the failed debit left no row
    });
  });

  describe('concurrent debits', () => {
    it('never take the balance negative', async () => {
      const student = await makeStudent();

      await dataSource.transaction(async (manager) => {
        await service.credit(
          {
            studentId: student.id,
            tenantId: SEED_TENANT_ID,
            amount: 100,
            kind: WalletTransactionKind.CREDIT_OVERPAYMENT,
          },
          manager,
        );
      });

      // Two concurrent debits of 80 each against a 100 balance: the row
      // lock in getOrCreate makes the second wait for the first's
      // transaction to commit, so it sees the *post-debit* balance (20)
      // and correctly rejects rather than racing on the pre-debit read.
      const attempt = () =>
        dataSource.transaction(async (manager) => {
          await service.debit(
            {
              studentId: student.id,
              tenantId: SEED_TENANT_ID,
              amount: 80,
              kind: WalletTransactionKind.DEBIT_CHECKOUT,
            },
            manager,
          );
        });

      const results = await Promise.allSettled([attempt(), attempt()]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const balance = await service.balance(student.id, SEED_TENANT_ID);
      expect(balance).toBe(20);
      expect(balance).toBeGreaterThanOrEqual(0);
    });
  });

  describe('append-only ledger', () => {
    it('rejects UPDATE on wallet_transactions via the write-only trigger', async () => {
      const student = await makeStudent();
      await dataSource.transaction(async (manager) => {
        await service.credit(
          {
            studentId: student.id,
            tenantId: SEED_TENANT_ID,
            amount: 50,
            kind: WalletTransactionKind.CREDIT_OVERPAYMENT,
          },
          manager,
        );
      });

      const [tx] = await transactionRepo.find();
      await expect(
        dataSource.query(`UPDATE wallet_transactions SET amount = 999 WHERE id = $1`, [tx.id]),
      ).rejects.toThrow(/write-only/);
    });

    it('rejects DELETE on wallet_transactions via the write-only trigger', async () => {
      const student = await makeStudent();
      await dataSource.transaction(async (manager) => {
        await service.credit(
          {
            studentId: student.id,
            tenantId: SEED_TENANT_ID,
            amount: 50,
            kind: WalletTransactionKind.CREDIT_OVERPAYMENT,
          },
          manager,
        );
      });

      const [tx] = await transactionRepo.find();
      await expect(
        dataSource.query(`DELETE FROM wallet_transactions WHERE id = $1`, [tx.id]),
      ).rejects.toThrow(/write-only/);
    });
  });

  describe('tenant isolation', () => {
    it('keeps each tenant on its own wallet even for the same student id conceptually', async () => {
      const studentA = await makeStudent(SEED_TENANT_ID);
      const studentB = await makeStudent(OTHER_TENANT_ID);

      await dataSource.transaction(async (manager) => {
        await service.credit(
          {
            studentId: studentA.id,
            tenantId: SEED_TENANT_ID,
            amount: 100,
            kind: WalletTransactionKind.CREDIT_OVERPAYMENT,
          },
          manager,
        );
      });

      const balanceOtherTenant = await service.balance(studentB.id, OTHER_TENANT_ID);
      expect(balanceOtherTenant).toBe(0);

      // Wrong-tenant lookup of the same student never finds the wallet.
      const crossTenantBalance = await service.balance(studentA.id, OTHER_TENANT_ID);
      expect(crossTenantBalance).toBe(0);
    });
  });

  describe('getOrCreate', () => {
    it('creates a zero-balance wallet on first touch and reuses it thereafter', async () => {
      const student = await makeStudent();

      const wallet1 = await dataSource.transaction((manager) =>
        service.getOrCreate(student.id, SEED_TENANT_ID, manager),
      );
      expect(Number(wallet1.balance)).toBe(0);

      const wallet2 = await dataSource.transaction((manager) =>
        service.getOrCreate(student.id, SEED_TENANT_ID, manager),
      );
      expect(wallet2.id).toBe(wallet1.id);

      const count = await walletRepo.count({
        where: { student_id: student.id, tenant_id: SEED_TENANT_ID },
      });
      expect(count).toBe(1);
    });
  });

  describe('payout (MON-09)', () => {
    async function fund(student: Student, amount: number) {
      await dataSource.transaction((manager) =>
        service.credit(
          {
            studentId: student.id,
            tenantId: SEED_TENANT_ID,
            amount,
            kind: WalletTransactionKind.CREDIT_OVERPAYMENT,
          },
          manager,
        ),
      );
    }

    const payoutInput = (student: Student, amount: number) => ({
      studentId: student.id,
      tenantId: SEED_TENANT_ID,
      amount,
      reason: 'Family leaving, cash refund',
      actorUserId: SEED_ADMIN_USER_ID,
      approverUserId: SEED_ADMIN_USER_ID,
    });

    it('pays out 300 of 1,800: balance 1,500, one DEBIT_PAYOUT row, one approved audit row', async () => {
      const student = await makeStudent();
      await fund(student, 1800);

      const result = await dataSource.transaction((manager) =>
        service.payout(payoutInput(student, 300), manager),
      );

      expect(Number(result.balance)).toBe(1500);
      expect(await service.balance(student.id, SEED_TENANT_ID)).toBe(1500);
      const rows = await transactionRepo.find({
        where: { kind: WalletTransactionKind.DEBIT_PAYOUT },
      });
      expect(rows).toHaveLength(1);
      expect(Number(rows[0].amount)).toBe(-300);
      expect(rows[0].created_by_user_id).toBe(SEED_ADMIN_USER_ID);
      const logs = await dataSource
        .getRepository(AuditLog)
        .find({ where: { entity_type: 'StudentWallet', tenant_id: SEED_TENANT_ID } });
      expect(logs).toHaveLength(1);
      expect(logs[0].new_values).toMatchObject({
        balance: 1500,
        payout: 300,
        approved_by_user_id: SEED_ADMIN_USER_ID,
        approval_scope: ApprovalScope.PAYMENTS_REVERSE,
      });
    });

    it('refuses more than the balance with 409 WALLET_PAYOUT_EXCEEDS_BALANCE and writes nothing', async () => {
      const student = await makeStudent();
      await fund(student, 100);

      const err = await dataSource
        .transaction((manager) => service.payout(payoutInput(student, 100.01), manager))
        .catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.getResponse()).toMatchObject({
        code: 'WALLET_PAYOUT_EXCEEDS_BALANCE',
        details: { balance: 100 },
      });
      expect(await service.balance(student.id, SEED_TENANT_ID)).toBe(100);
      expect(
        await transactionRepo.count({ where: { kind: WalletTransactionKind.DEBIT_PAYOUT } }),
      ).toBe(0);
    });

    it('two concurrent payouts of 1,000 from 1,800: exactly one succeeds', async () => {
      const student = await makeStudent();
      await fund(student, 1800);

      const results = await Promise.allSettled([
        dataSource.transaction((m) => service.payout(payoutInput(student, 1000), m)),
        dataSource.transaction((m) => service.payout(payoutInput(student, 1000), m)),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(rejected.reason).toBeInstanceOf(ConflictException);
      expect(await service.balance(student.id, SEED_TENANT_ID)).toBe(800);
    });

    it('pays out a soft-deleted (left) student', async () => {
      const student = await makeStudent();
      await fund(student, 500);
      await studentRepo.softDelete({ id: student.id });

      const result = await dataSource.transaction((manager) =>
        service.payout(payoutInput(student, 500), manager),
      );
      expect(Number(result.balance)).toBe(0);
    });

    it("404s for another tenant's student", async () => {
      const student = await makeStudent(OTHER_TENANT_ID);

      await expect(
        dataSource.transaction((manager) => service.payout(payoutInput(student, 10), manager)),
      ).rejects.toThrow(NotFoundException);
    });
  });
});

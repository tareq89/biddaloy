import { Injectable, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { WalletTransactionKind } from '@biddaloy/shared';
import { StudentWallet } from './entities/student-wallet.entity';
import { WalletTransaction } from './entities/wallet-transaction.entity';
import { Student } from '../students/entities/student.entity';

export interface WalletMoveInput {
  studentId: string;
  tenantId: string;
  amount: number;
  kind: WalletTransactionKind;
  paymentId?: string | null;
  studentFeeId?: string | null;
  reversalOfId?: string | null;
  createdByUserId?: string | null;
  note?: string | null;
}

export interface WalletHistoryPage {
  data: WalletTransaction[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * The single writer/reader of a student's wallet balance and its
 * append-only transaction ledger (16.1.5).
 *
 * `getOrCreate`/`credit`/`debit` all take the caller's `EntityManager` and
 * lock the wallet row with `FOR UPDATE` before touching `balance` — every
 * caller (checkout in 16.4.2, fee-generation auto-apply in 16.3.1,
 * reversal in 16.6.1) runs this inside its own transaction, and the lock is
 * what makes two concurrent debits against the same wallet serialize
 * instead of racing to read the same starting balance. Postgres holds the
 * row lock until that transaction commits or rolls back, so a second
 * `credit`/`debit` call for the same wallet simply waits its turn.
 *
 * `balance`/`history` are plain reads for the `GET /students/:id/wallet`
 * endpoint — no manager, no lock, a benign dirty read of the current
 * balance is fine for display.
 */
@Injectable()
export class WalletService {
  constructor(
    @InjectRepository(StudentWallet)
    private readonly walletRepo: Repository<StudentWallet>,
    @InjectRepository(WalletTransaction)
    private readonly transactionRepo: Repository<WalletTransaction>,
  ) {}

  /**
   * Returns the student's wallet, creating it with a zero balance if this
   * is its first movement, and locks the row `FOR UPDATE` for the
   * remainder of `manager`'s transaction.
   *
   * The insert races against other concurrent first-movers for the same
   * student, so it uses `ON CONFLICT DO NOTHING` against the
   * `(tenant_id, student_id)` unique constraint rather than a plain
   * `INSERT` — the loser of the race falls through to the `SELECT ...
   * FOR UPDATE` below and locks the row the winner created.
   */
  async getOrCreate(
    studentId: string,
    tenantId: string,
    manager: EntityManager,
  ): Promise<StudentWallet> {
    const student = await manager
      .getRepository(Student)
      .findOne({ where: { id: studentId, tenant_id: tenantId } });
    if (!student) {
      throw new BadRequestException('Student not found for this tenant');
    }

    await manager.query(
      `INSERT INTO "student_wallets" ("student_id", "tenant_id") VALUES ($1, $2)
       ON CONFLICT ("tenant_id", "student_id") DO NOTHING`,
      [studentId, tenantId],
    );

    const wallet = await manager
      .getRepository(StudentWallet)
      .createQueryBuilder('wallet')
      .where('wallet.student_id = :studentId', { studentId })
      .andWhere('wallet.tenant_id = :tenantId', { tenantId })
      .setLock('pessimistic_write')
      .getOne();

    if (!wallet) {
      // Unreachable in practice: the insert above guarantees a row exists
      // before this select runs, in the same transaction.
      throw new InternalServerErrorException('Failed to create or lock student wallet');
    }
    return wallet;
  }

  /**
   * Adds funds to the wallet (e.g. an overpayment, or a fee-structure
   * change that reduces what a student owes). `amount` must be positive;
   * the signed ledger entry and the balance update happen inside `manager`'s
   * transaction, after the row lock from `getOrCreate`.
   */
  async credit(input: WalletMoveInput, manager: EntityManager): Promise<StudentWallet> {
    if (input.amount <= 0) {
      throw new BadRequestException('Credit amount must be positive');
    }

    const wallet = await this.getOrCreate(input.studentId, input.tenantId, manager);
    const newBalance = round2(Number(wallet.balance) + input.amount);

    await manager.getRepository(StudentWallet).update({ id: wallet.id }, { balance: newBalance });

    await manager.getRepository(WalletTransaction).save(
      manager.getRepository(WalletTransaction).create({
        tenant_id: input.tenantId,
        wallet_id: wallet.id,
        amount: input.amount,
        kind: input.kind,
        payment_id: input.paymentId ?? null,
        student_fee_id: input.studentFeeId ?? null,
        reversal_of_id: input.reversalOfId ?? null,
        created_by_user_id: input.createdByUserId ?? null,
        note: input.note ?? null,
      }),
    );

    return { ...wallet, balance: newBalance };
  }

  /**
   * Removes funds from the wallet (e.g. applying credit at checkout).
   * `amount` must be positive (the caller does not pass a negative number —
   * the ledger entry itself is what gets stored signed-negative). Throws
   * `BadRequestException('INSUFFICIENT_WALLET_BALANCE')` and leaves the
   * balance untouched if the wallet cannot cover it; the row lock from
   * `getOrCreate` means that check is against a balance no concurrent
   * debit can change out from under it.
   */
  async debit(input: WalletMoveInput, manager: EntityManager): Promise<StudentWallet> {
    if (input.amount <= 0) {
      throw new BadRequestException('Debit amount must be positive');
    }

    const wallet = await this.getOrCreate(input.studentId, input.tenantId, manager);
    const currentBalance = Number(wallet.balance);
    if (currentBalance < input.amount) {
      throw new BadRequestException('INSUFFICIENT_WALLET_BALANCE');
    }
    const newBalance = round2(currentBalance - input.amount);

    await manager.getRepository(StudentWallet).update({ id: wallet.id }, { balance: newBalance });

    await manager.getRepository(WalletTransaction).save(
      manager.getRepository(WalletTransaction).create({
        tenant_id: input.tenantId,
        wallet_id: wallet.id,
        amount: -input.amount,
        kind: input.kind,
        payment_id: input.paymentId ?? null,
        student_fee_id: input.studentFeeId ?? null,
        reversal_of_id: input.reversalOfId ?? null,
        created_by_user_id: input.createdByUserId ?? null,
        note: input.note ?? null,
      }),
    );

    return { ...wallet, balance: newBalance };
  }

  /** The student's current balance, or 0 if the wallet doesn't exist yet. */
  async balance(studentId: string, tenantId: string): Promise<number> {
    const wallet = await this.walletRepo.findOne({
      where: { student_id: studentId, tenant_id: tenantId },
    });
    return wallet ? Number(wallet.balance) : 0;
  }

  /** Paginated ledger for the student's wallet, newest first. */
  async history(
    studentId: string,
    tenantId: string,
    page = 1,
    limit = 20,
  ): Promise<WalletHistoryPage> {
    const wallet = await this.walletRepo.findOne({
      where: { student_id: studentId, tenant_id: tenantId },
    });
    if (!wallet) {
      return { data: [], total: 0, page, limit, totalPages: 0 };
    }

    const [data, total] = await this.transactionRepo.findAndCount({
      where: { wallet_id: wallet.id, tenant_id: tenantId },
      order: { created_at: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }
}

/** Avoids float drift accumulating across many small credits/debits. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

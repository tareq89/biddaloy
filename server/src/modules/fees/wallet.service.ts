import {
  Injectable,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { round2 } from '../../common/constants/money';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { ApprovalScope, AuditAction, WalletTransactionKind } from '@biddaloy/shared';
import { AuditService } from '../audit/audit.service';
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
  /** `payout` and payment reversal set this: money of a student who has left
   * can still be paid out or unwound. */
  allowDeletedStudent?: boolean;
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
    private readonly auditService: AuditService,
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
    allowDeleted = false,
  ): Promise<StudentWallet> {
    const lockWallet = () =>
      manager
        .getRepository(StudentWallet)
        .createQueryBuilder('wallet')
        .where('wallet.student_id = :studentId', { studentId })
        .andWhere('wallet.tenant_id = :tenantId', { tenantId })
        .setLock('pessimistic_write')
        .getOne();

    // Wallet row first. StudentService.remove locks the student, then bills,
    // then this row FOR UPDATE, so holding it already keeps a delete out, and
    // a plain read below sees a delete that committed first. Callers lock
    // bills before moving money; locking the student here too would invert
    // remove's order and deadlock (review r2 #1).
    const existing = await lockWallet();

    // `allowDeleted` is only for `payout` and payment reversal: money of a
    // student who has left must still be payable or unwindable. Everyone else
    // keeps refusing a deleted one.
    // No wallet yet: an INSERT takes only KEY SHARE on the student, which
    // never waits for remove. FOR SHARE does: a delete waits for this new
    // wallet, or, if it went first, the row re-reads as deleted (review r1 #5).
    // ponytail: a checkout that credits change to a student's first-ever
    // wallet still locks bills then student, so it can deadlock a concurrent
    // delete of that student (40P01, rolled back). Rare; retry-on-40P01 if seen.
    const student = await manager.getRepository(Student).findOne({
      where: { id: studentId, tenant_id: tenantId },
      ...(existing ? {} : { lock: { mode: 'pessimistic_read' as const } }),
      withDeleted: allowDeleted,
    });
    if (!student) {
      throw new BadRequestException('Student not found for this tenant');
    }
    if (existing) return existing;

    await manager.query(
      `INSERT INTO "student_wallets" ("student_id", "tenant_id") VALUES ($1, $2)
       ON CONFLICT ("tenant_id", "student_id") DO NOTHING`,
      [studentId, tenantId],
    );

    const wallet = await lockWallet();

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

    const wallet = await this.getOrCreate(
      input.studentId,
      input.tenantId,
      manager,
      input.allowDeletedStudent,
    );
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

    const wallet = await this.getOrCreate(
      input.studentId,
      input.tenantId,
      manager,
      input.allowDeletedStudent,
    );
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

  /**
   * Pays wallet money out to the family as a cash refund (MON-09).
   * `approve` consumes the `payments.reverse` approval and returns the
   * approver; it runs last, after every check, so a refused payout does not
   * burn the token (same order as `FeeFineService.waiveBill`). Works for a
   * student who has left (soft-deleted); 404 if the student is not in this
   * tenant. Refuses more than the balance with 409 and writes nothing.
   *
   * The balance is checked here, after the wallet row lock, so two
   * concurrent payouts serialize: the second sees the reduced balance.
   */
  async payout(
    input: {
      studentId: string;
      tenantId: string;
      amount: number;
      reason: string;
      actorUserId: string;
      approve: () => Promise<string>;
    },
    manager: EntityManager,
  ): Promise<StudentWallet> {
    const known = await manager.getRepository(Student).exists({
      where: { id: input.studentId, tenant_id: input.tenantId },
      withDeleted: true,
    });
    if (!known) {
      throw new NotFoundException('Student not found');
    }

    const wallet = await this.getOrCreate(input.studentId, input.tenantId, manager, true);
    const balance = Number(wallet.balance);
    if (!(input.amount > 0) || input.amount > balance) {
      throw new ConflictException({
        code: 'WALLET_PAYOUT_EXCEEDS_BALANCE',
        message: 'Payout must be more than 0 and no more than the wallet balance',
        details: { balance },
      });
    }
    const approverUserId = await input.approve();

    const updated = await this.debit(
      {
        studentId: input.studentId,
        tenantId: input.tenantId,
        amount: input.amount,
        kind: WalletTransactionKind.DEBIT_PAYOUT,
        createdByUserId: input.actorUserId,
        note: input.reason,
        allowDeletedStudent: true,
      },
      manager,
    );

    await this.auditService.recordApproved(
      {
        action: AuditAction.UPDATE,
        entity_type: 'StudentWallet',
        entity_id: wallet.id,
        tenant_id: input.tenantId,
        performed_by_user_id: input.actorUserId,
        approved_by_user_id: approverUserId,
        approval_scope: ApprovalScope.PAYMENTS_REVERSE,
        old_values: { balance },
        new_values: { balance: updated.balance, payout: input.amount, reason: input.reason },
      },
      manager,
    );
    return updated;
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

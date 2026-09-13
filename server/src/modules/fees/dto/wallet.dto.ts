import { ApiProperty } from '@nestjs/swagger';
import { WalletTransactionKind } from '@biddaloy/shared';
import { WalletTransaction } from '../entities/wallet-transaction.entity';

/**
 * The family-safe shape of a `WalletTransaction` row — everything a PARENT
 * or STUDENT needs to understand a balance move (`amount`, `kind`, `note`,
 * `created_at`), and nothing internal (`payment_id`, `student_fee_id`,
 * `reversal_of_id`, `created_by_user_id`, tenant/wallet ids) that a staff
 * caller sees on the raw entity.
 */
export class FamilyWalletTransactionDto {
  @ApiProperty()
  amount: number;

  @ApiProperty({ enum: WalletTransactionKind })
  kind: WalletTransactionKind;

  @ApiProperty({ nullable: true, type: String })
  note: string | null;

  @ApiProperty()
  created_at: Date;
}

export function toFamilyWalletTransaction(tx: WalletTransaction): FamilyWalletTransactionDto {
  return {
    // tx.amount comes back from the pg driver as a numeric string; the DTO
    // promises `number` (matches `balance`, which is already normalized in
    // WalletService), so normalize here too rather than leak the string.
    amount: Number(tx.amount),
    kind: tx.kind,
    note: tx.note,
    created_at: tx.created_at,
  };
}

export class StudentWalletResponseDto {
  @ApiProperty()
  balance: number;

  @ApiProperty({ type: [WalletTransaction] })
  transactions: WalletTransaction[];
}

export class FamilyStudentWalletResponseDto {
  @ApiProperty()
  balance: number;

  @ApiProperty({ type: [FamilyWalletTransactionDto] })
  transactions: FamilyWalletTransactionDto[];
}

import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';
import { WalletTransaction } from '../entities/wallet-transaction.entity';

export class StudentWalletResponseDto {
  @ApiProperty()
  balance: number;

  @ApiProperty({ type: [WalletTransaction] })
  transactions: WalletTransaction[];
}

/** `POST /students/:id/wallet/payout` — pay wallet money out as a cash refund. */
export class WalletPayoutDto {
  @ApiProperty({ description: 'Taka to pay out; at most the wallet balance.' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount: number;

  @ApiProperty({ description: 'Why the money is paid out (kept in the ledger and audit log).' })
  @IsString()
  @SanitizeText()
  @MinLength(3)
  @MaxLength(500)
  reason: string;
}

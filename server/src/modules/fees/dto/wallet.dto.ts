import { ApiProperty } from '@nestjs/swagger';
import { WalletTransaction } from '../entities/wallet-transaction.entity';

export class StudentWalletResponseDto {
  @ApiProperty()
  balance: number;

  @ApiProperty({ type: [WalletTransaction] })
  transactions: WalletTransaction[];
}

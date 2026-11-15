import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';
import { PaymentSubmissionStatus } from '@biddaloy/shared';

/** `POST /portal/online-payments`. No amount: the server adds up the bills itself (D26). */
export class StartOnlinePaymentDto {
  @ApiProperty({ type: [String], format: 'uuid' })
  @Transform(({ value }) => (value === undefined || Array.isArray(value) ? value : [value]))
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  billIds: string[];
}

export class StartOnlinePaymentResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ description: 'The bKash checkout page to send the guardian to.' })
  bkashUrl: string;
}

export class OnlinePaymentBillDto {
  @ApiProperty() studentFeeId: string;
  @ApiProperty() studentId: string;
  @ApiProperty() amount: string;
}

export class OnlinePaymentResultDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: PaymentSubmissionStatus }) status: PaymentSubmissionStatus;
  @ApiProperty({ description: 'Sum of the bills of the children the caller is linked to.' })
  amount: string;
  @ApiProperty({ description: 'Paid at bKash but no bill could take it; it went to the wallet.' })
  unmatched: boolean;
  @ApiProperty() createdAt: Date;
  @ApiProperty({ type: [OnlinePaymentBillDto] }) bills: OnlinePaymentBillDto[];
}

export class BkashTestResponseDto {
  @ApiProperty() ok: boolean;
  @ApiProperty() lastTestOkAt: string;
}

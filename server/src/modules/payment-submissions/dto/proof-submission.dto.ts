import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaymentMethod, PaymentSubmissionStatus } from '@biddaloy/shared';
import { MONEY_MAX } from '../../../common/constants/money';

/** multipart sends one value as a string and many as an array. */
const toArray = ({ value }: { value: unknown }) =>
  value === undefined ? value : Array.isArray(value) ? value : [value];

/** `POST /portal/payment-proofs` (multipart). Amount must equal the bills' balance (D26). */
export class CreateProofSubmissionDto {
  @ApiProperty({ type: [String], format: 'uuid' })
  @Transform(toArray)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  billIds: string[];

  @ApiProperty({ enum: PaymentMethod })
  @IsEnum(PaymentMethod)
  method: PaymentMethod;

  @ApiProperty({ maximum: MONEY_MAX })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(MONEY_MAX)
  amount: number;

  @ApiProperty({ example: '2026-11-14' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsISO8601({ strict: true })
  paidOn: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;
}

/** `GET /portal/payment-proofs`. `limit` is capped at 100 (Rule 5). */
export class QueryProofSubmissionsDto {
  @IsOptional()
  @IsUUID()
  studentId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class ProofSubmissionBillDto {
  @ApiProperty() studentFeeId: string;
  @ApiProperty() studentId: string;
  @ApiProperty() amount: string;
}

export class ProofSubmissionFileDto {
  @ApiProperty() id: string;
  @ApiProperty() contentType: string;
  @ApiProperty() sizeBytes: number;
}

export class ProofSubmissionResponseDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: PaymentSubmissionStatus }) status: PaymentSubmissionStatus;
  @ApiProperty({ enum: PaymentMethod, nullable: true }) method: PaymentMethod | null;
  @ApiProperty() amount: string;
  @ApiProperty({ nullable: true }) paidOn: string | null;
  @ApiProperty({ nullable: true }) reference: string | null;
  @ApiProperty() submittedByUserId: string;
  @ApiProperty() createdAt: Date;
  @ApiProperty({ type: [ProofSubmissionBillDto] }) bills: ProofSubmissionBillDto[];
  @ApiProperty({ type: [ProofSubmissionFileDto] }) files: ProofSubmissionFileDto[];
}

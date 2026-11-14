import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  PaymentProofRejectReason,
  PaymentSubmissionSource,
  PaymentSubmissionStatus,
} from '@biddaloy/shared';

/** `GET /payment-submissions`. `limit` is capped at 100 (Rule 5). */
export class QueryProofReviewDto {
  @ApiPropertyOptional({ enum: PaymentSubmissionSource })
  @IsOptional()
  @IsEnum(PaymentSubmissionSource)
  source?: PaymentSubmissionSource;

  @ApiPropertyOptional({ enum: PaymentSubmissionStatus })
  @IsOptional()
  @IsEnum(PaymentSubmissionStatus)
  status?: PaymentSubmissionStatus;

  @ApiPropertyOptional({ maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: 'The nextCursor of the previous page.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Matches(/^[A-Za-z0-9_-]+$/)
  cursor?: string;
}

/** `POST /payment-submissions/:id/reject`. OTHER needs a note (D42, also a DB CHECK). */
export class RejectProofDto {
  @ApiProperty({ enum: PaymentProofRejectReason })
  @IsEnum(PaymentProofRejectReason)
  reason: PaymentProofRejectReason;

  @ApiPropertyOptional({ maxLength: 500 })
  @ValidateIf((o: RejectProofDto) => o.reason === PaymentProofRejectReason.OTHER || o.note != null)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  note?: string;
}

/** `POST /payment-submissions/:id/reopen`. */
export class ReopenProofDto {
  @ApiProperty({ maxLength: 500 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  note: string;
}

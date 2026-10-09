import { ApiProperty, ApiPropertyOptional, PickType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';
import { FeeWaiverPayloadDto } from './payloads/fee-waiver.dto';

/** What an approver actually grants on a FEE_WAIVER (D39): the payload without the reason. */
export class GrantedFeeWaiverDto extends PickType(FeeWaiverPayloadDto, [
  'kind',
  'value',
  'fee_types',
  'start_date',
  'end_date',
] as const) {}

/** `POST /applications/:id/approve` */
export class ApproveApplicationDto {
  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @SanitizeText()
  note?: string;

  /** FEE_WAIVER final approval only (D39). */
  @ApiPropertyOptional({ type: GrantedFeeWaiverDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => GrantedFeeWaiverDto)
  granted?: GrantedFeeWaiverDto;
}

/** `POST /applications/:id/reject` */
export class RejectApplicationDto {
  @ApiProperty({ minLength: 1, maxLength: 1000 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  @SanitizeText()
  reason: string;
}

/** `POST /applications/:id/consider` */
export class ConsiderApplicationDto {
  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @SanitizeText()
  note?: string;
}

/** `POST /applications/:id/cancel` */
export class CancelApplicationDto {
  @ApiProperty({ minLength: 1, maxLength: 1000 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  @SanitizeText()
  reason: string;
}

/** `POST /applications/bulk-approve` (D33, D35) */
export class BulkApproveDto {
  @ApiProperty({ type: [String], minItems: 1, maxItems: 50 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  ids: string[];

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @SanitizeText()
  note?: string;
}

/** One row of the bulk-approve result. */
export class BulkApproveResultDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  ok: boolean;

  @ApiPropertyOptional()
  error_code?: string;
}

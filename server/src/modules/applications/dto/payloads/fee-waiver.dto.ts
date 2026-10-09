import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MaxLength,
  MinLength,
} from 'class-validator';
import { FeeType } from '@biddaloy/shared';
import { SanitizeText } from '../../../../common/decorators/sanitize-text.decorator';

/**
 * FEE_WAIVER payload. 52.3.1 builds `GrantedFeeWaiverDto` from this.
 * PERCENT `value` <= 100 is checked in `ApplicationsService` (a conditional `@Max`
 * would need `@ValidateIf`, which also switches off `@IsNumber`).
 */
export class FeeWaiverPayloadDto {
  @IsIn(['PERCENT', 'FLAT'])
  kind: 'PERCENT' | 'FLAT';

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  value: number;

  /** Omitted or `null` = all fees; an empty list would always fail at approval, so it is refused here. */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsEnum(FeeType, { each: true })
  fee_types?: FeeType[];

  @IsOptional()
  @IsDateString({ strict: true }, { message: 'start_date must be a valid YYYY-MM-DD date' })
  start_date?: string;

  @IsOptional()
  @IsDateString({ strict: true }, { message: 'end_date must be a valid YYYY-MM-DD date' })
  end_date?: string;

  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  @SanitizeText()
  reason: string;
}

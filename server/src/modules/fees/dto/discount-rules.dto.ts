import {
  IsUUID,
  IsEnum,
  IsNumber,
  IsOptional,
  IsArray,
  ArrayMinSize,
  IsDateString,
  MaxLength,
  Min,
  Max,
  MinLength,
} from 'class-validator';
import { DiscountKind, FeeType } from '@biddaloy/shared';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';
import { DiscountRule } from '../entities/discount-rule.entity';

export class CreateDiscountRuleDto {
  @IsUUID()
  student_id: string;

  @IsEnum(DiscountKind)
  kind: DiscountKind;

  @IsNumber()
  @Min(0)
  value: number;

  /** Omit or `null` for "applies to every fee type" (never LATE_FEE). */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(FeeType, { each: true })
  fee_types?: FeeType[] | null;

  @IsOptional()
  @IsDateString()
  starts_on?: string | null;

  @IsOptional()
  @IsDateString()
  ends_on?: string | null;

  @SanitizeText()
  @MinLength(1)
  @MaxLength(200)
  reason: string;
}

export class UpdateDiscountRuleDto {
  @IsOptional()
  @IsEnum(DiscountKind)
  kind?: DiscountKind;

  @IsOptional()
  @IsNumber()
  @Min(0)
  value?: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(FeeType, { each: true })
  fee_types?: FeeType[] | null;

  @IsOptional()
  @IsDateString()
  starts_on?: string | null;

  @IsOptional()
  @IsDateString()
  ends_on?: string | null;

  @IsOptional()
  @SanitizeText()
  @MinLength(1)
  @MaxLength(200)
  reason?: string;
}

export class DiscountRuleDto {
  id: string;
  student_id: string;
  kind: DiscountKind;
  value: number;
  fee_types: FeeType[] | null;
  starts_on: string | null;
  ends_on: string | null;
  reason: string;
  created_by_user_id: string;
  created_at: Date;
  updated_at: Date;
}

export function toDiscountRuleDto(rule: DiscountRule): DiscountRuleDto {
  return {
    id: rule.id,
    student_id: rule.student_id,
    kind: rule.kind,
    value: Number(rule.value),
    fee_types: rule.fee_types,
    starts_on: rule.starts_on,
    ends_on: rule.ends_on,
    reason: rule.reason,
    created_by_user_id: rule.created_by_user_id,
    created_at: rule.created_at,
    updated_at: rule.updated_at,
  };
}

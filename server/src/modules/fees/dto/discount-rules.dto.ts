import {
  IsUUID,
  IsEnum,
  IsNumber,
  IsOptional,
  IsArray,
  ArrayMinSize,
  IsDateString,
  IsBoolean,
  MaxLength,
  Min,
  Max,
  MinLength,
  ValidateIf,
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
  // A PERCENT rule over 100 is nonsensical; matches the DB-level
  // CHK_discount_rules_percent_range check — checked here too so a bad
  // PERCENT value 400s with a field error instead of a raw 500 from the
  // DB constraint.
  @ValidateIf((o: CreateDiscountRuleDto) => o.kind === DiscountKind.PERCENT)
  @Max(100)
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
  // Only checked when `kind` is also in this same patch (o.kind ===
  // PERCENT) — a value-only PATCH against an existing PERCENT rule falls
  // back to the DB's CHK_discount_rules_percent_range constraint, same as
  // before this fix.
  @ValidateIf((o: UpdateDiscountRuleDto) => o.kind === DiscountKind.PERCENT)
  @Max(100)
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

  /** [Opus review, B3] Deactivate/reactivate without a soft delete. */
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

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
  approved_by_user_id: string;
  is_active: boolean;
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
    approved_by_user_id: rule.approved_by_user_id,
    is_active: rule.is_active,
    created_at: rule.created_at,
    updated_at: rule.updated_at,
  };
}

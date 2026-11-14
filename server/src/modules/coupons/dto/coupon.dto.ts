import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { COUPON_CODE_PATTERN, CouponDiscountKind, CouponScope } from '@biddaloy/shared';

// Rule 5: bounds on every owner-typed number. `fixed_paisa` is an int column.
export const COUPON_FIXED_MAX_PAISA = 2_000_000_000;
export const COUPON_BIG_MAX_PAISA = 9_999_999_999; // MONEY_MAX (99,999,999.99) in paisa
export const COUPON_MAX_SCHOOLS = 500;

const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class CreateCouponDto {
  @ApiProperty({ example: 'WELCOME10', description: '4-20 of A-Z, 0-9, "-"; upper-cased.' })
  @Transform(upper)
  @IsString()
  @MaxLength(20)
  @Matches(COUPON_CODE_PATTERN)
  code: string;

  @ApiProperty({ enum: CouponDiscountKind })
  @IsEnum(CouponDiscountKind)
  discount_kind: CouponDiscountKind;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, description: 'PERCENT only; 100 needs /free.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  percent?: number;

  @ApiPropertyOptional({ description: 'FIXED only, whole paisa off each month.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(COUPON_FIXED_MAX_PAISA)
  fixed_paisa?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 24 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24)
  max_months?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(COUPON_BIG_MAX_PAISA)
  max_discount_paisa?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(COUPON_BIG_MAX_PAISA)
  min_order_paisa?: number;

  @ApiPropertyOptional({ enum: CouponScope, default: CouponScope.ALL })
  @IsOptional()
  @IsEnum(CouponScope)
  scope?: CouponScope;

  @ApiPropertyOptional({ type: [String], description: 'Required (non-empty) for SCHOOLS.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(COUPON_MAX_SCHOOLS)
  @IsUUID('all', { each: true })
  schools?: string[];

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  max_uses?: number;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000)
  per_school_max?: number;

  @ApiProperty()
  @IsDateString({ strict: true })
  starts_at: string;

  @ApiProperty()
  @IsDateString({ strict: true })
  ends_at: string;
}

/** `/free` forces PERCENT 100; the body cannot say otherwise. */
export class CreateFreeCouponDto extends OmitType(CreateCouponDto, [
  'discount_kind',
  'percent',
  'fixed_paisa',
  'max_discount_paisa',
] as const) {}

/** Code, kind and percent never change, and a PATCH cannot make a coupon free. */
export class UpdateCouponDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString({ strict: true })
  ends_at?: string;

  @ApiPropertyOptional({ minimum: 1, description: 'Not below the uses so far.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  max_uses?: number;

  @ApiPropertyOptional({ type: [String], description: 'Replaces the school list (SCHOOLS scope).' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(COUPON_MAX_SCHOOLS)
  @IsUUID('all', { each: true })
  schools?: string[];
}

export class CouponPageQueryDto {
  /** Opaque; a bad one is a fixed 400. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

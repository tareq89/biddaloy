import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export const PLAN_PRICE_MAX_PAISA = 100_000_000;

export class CreatePlanDto {
  @ApiProperty({ minLength: 2, maxLength: 60 })
  @Transform(trim)
  @IsString()
  @Length(2, 60)
  name: string;

  @ApiProperty({ description: 'Whole paisa per seat per month.', maximum: PLAN_PRICE_MAX_PAISA })
  @IsInt()
  @Min(1)
  @Max(PLAN_PRICE_MAX_PAISA)
  unit_price_paisa: number;
}

export class UpdatePlanDto {
  @ApiProperty({ required: false, minLength: 2, maxLength: 60 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 60)
  name?: string;

  @ApiProperty({ required: false, maximum: PLAN_PRICE_MAX_PAISA })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(PLAN_PRICE_MAX_PAISA)
  unit_price_paisa?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class AssignPlanDto {
  @ApiProperty()
  @IsUUID()
  plan_id: string;

  @ApiProperty({ minLength: 5, maxLength: 300 })
  @Transform(trim)
  @IsString()
  @Length(5, 300)
  reason: string;
}

export class ListPlansQueryDto {
  @ApiProperty({ required: false, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class PlanDto {
  id: string;
  name: string;
  unit_price_paisa: number;
  active: boolean;
  is_default: boolean;
}

export class PlanPriceDto {
  planId: string;
  name: string;
  unitPricePaisa: number;
}

import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { MONEY_MAX } from '../../../../common/constants/money';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export const MIN_PACKAGE_SMS = 100;
export const MAX_PACKAGE_SMS = 1_000_000;
export const MAX_VALIDITY_DAYS = 365;

export class CreateSmsPackageDto {
  @ApiProperty({ minLength: 1, maxLength: 120 })
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  name: string;

  @ApiProperty({ minimum: MIN_PACKAGE_SMS, maximum: MAX_PACKAGE_SMS })
  @IsInt()
  @Min(MIN_PACKAGE_SMS)
  @Max(MAX_PACKAGE_SMS)
  smsCount: number;

  @ApiProperty({ minimum: 1, maximum: MAX_VALIDITY_DAYS })
  @IsInt()
  @Min(1)
  @Max(MAX_VALIDITY_DAYS)
  validityDays: number;

  @ApiProperty({ description: 'Price in taka, at most 2 decimals.', maximum: MONEY_MAX })
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(MONEY_MAX)
  priceTaka: number;
}

export class UpdateSmsPackageDto {
  @ApiProperty({ required: false, maxLength: 120 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  name?: string;

  @ApiProperty({ required: false, minimum: MIN_PACKAGE_SMS, maximum: MAX_PACKAGE_SMS })
  @IsOptional()
  @IsInt()
  @Min(MIN_PACKAGE_SMS)
  @Max(MAX_PACKAGE_SMS)
  smsCount?: number;

  @ApiProperty({ required: false, minimum: 1, maximum: MAX_VALIDITY_DAYS })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_VALIDITY_DAYS)
  validityDays?: number;

  @ApiProperty({ required: false, maximum: MONEY_MAX })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(MONEY_MAX)
  priceTaka?: number;
}

export class SetSmsPackageActiveDto {
  @ApiProperty()
  @IsBoolean()
  active: boolean;
}

export class ListSmsPackagesQueryDto {
  @ApiProperty({ required: false, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class SmsPackageDto {
  id: string;
  name: string;
  smsCount: number;
  validityDays: number;
  pricePaisa: string;
  priceTaka: string;
  active: boolean;
}

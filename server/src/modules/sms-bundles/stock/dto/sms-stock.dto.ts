import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MONEY_MAX } from '../../../../common/constants/money';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export const MAX_STOCK_SMS = 100_000_000;
export const MAX_BALANCE_SMS = 1_000_000_000;

export class RecordSmsStockDto {
  @ApiProperty({ example: '2026-11-01' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'boughtOn must be YYYY-MM-DD' })
  @IsDateString({ strict: true })
  boughtOn: string;

  @ApiProperty({ minimum: 1, maximum: MAX_STOCK_SMS })
  @IsInt()
  @Min(1)
  @Max(MAX_STOCK_SMS)
  smsCount: number;

  @ApiProperty({ description: 'Cost in taka, at most 2 decimals.', maximum: MONEY_MAX })
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(MONEY_MAX)
  costTaka: number;

  @ApiProperty({ required: false, maxLength: 500 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class DeleteSmsStockDto {
  @ApiProperty({ minLength: 5, maxLength: 490 })
  @Transform(trim)
  @IsString()
  @Length(5, 490)
  reason: string;
}

export class RecordProviderBalanceDto {
  @ApiProperty({ minimum: 0, maximum: MAX_BALANCE_SMS })
  @IsInt()
  @Min(0)
  @Max(MAX_BALANCE_SMS)
  smsBalance: number;
}

export class ListSmsStockQueryDto {
  @ApiProperty({ required: false, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiProperty({ required: false, description: 'Opaque cursor from the previous page.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;
}

export class SmsStockEntryDto {
  @ApiProperty() id: string;
  @ApiProperty() boughtOn: string;
  @ApiProperty() smsCount: number;
  @ApiProperty({ description: 'Whole paisa, as a string.' }) costPaisa: string;
  @ApiProperty({ nullable: true, type: String }) note: string | null;
  @ApiProperty() createdAt: string;
}

export class SmsStockPageDto {
  @ApiProperty({ type: [SmsStockEntryDto] }) items: SmsStockEntryDto[];
  @ApiProperty({ nullable: true, type: String }) nextCursor: string | null;
}

export class ProviderBalanceDto {
  @ApiProperty({ nullable: true, type: Number }) sms: number | null;
  @ApiProperty({ enum: ['PROVIDER', 'ENTERED', 'UNKNOWN'] })
  source: 'PROVIDER' | 'ENTERED' | 'UNKNOWN';
  @ApiProperty({ nullable: true, type: String }) asOf: string | null;
  @ApiProperty() stale: boolean;
}

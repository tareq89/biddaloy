import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import { PlatformPaymentMethod, SCHOOL_BILLING_FILTERS } from '@biddaloy/shared';
import { MAX_ORDER_SEATS } from '../orders.service';

/** `ABC-123`, `abc-123`, `ABC 123` -> `ABC123` (whitespace and any dash removed). */
export function normalizeReference(value: unknown): unknown {
  return typeof value === 'string' ? value.toUpperCase().replace(/[\s\-‐-―−]+/g, '') : value;
}

/** Rule 5: `limit` is capped at 100. */
export class ListPlatformSchoolsQueryDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: SCHOOL_BILLING_FILTERS })
  @IsOptional()
  @IsIn(SCHOOL_BILLING_FILTERS)
  filter?: (typeof SCHOOL_BILLING_FILTERS)[number];

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

/** Body for `POST /platform/billing/orders/:id/offline-payment`. The amount is the order's, never typed. */
export class OfflinePaymentDto {
  @ApiProperty({ enum: [PlatformPaymentMethod.OFFLINE_BANK, PlatformPaymentMethod.OFFLINE_CASH] })
  @IsIn([PlatformPaymentMethod.OFFLINE_BANK, PlatformPaymentMethod.OFFLINE_CASH])
  method: PlatformPaymentMethod.OFFLINE_BANK | PlatformPaymentMethod.OFFLINE_CASH;

  /**
   * Bank slip / receipt number; unique per method, so one slip cannot pay two orders. Stored
   * normalised (upper-case, no spaces or dashes): `abc-123`, `ABC 123` and `ABC123` are one slip.
   */
  @ApiProperty({ minLength: 3, maxLength: 100 })
  @IsString()
  @Transform(({ value }: { value: unknown }) => normalizeReference(value))
  @Length(3, 100)
  reference: string;

  /** Audit only: a replay is already safe because an order can be paid once. */
  @ApiProperty({ minLength: 8, maxLength: 100 })
  @IsString()
  @Length(8, 100)
  idempotency_key: string;
}

/** Body for `POST /platform/billing/schools/:id/grant`. */
export class GrantSeatsDto {
  @ApiProperty({ minimum: 1, maximum: MAX_ORDER_SEATS })
  @IsInt()
  @Min(1)
  @Max(MAX_ORDER_SEATS)
  seats: number;

  @ApiProperty({ minimum: 1, maximum: 24 })
  @IsInt()
  @Min(1)
  @Max(24)
  months: number;

  @ApiProperty({ minLength: 10, maxLength: 500 })
  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @Length(10, 500)
  reason: string;

  @ApiProperty({ minLength: 8, maxLength: 100 })
  @IsString()
  @Length(8, 100)
  idempotency_key: string;
}

export class PlatformSchoolBillingDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() status: string;
  @ApiProperty({ nullable: true, type: String }) status_reason: string | null;
  @ApiProperty() deleted: boolean;
  @ApiProperty() seats_entitled: number;
  @ApiProperty() seats_used: number;
  @ApiProperty({ nullable: true, type: String, description: 'Last covered day, ISO date.' })
  paid_until: string | null;
  @ApiProperty() pending_orders: number;
}

export class PlatformSchoolBillingPageDto {
  @ApiProperty({ type: [PlatformSchoolBillingDto] }) items: PlatformSchoolBillingDto[];
  @ApiProperty({ description: 'Rows matching the search and filter, before paging.' })
  total: number;
}

export class PlatformSchoolBillingDetailDto extends PlatformSchoolBillingDto {
  @ApiProperty({ type: 'array', items: { type: 'object' }, description: 'SeatOrderDto[]' })
  orders: unknown[];
}

export class OfflinePaymentResultDto {
  @ApiProperty({ description: 'false when the order was already paid.' }) applied: boolean;
  @ApiProperty() school_id: string;
}

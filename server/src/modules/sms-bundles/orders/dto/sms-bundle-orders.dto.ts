import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import type { SmsBundleOrderStatus } from '@biddaloy/shared';

/** Rule 25: the client makes the key; a retry with the same key returns the first order. */
export class CreateSmsBundleOrderDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  package_id!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  idempotency_key!: string;
}

/** Rule 5: `limit` is capped at 100. */
export class ListSmsBundleOrdersQueryDto {
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

/** Money is a string of whole paisa (bigint), never a JS number. */
export interface SmsBundleOrderViewDto {
  id: string;
  packageId: string;
  name: string;
  smsCount: number;
  validityDays: number;
  pricePaisa: string;
  costPaisaPerSms: string | null;
  status: SmsBundleOrderStatus;
  createdAt: string;
  paidAt: string | null;
  cancelledAt: string | null;
}

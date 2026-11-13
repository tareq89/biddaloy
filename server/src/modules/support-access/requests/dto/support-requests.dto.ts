import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

export enum SupportRequestListStatus {
  PENDING = 'pending',
  DECIDED = 'decided',
}

/** Rule 5: limit is capped at 100. */
export const SUPPORT_REQUESTS_LIMIT_MAX = 100;

export class ListSupportRequestsQueryDto {
  @ApiPropertyOptional({
    enum: SupportRequestListStatus,
    default: SupportRequestListStatus.PENDING,
  })
  @IsOptional()
  @IsEnum(SupportRequestListStatus)
  status?: SupportRequestListStatus;

  @ApiPropertyOptional({ minimum: 1, maximum: SUPPORT_REQUESTS_LIMIT_MAX, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(SUPPORT_REQUESTS_LIMIT_MAX)
  limit?: number;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page?: number;
}

export class SupportRequestItemDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['ASK', 'WRITE'] }) kind!: 'ASK' | 'WRITE';
  @ApiProperty() ownerName!: string;
  @ApiProperty() role!: string;
  @ApiProperty() personName!: string;
  @ApiProperty() reason!: string;
  @ApiProperty() requestedAt!: string;
  @ApiProperty({ nullable: true, type: String }) expiresAt!: string | null;
  @ApiProperty({ enum: ['REQUESTED', 'APPROVED', 'DENIED', 'EXPIRED'] })
  status!: 'REQUESTED' | 'APPROVED' | 'DENIED' | 'EXPIRED';
}

export class SupportRequestDecisionDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['APPROVED', 'DENIED'] }) status!: 'APPROVED' | 'DENIED';
}

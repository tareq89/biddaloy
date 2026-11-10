import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export const PLATFORM_APPROVAL_STATUSES = [
  'PENDING',
  'GRANTED',
  'DENIED',
  'USED',
  'EXPIRED',
] as const;
export type PlatformApprovalStatus = (typeof PLATFORM_APPROVAL_STATUSES)[number];

export class ListPlatformApprovalsQueryDto {
  @ApiProperty({ required: false, enum: PLATFORM_APPROVAL_STATUSES })
  @IsOptional()
  @IsIn(PLATFORM_APPROVAL_STATUSES)
  status?: PlatformApprovalStatus;

  /** Rule 5: capped at 100. */
  @ApiProperty({ required: false, minimum: 1, maximum: 100, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export interface PlatformApprovalRow {
  id: string;
  scope: string;
  summary: Record<string, unknown>;
  status: PlatformApprovalStatus;
  requested_by: string;
  decided_by: string | null;
  decided_at: Date | null;
  expires_at: Date;
  created_at: Date;
}

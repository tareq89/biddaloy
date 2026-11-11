import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** D11: the school sees the last 90 days. Rule 5: limit is capped at 100. */
export const SUPPORT_SESSIONS_DAYS_MAX = 90;
export const SUPPORT_SESSIONS_LIMIT_MAX = 100;

/** Query of both lists. A value above a cap is a 400, never clamped. */
export class SupportViewQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: SUPPORT_SESSIONS_DAYS_MAX, default: 90 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(SUPPORT_SESSIONS_DAYS_MAX)
  days?: number;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: SUPPORT_SESSIONS_LIMIT_MAX, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(SUPPORT_SESSIONS_LIMIT_MAX)
  limit?: number;
}

/** One Login as session that was opened (ACTIVE, ENDED or EXPIRED). Requests live in the requests list. */
export class SupportSessionItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() ownerName!: string;
  @ApiProperty() startedAt!: string;
  @ApiProperty({ nullable: true, type: String }) endedAt!: string | null;
  @ApiProperty({ enum: ['ACTIVE', 'ENDED', 'EXPIRED'] }) status!: 'ACTIVE' | 'ENDED' | 'EXPIRED';
  @ApiProperty({ enum: ['NORMAL', 'EMERGENCY'] }) kind!: 'NORMAL' | 'EMERGENCY';
  @ApiProperty() viewOnly!: boolean;
  @ApiProperty() role!: string;
  @ApiProperty() personName!: string;
  @ApiProperty() reason!: string;
  /** Audit rows the session wrote, not counting the start and end rows themselves. */
  @ApiProperty() changedCount!: number;
}

export class PlatformActionItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() at!: string;
  @ApiProperty() actorName!: string;
  /** i18n key, e.g. supportAccess.platformAction.suspended */
  @ApiProperty() label!: string;
  @ApiProperty({ nullable: true, type: String }) reason!: string | null;
}

export class EndSupportSessionResultDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['ACTIVE', 'ENDED', 'EXPIRED'] }) status!: string;
}

import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

export class PlatformOwnerDto {
  @ApiProperty() userId: string;
  @ApiProperty() fullName: string;
  /** Masked: enough to recognise, not to copy. */
  @ApiProperty({ nullable: true }) email: string | null;
  @ApiProperty({ nullable: true }) phone: string | null;
  @ApiProperty({ enum: ['ACTIVE', 'LOCKED'] }) status: 'ACTIVE' | 'LOCKED';
  @ApiProperty({ nullable: true }) lockedAt: string | null;
  @ApiProperty({ nullable: true }) lockedByName: string | null;
  @ApiProperty({ nullable: true }) lastLoginAt: string | null;
  @ApiProperty() mfaEnrolled: boolean;
}

export class PlatformHistoryQueryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Matches(/^[A-Za-z0-9_-]+$/)
  cursor?: string;

  /** Rule 5: capped at 100. */
  @ApiProperty({ required: false, minimum: 1, maximum: 100, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class PlatformHistoryRowDto {
  @ApiProperty() id: string;
  @ApiProperty() action: string;
  @ApiProperty({ nullable: true }) actorName: string | null;
  @ApiProperty() at: string;
  /** Short fixed text per action. Never email, phone, code or token. */
  @ApiProperty() label: string;
}

export class PlatformHistoryPageDto {
  @ApiProperty({ type: [PlatformHistoryRowDto] }) data: PlatformHistoryRowDto[];
  @ApiProperty({ nullable: true }) nextCursor: string | null;
}

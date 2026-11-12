import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export const PLATFORM_SCHOOL_SORTS = ['lastActivity', 'students', 'trialEnd', 'name'] as const;
export type PlatformSchoolSort = (typeof PLATFORM_SCHOOL_SORTS)[number];

/** [Epic 99 #3805] Query for `GET /platform/schools/search`. No `plan` filter: no plan model before Epic 100. */
export class PlatformSchoolSearchQueryDto {
  /** `DELETED` = soft-deleted rows; without it a deleted school never appears. */
  @ApiPropertyOptional({ enum: ['ACTIVE', 'SUSPENDED', 'DELETED'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'SUSPENDED', 'DELETED'])
  status?: 'ACTIVE' | 'SUSPENDED' | 'DELETED';

  @ApiPropertyOptional({ enum: ['active', 'expired'] })
  @IsOptional()
  @IsIn(['active', 'expired'])
  trial?: 'active' | 'expired';

  /** Name, slug or phone. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ enum: PLATFORM_SCHOOL_SORTS })
  @IsOptional()
  @IsIn(PLATFORM_SCHOOL_SORTS)
  sort?: PlatformSchoolSort;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class PlatformSchoolSearchItemDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() slug: string;
  @ApiProperty({ enum: ['ACTIVE', 'SUSPENDED'] }) status: 'ACTIVE' | 'SUSPENDED';
  @ApiProperty({ nullable: true, type: String }) statusReason: string | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty() studentCount: number;
  @ApiProperty({ nullable: true, type: Date }) lastActivityAt: Date | null;
  @ApiProperty({ nullable: true, type: Date }) trialEndsAt: Date | null;
  @ApiProperty({ nullable: true, type: Number }) seatLimit: number | null;
  @ApiProperty({ nullable: true, type: Date }) deletedAt: Date | null;
}

export class PlatformSchoolSearchPageDto {
  @ApiProperty({ type: PlatformSchoolSearchItemDto, isArray: true })
  items: PlatformSchoolSearchItemDto[];
  @ApiProperty() total: number;
}

import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApplicationStatus, ApplicationType } from '@biddaloy/shared';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';

export const APPLICATION_VIEWS = ['inbox', 'mine', 'all'] as const;
export type ApplicationView = (typeof APPLICATION_VIEWS)[number];

/** `GET /applications` */
export class QueryApplicationsDto {
  /** Default `mine`. `all` needs APPLICATION_MANAGE. */
  @ApiPropertyOptional({ enum: APPLICATION_VIEWS })
  @IsOptional()
  @IsIn(APPLICATION_VIEWS)
  view?: ApplicationView;

  @ApiPropertyOptional({ enum: ApplicationType, enumName: 'ApplicationType' })
  @IsOptional()
  @IsEnum(ApplicationType)
  type?: ApplicationType;

  @ApiPropertyOptional({ enum: ApplicationStatus, enumName: 'ApplicationStatus' })
  @IsOptional()
  @IsEnum(ApplicationStatus)
  status?: ApplicationStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString({ strict: true })
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString({ strict: true })
  to?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  class_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  student_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  staff_profile_id?: string;

  /** Applicant or subject name, or a serial (`2026/45`, `2026/0045`, `45`). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @SanitizeText()
  q?: string;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

/** `GET /applications/addressees` */
export class QueryAddresseesDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  student_id?: string;
}

/** `GET /applications/tag-options` */
export class QueryTagOptionsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @SanitizeText()
  q?: string;
}

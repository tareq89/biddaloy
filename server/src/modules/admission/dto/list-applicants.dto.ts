import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { AdmissionApplicantStatus } from '@biddaloy/shared';

const STATUSES: AdmissionApplicantStatus[] = Object.values(
  AdmissionApplicantStatus,
) as AdmissionApplicantStatus[];

/** [27.10] Query filters for `GET /admission/applicants`. */
export class ListApplicantsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  intakeId?: string;

  @ApiPropertyOptional({ enum: STATUSES })
  @IsOptional()
  @IsEnum(STATUSES)
  status?: AdmissionApplicantStatus;

  /** Matches applicant name, reference number or guardian phone. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;
}

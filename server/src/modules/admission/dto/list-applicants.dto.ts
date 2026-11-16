import { Type } from 'class-transformer';
import {
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
import { ApiPropertyOptional } from '@nestjs/swagger';
import { AdmissionApplicantStatus, AdmissionFeeState, AdmissionSource } from '@biddaloy/shared';

const STATUSES: AdmissionApplicantStatus[] = Object.values(
  AdmissionApplicantStatus,
) as AdmissionApplicantStatus[];

const FEE_STATES = Object.values(AdmissionFeeState);
const SOURCES = Object.values(AdmissionSource);
export const APPLICANT_SORTS = ['newest', 'roll'] as const;

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

  @ApiPropertyOptional({ enum: FEE_STATES, enumName: 'AdmissionFeeState' })
  @IsOptional()
  @IsIn(FEE_STATES)
  fee_state?: AdmissionFeeState;

  @ApiPropertyOptional({ maxLength: 50, description: 'Applicants carrying this quota tag.' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  quota_tag?: string;

  @ApiPropertyOptional({ enum: SOURCES, enumName: 'AdmissionSource' })
  @IsOptional()
  @IsIn(SOURCES)
  source?: AdmissionSource;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Only applicants in this stage: not FEE_PENDING and past the earlier stage.',
  })
  @IsOptional()
  @IsUUID()
  stage_id?: string;

  @ApiPropertyOptional({ enum: APPLICANT_SORTS, default: 'newest' })
  @IsOptional()
  @IsIn(APPLICANT_SORTS)
  sort?: (typeof APPLICANT_SORTS)[number];

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

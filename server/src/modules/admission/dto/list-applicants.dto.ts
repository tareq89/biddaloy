import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
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
}

import { IsEnum, IsOptional, IsUUID } from 'class-validator';
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
}

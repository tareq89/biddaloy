import { IsString, IsNotEmpty, IsEnum, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { AdmissionEvaluationDecision } from '@biddaloy/shared';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';

const DECISIONS: AdmissionEvaluationDecision[] = ['SHORTLIST', 'ADMIT', 'REJECT'];

/** [27.5] Payload for a reviewer's evaluation of one admission applicant. */
export class EvaluateApplicantDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @SanitizeText()
  notes: string;

  @ApiProperty({ enum: DECISIONS, required: false })
  @IsOptional()
  @IsEnum(DECISIONS)
  decision?: AdmissionEvaluationDecision;
}

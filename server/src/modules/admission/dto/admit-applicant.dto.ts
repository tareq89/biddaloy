import { IsString, IsOptional, IsIn, IsUUID, ValidateIf } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';

/** [27.5] Payload to admit an applicant — an optional note recorded on the
 * `admission_evaluations` row this action writes. */
export class AdmitApplicantDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @SanitizeText()
  notes?: string;

  /** Required (server-enforced) when the applicant's phone matches an existing guardian. */
  @ApiProperty({ required: false, enum: ['LINK_EXISTING', 'CREATE_NEW'] })
  @IsOptional()
  @IsIn(['LINK_EXISTING', 'CREATE_NEW'])
  guardian_choice?: 'LINK_EXISTING' | 'CREATE_NEW';

  /** [LIFE-09] Required with `LINK_EXISTING`: the guardian staff were shown
   * (`GET …/guardian-match`). Phones are not unique, so admit links exactly
   * this row, or 409s `GUARDIAN_MATCH_CHANGED` if it no longer matches. */
  @ApiProperty({ required: false, format: 'uuid' })
  @ValidateIf((o: AdmitApplicantDto) => o.guardian_choice === 'LINK_EXISTING')
  @IsUUID()
  guardian_id?: string;
}

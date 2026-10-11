import { IsString, IsOptional, IsIn } from 'class-validator';
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
}

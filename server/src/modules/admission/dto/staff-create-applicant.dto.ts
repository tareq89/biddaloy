import { ApiProperty, OmitType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { AdmissionPayMethod, PhotoConsent } from '@biddaloy/shared';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { SubmitApplicantDto } from './submit-applicant.dto';

const toBool = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

/**
 * `POST /admission/applicants` (staff, multipart). The public fields minus the captcha, the
 * honeypot and the resubmission reference; plus the walk-in fee proof. The proof file goes in
 * the `fee_proof` part.
 */
export class StaffCreateApplicantDto extends OmitType(SubmitApplicantDto, [
  'captcha_token',
  'middle_name_confirm',
  'reference_number',
  'photo_consent',
] as const) {
  /** Walk-in: the clerk may not have asked yet; a missing value stays NULL (shown as UNKNOWN at admit). */
  @ApiProperty({ required: false, enum: [PhotoConsent.GIVEN, PhotoConsent.REFUSED] })
  @IsOptional()
  @IsIn([PhotoConsent.GIVEN, PhotoConsent.REFUSED])
  photo_consent?: PhotoConsent.GIVEN | PhotoConsent.REFUSED;

  @ApiProperty({ required: false, enum: Object.values(AdmissionPayMethod) })
  @IsOptional()
  @IsIn(Object.values(AdmissionPayMethod))
  fee_method?: AdmissionPayMethod;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  fee_reference?: string;

  @ApiProperty({ required: false, description: 'Let a late walk-in past the close date.' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  allow_after_close?: boolean;
}

import { ApiProperty } from '@nestjs/swagger';
import { AdmissionPayMethod } from '@biddaloy/shared';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { SubmitApplicantDto } from '../../admission/dto/submit-applicant.dto';

/**
 * [#4187] The school-site form: the public fields plus optional fee proof. The proof file goes in
 * the `fee_proof` multipart part. Required only when the round has a fee (checked in the service).
 */
export class PublicSiteSubmitApplicantDto extends SubmitApplicantDto {
  @ApiProperty({ required: false, enum: Object.values(AdmissionPayMethod) })
  @IsOptional()
  @IsIn(Object.values(AdmissionPayMethod))
  fee_method?: AdmissionPayMethod;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  fee_reference?: string;
}

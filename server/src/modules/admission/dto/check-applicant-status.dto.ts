import { IsString, Length } from 'class-validator';

/**
 * [27.7] `POST /public/admission/:slug/status`. Guardian phone is the
 * second factor alongside the reference number, so a caller can't just
 * enumerate reference numbers to look up other applicants' status.
 */
export class CheckApplicantStatusDto {
  @IsString()
  @Length(1, 50)
  reference_number: string;

  @IsString()
  @Length(6, 20)
  guardian_phone: string;
}

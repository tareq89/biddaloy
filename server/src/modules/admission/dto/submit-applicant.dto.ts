import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';

/**
 * [27.2] `POST /public/admission/:slug/applicants` — multipart body from an
 * unauthenticated guardian/applicant. `honeypot` is a decoy field a real
 * form never renders visibly (CSS-hidden in the client) — a bot filling
 * every field fills this too. The controller checks it and, if non-empty,
 * returns 200 without persisting anything, so the bot can't tell it was
 * caught (see `AdmissionApplicantService.submit`).
 */
export class SubmitApplicantDto {
  @IsUUID()
  intake_id: string;

  @IsString()
  @Length(1, 200)
  applicant_name: string;

  @IsString()
  date_of_birth: string;

  @IsString()
  @IsIn(['MALE', 'FEMALE', 'OTHER'])
  gender: string;

  @IsString()
  @Length(1, 200)
  guardian_name: string;

  @IsString()
  @Length(6, 20)
  guardian_phone: string;

  @IsOptional()
  @IsEmail()
  guardian_email?: string;

  @IsOptional()
  @IsString()
  home_address?: string;

  /** Honeypot — must stay empty on a genuine submission. Named to look like
   * a plausible real field to a bot, not something a bot would skip. */
  @IsOptional()
  @IsString()
  middle_name_confirm?: string;
}

export class SubmitApplicantResponseDto {
  @ApiProperty() reference_number: string;
  @ApiProperty() status: string;
}

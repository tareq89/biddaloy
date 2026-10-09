import { ApiProperty } from '@nestjs/swagger';
import {
  IsDateString,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';

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

  @IsDateString()
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
  @MaxLength(200)
  guardian_email?: string;

  @IsOptional()
  @IsString()
  home_address?: string;

  /** Honeypot — must stay empty on a genuine submission. Named to look like
   * a plausible real field to a bot, not something a bot would skip. */
  @IsOptional()
  @IsString()
  middle_name_confirm?: string;

  /** Proof of ownership when resubmitting against an existing PENDING
   * application for the same (intake, guardian_phone) — knowing the phone
   * number alone must not let a caller overwrite someone else's pending
   * application (a phone number isn't secret, and `intake_id` is public
   * via `GET /public/admission/:slug`). Omit on a first submission. */
  @IsOptional()
  @IsString()
  @Length(1, 50)
  reference_number?: string;
}

export class SubmitApplicantResponseDto {
  @ApiProperty() reference_number: string;
  @ApiProperty() status: string;
}

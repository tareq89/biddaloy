import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Starting enrolment needs BOTH codes: one by SMS and one by email (D7). */
export class CockpitEnrolStartDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  enrolToken: string;

  @IsString()
  @MinLength(1)
  @MaxLength(16)
  smsCode: string;

  @IsString()
  @MinLength(1)
  @MaxLength(16)
  emailCode: string;
}

export class CockpitEnrolConfirmDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  enrolToken: string;

  /** The first code from the new authenticator. */
  @IsString()
  @MinLength(1)
  @MaxLength(16)
  code: string;

  @IsOptional()
  @IsBoolean()
  rememberDevice?: boolean;
}

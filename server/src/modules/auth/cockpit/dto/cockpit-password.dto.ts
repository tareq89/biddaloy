import { IsString, MaxLength, MinLength } from 'class-validator';
import { PASSWORD_MIN_LENGTH } from '../../password-policy';

export class CockpitForgotPasswordDto {
  /** The owner's email or phone number. */
  @IsString()
  @MaxLength(100)
  identifier: string;
}

export class CockpitResetPasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  token: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(200)
  newPassword: string;
}

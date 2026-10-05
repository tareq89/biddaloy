import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { INTERNATIONAL_PHONE_REGEX } from '../../users/dto/users.dto';
import { LoginResponseDto } from '../../auth/dto/auth-response.dto';
import { EMAIL_OR_PHONE_REGEX, latinDigits } from './otp-request.dto';

/** Body of `POST /auth/otp/verify` — same identifier the code was sent to, plus the 6-digit code. */
export class OtpVerifyDto {
  @ApiProperty({
    required: false,
    description: 'The phone number or email the code was sent to. Either `identifier` or `phone`.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(254)
  @Transform(latinDigits)
  @Matches(EMAIL_OR_PHONE_REGEX, { message: 'Invalid email or phone format' })
  identifier?: string;

  @ApiProperty({ required: false, description: 'Alias of `identifier` for older clients.' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Transform(latinDigits)
  @Matches(INTERNATIONAL_PHONE_REGEX, { message: 'Invalid phone format' })
  phone?: string;

  @ApiProperty({ description: 'The 6-digit code sent by SMS or email.' })
  @IsString()
  @Matches(/^[0-9০-৯]{6}$/, { message: 'otp must be a 6-digit code' })
  otp: string;
}

/** A normal sign-in response plus what the client needs to prompt for a first password. */
export class OtpLoginResponseDto extends LoginResponseDto {
  @ApiProperty({ description: 'True when the account has no password yet.' })
  needs_password: boolean;

  @ApiProperty({
    description:
      'True when a first password must be set: no password yet, staff rules apply, and no social sign-in is linked.',
  })
  password_required: boolean;
}

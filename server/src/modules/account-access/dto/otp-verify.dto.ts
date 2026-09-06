import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength } from 'class-validator';
import { INTERNATIONAL_PHONE_REGEX } from '../../users/dto/users.dto';

/** Body of `POST /auth/otp/verify` — same phone the code was sent to, plus the 6-digit code. */
export class OtpVerifyDto {
  @ApiProperty({ description: 'The phone number the OTP was sent to.' })
  @IsString()
  @MaxLength(20)
  @Matches(INTERNATIONAL_PHONE_REGEX, { message: 'Invalid phone format' })
  phone: string;

  @ApiProperty({ description: 'The 6-digit OTP sent by SMS.' })
  @IsString()
  @Matches(/^[0-9০-৯]{6}$/, { message: 'otp must be a 6-digit code' })
  otp: string;
}

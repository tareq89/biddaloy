import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength } from 'class-validator';
import { toLatinDigits } from '../../../common/utils/bengali-digits.util';
import { INTERNATIONAL_PHONE_REGEX } from '../../users/dto/users.dto';

/** Body of `POST /auth/otp/verify` — same phone the code was sent to, plus the 6-digit code. */
export class OtpVerifyDto {
  @ApiProperty({ description: 'The phone number the OTP was sent to.' })
  @IsString()
  @MaxLength(20)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? toLatinDigits(value) : value,
  )
  @Matches(INTERNATIONAL_PHONE_REGEX, { message: 'Invalid phone format' })
  phone: string;

  @ApiProperty({ description: 'The 6-digit OTP sent by SMS.' })
  @IsString()
  @Matches(/^[0-9০-৯]{6}$/, { message: 'otp must be a 6-digit code' })
  otp: string;
}

import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength } from 'class-validator';
import { INTERNATIONAL_PHONE_REGEX } from '../../users/dto/users.dto';

/**
 * Body of `POST /auth/otp/request` — enumeration-safe: the response is
 * identical (202, no body) whether or not `phone` matches an account.
 */
export class OtpRequestDto {
  @ApiProperty({ description: 'The phone number on the account.' })
  @IsString()
  @MaxLength(20)
  @Matches(INTERNATIONAL_PHONE_REGEX, { message: 'Invalid phone format' })
  phone: string;
}

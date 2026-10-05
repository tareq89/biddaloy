import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, Matches } from 'class-validator';

/** Body of `POST /auth/register/verify`. */
export class RegisterVerifyDto {
  @ApiProperty()
  @IsUUID()
  registration_id: string;

  @ApiProperty({ description: 'The 6-digit code sent by SMS or email.' })
  @IsString()
  @Matches(/^[0-9০-৯]{6}$/, { message: 'otp must be a 6-digit code' })
  otp: string;
}

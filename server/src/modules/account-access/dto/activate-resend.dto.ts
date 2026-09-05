import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

/**
 * Body of `POST /auth/activate/resend` — self-service, enumeration-safe:
 * always 202, whether or not `identifier` matches an account, so a caller
 * can never learn "does an account with this email/phone exist" from the
 * response.
 */
export class ActivateResendDto {
  @ApiProperty({ description: 'The email or phone number on the account.' })
  @IsString()
  @MaxLength(100)
  identifier: string;
}

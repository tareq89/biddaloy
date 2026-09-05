import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

/**
 * Body of `POST /auth/forgot-password` — enumeration-safe: the response is
 * identical (202, no body) whether or not `identifier` matches an account.
 * `identifier` may be an email or a phone number; `RecoveryService.forgot`
 * decides which channel to use based on which field on the user actually
 * matched.
 */
export class ForgotPasswordDto {
  @ApiProperty({ description: 'The email or phone number on the account.' })
  @IsString()
  @MaxLength(100)
  identifier: string;
}

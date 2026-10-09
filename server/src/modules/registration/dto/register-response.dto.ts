import { ApiProperty } from '@nestjs/swagger';
import { LoginResponseDto } from '../../auth/dto/auth-response.dto';
import type { RegisterStartResult, RegisterVerifyResult } from '../registration.service';

/**
 * Swagger metadata for the register routes — see `auth-response.dto.ts` for why these exist.
 * They `implements` the service result types so the two shapes cannot drift.
 */
class RegisterDebugDto {
  @ApiProperty({
    description:
      'The code itself. Only when ACCOUNT_ACCESS_ECHO_SECRETS=true (never in production).',
  })
  otp: string;
}

export class RegisterStartResponseDto implements RegisterStartResult {
  @ApiProperty({ format: 'uuid', description: 'Pass back to resend and verify.' })
  registration_id: string;

  @ApiProperty({ enum: ['sms', 'email'], description: 'Where the code was sent.' })
  channel: 'sms' | 'email';

  @ApiProperty({ description: 'Seconds until resend is allowed.' })
  resend_in: number;

  @ApiProperty({ type: RegisterDebugDto, required: false })
  debug?: RegisterDebugDto;
}

export class RegisterVerifyResponseDto extends LoginResponseDto implements RegisterVerifyResult {
  @ApiProperty({ description: 'The new admin has no password yet.' })
  needs_password: boolean;

  @ApiProperty({ description: 'needs_password, and no social sign-in was linked to fall back on.' })
  password_required: boolean;
}

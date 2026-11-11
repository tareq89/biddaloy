import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

/** [99.2.02] `randomBytes(32)` as base64url is always 43 characters. */
export class ImpersonationExchangeDto {
  @ApiProperty({ description: 'The one-time code handed over by the cockpit.' })
  @Matches(/^[A-Za-z0-9_-]{43}$/, { message: 'code is invalid' })
  code: string;
}

import { ApiProperty } from '@nestjs/swagger';

/** Empty by design: validation rejects every caller-supplied field. */
export class AdminResetPasswordDto {}

export class AdminResetPasswordResponseDto {
  @ApiProperty()
  temporary_password: string;

  @ApiProperty({ format: 'date-time' })
  expires_at: string;
}

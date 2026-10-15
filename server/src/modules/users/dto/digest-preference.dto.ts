import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

/** [8.10.7.5.11] Body and response of PATCH /users/me/preferences/digest. */
export class DigestPreferenceDto {
  @ApiProperty()
  @IsBoolean()
  enabled: boolean;
}

/** The one place that decides "morning summary is on unless switched off". */
export function digestEnabled(preferences: Record<string, any> | null | undefined): boolean {
  return preferences?.digest?.enabled !== false;
}

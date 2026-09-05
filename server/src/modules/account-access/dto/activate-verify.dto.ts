import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

/**
 * Body of `POST /auth/activate/verify` — the read-only "is this link still
 * good, and whose is it" check `activate.tsx` (client-admin) makes on load,
 * before showing the set-password form. `Length(20, 200)` bounds a raw
 * `auth_tokens` secret (see `token-hash.util.ts`'s `generateSecret`) without
 * hard-coding its exact length here.
 */
export class ActivateVerifyDto {
  @ApiProperty({ description: 'The raw invite token from the ?token= query param.' })
  @IsString()
  @Length(20, 200)
  token: string;
}

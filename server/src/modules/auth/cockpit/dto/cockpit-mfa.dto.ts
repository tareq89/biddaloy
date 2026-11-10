import { IsString, MaxLength, MinLength } from 'class-validator';

/** `code` is an authenticator code (6 digits) or a recovery code. */
export class CockpitMfaDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  mfaToken: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  code: string;
}

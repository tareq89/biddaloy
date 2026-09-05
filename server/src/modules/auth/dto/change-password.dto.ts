import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';
import { PASSWORD_MIN_LENGTH } from '../password-policy';

/**
 * Body of `POST /auth/change-password`.
 *
 * There is deliberately **no** user id field: the endpoint always acts on
 * the authenticated caller (`JwtPayload.sub`), so one user can never target
 * another's account. The global validation pipe runs with
 * `forbidNonWhitelisted: true`, so a smuggled `user_id` is a 400, not a
 * silently-ignored extra.
 *
 * `new_password` enforces the shared password policy (D7, epic #409) —
 * `PASSWORD_MIN_LENGTH`, the same minimum `account-access`'s `ActivateDto`
 * uses, so the two endpoints that ever set a password agree.
 * `current_password` stays `@MinLength(1)`: it only proves possession of
 * whatever password already exists, which may predate this policy.
 */
export class ChangePasswordDto {
  @ApiProperty({ description: "The caller's current password, re-entered to prove possession." })
  @IsString()
  @MinLength(1)
  current_password: string;

  @ApiProperty({ description: 'The new password to store.', minLength: PASSWORD_MIN_LENGTH })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  new_password: string;
}

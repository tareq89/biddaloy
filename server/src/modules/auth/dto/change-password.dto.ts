import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

/**
 * Body of `POST /auth/change-password`.
 *
 * There is deliberately **no** user id field: the endpoint always acts on
 * the authenticated caller (`JwtPayload.sub`), so one user can never target
 * another's account. The global validation pipe runs with
 * `forbidNonWhitelisted: true`, so a smuggled `user_id` is a 400, not a
 * silently-ignored extra.
 *
 * `@MinLength(1)` matches `LoginDto.password` — the strictest password rule
 * that currently exists in this codebase. There is no password-strength
 * policy anywhere yet (registration's password is merely
 * `@IsOptional() @IsString()`); introducing one is a product decision that
 * belongs in its own issue, applied to registration and this endpoint at
 * the same time so the two can't disagree.
 */
export class ChangePasswordDto {
  @ApiProperty({ description: "The caller's current password, re-entered to prove possession." })
  @IsString()
  @MinLength(1)
  current_password: string;

  @ApiProperty({ description: 'The new password to store.' })
  @IsString()
  @MinLength(1)
  new_password: string;
}

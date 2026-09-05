import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, MaxLength, MinLength } from 'class-validator';
import { PASSWORD_MIN_LENGTH } from '../../auth/password-policy';

/**
 * Body of `POST /auth/activate`. `password` enforces the same D7 policy
 * (`PASSWORD_MIN_LENGTH`) as `ChangePasswordDto.new_password` — the two
 * endpoints that ever set a password agree on one minimum.
 */
export class ActivateDto {
  @ApiProperty({ description: 'The raw invite token from the ?token= query param.' })
  @IsString()
  @Length(20, 200)
  token: string;

  @ApiProperty({ description: 'The password to set.', minLength: PASSWORD_MIN_LENGTH })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(200)
  password: string;
}

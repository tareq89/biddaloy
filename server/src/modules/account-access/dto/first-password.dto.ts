import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { PASSWORD_MIN_LENGTH } from '../../auth/password-policy';

/** Body of `POST /auth/first-password` (role rules are checked by the service). */
export class FirstPasswordDto {
  @ApiProperty({ description: 'The first password to set.', minLength: PASSWORD_MIN_LENGTH })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(200)
  password: string;
}

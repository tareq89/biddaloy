import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class CompletePasswordResetDto {
  @ApiProperty({ maxLength: 4096 })
  @IsString()
  @MaxLength(4096)
  reset_token: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  new_password: string;
}

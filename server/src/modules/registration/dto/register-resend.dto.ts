import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/** Body of `POST /auth/register/resend`. */
export class RegisterResendDto {
  @ApiProperty()
  @IsUUID()
  registration_id: string;
}

import { IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** Body for `POST /schools/:id/revive` (Epic 49 D5). The reason is audited. */
export class ReviveSchoolDto {
  @ApiProperty({ minLength: 5, maxLength: 500 })
  @IsString()
  @Length(5, 500)
  reason: string;
}

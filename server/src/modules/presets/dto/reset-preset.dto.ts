import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

/** Body for `POST /platform/schools/:id/preset/reset`. A reason is mandatory and audited. */
export class ResetPresetDto {
  @ApiProperty({ minLength: 10, maxLength: 500 })
  @IsString()
  @Length(10, 500)
  reason: string;
}

export class ResetPresetResponseDto {
  @ApiProperty({ description: 'Rows removed per table, e.g. { classes: 3 }.' })
  deleted: Record<string, number>;
}

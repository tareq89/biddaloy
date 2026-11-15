import { IsIn, IsString, Matches, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { IsRealDate } from '../../../common/decorators/is-real-date.decorator';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';

export const ROLL_ORDERS = ['APPLIED_AT', 'NAME'] as const;
export type RollOrder = (typeof ROLL_ORDERS)[number];

export class AssignRollsDto {
  @ApiProperty({ enum: ROLL_ORDERS, enumName: 'AdmissionRollOrder' })
  @IsIn(ROLL_ORDERS)
  order: RollOrder;
}

export class AssignRollsResponseDto {
  @ApiProperty({ description: 'Applicants who got a roll in this call.' })
  assigned: number;

  @ApiProperty({ type: String, nullable: true })
  first_roll: string | null;

  @ApiProperty({ type: String, nullable: true })
  last_roll: string | null;
}

export class StageScheduleDto {
  @ApiProperty({ example: '2026-12-01' })
  @IsRealDate()
  date: string;

  @ApiProperty({ example: '10:30', description: '24-hour HH:MM' })
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'start_time must be HH:MM' })
  start_time: string;

  @ApiProperty({ example: 'Main hall' })
  @IsString()
  @MaxLength(200)
  @SanitizeText()
  venue: string;
}

export class StageScheduleResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  date: string;

  @ApiProperty()
  start_time: string;

  @ApiProperty()
  venue: string;
}

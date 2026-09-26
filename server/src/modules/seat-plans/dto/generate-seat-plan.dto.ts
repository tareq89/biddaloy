import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, IsEnum, IsString, IsUUID, Length } from 'class-validator';
import { SeatOrderMode } from '@biddaloy/shared';

/** Body for `POST /seat-plans/generate` (#25.4). */
export class GenerateSeatPlanDto {
  @ApiProperty()
  @IsString()
  @Length(1, 200)
  name: string;

  @ApiProperty({ type: [String] })
  @IsUUID('4', { each: true })
  @ArrayMinSize(1)
  exam_schedule_ids: string[];

  @ApiProperty({ type: [String] })
  @IsUUID('4', { each: true })
  @ArrayMinSize(1)
  room_ids: string[];

  @ApiProperty({ enum: SeatOrderMode })
  @IsEnum(SeatOrderMode)
  seat_order_mode: SeatOrderMode;
}

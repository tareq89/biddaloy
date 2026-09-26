import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Length } from 'class-validator';

/** Body for `PATCH /seat-plans/:id/allocations/:allocationId` — move one student to a different room/seat (DRAFT only). */
export class UpdateAllocationDto {
  @ApiProperty()
  @IsUUID()
  room_id: string;

  @ApiProperty()
  @IsString()
  @Length(1, 20)
  seat_number: string;
}

/**
 * Body for `PATCH /seat-plans/:id/rooms/:roomId/invigilator` (D8) — set or
 * clear the room's invigilator. No dedicated file in the ticket's `## Files`
 * list, so it rides along here rather than adding a fourth dto file.
 */
export class UpdateInvigilatorDto {
  @ApiProperty({ nullable: true })
  @IsOptional()
  @IsUUID()
  invigilator_user_id: string | null;
}

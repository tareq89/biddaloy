import { ApiProperty } from '@nestjs/swagger';

/** One class the teacher has today. Times are `HH:mm` strings (the cache stores JSON). */
export class MyRoutinePeriodDto {
  @ApiProperty({ example: '10:30' }) starts_at: string;
  @ApiProperty({ example: '11:10' }) ends_at: string;
  @ApiProperty() section_id: string;
  @ApiProperty({ example: '7th' }) class_name: string;
  @ApiProperty({ example: 'B' }) section_name: string;
  @ApiProperty({ nullable: true, type: String }) subject_name_en: string | null;
  @ApiProperty({ nullable: true, type: String }) subject_name_bn: string | null;
  @ApiProperty({ nullable: true, type: String, example: 'Main 202' }) room_label: string | null;
  /** The teacher is (assistant) class teacher of this section. */
  @ApiProperty() is_homeroom: boolean;
  /** The teacher covers someone else's period today. */
  @ApiProperty() covering: boolean;
  @ApiProperty() cancelled: boolean;
}

export class MyRoutineNextDayDto {
  @ApiProperty({ example: '2026-10-08' }) date: string;
  @ApiProperty({ example: '08:00' }) starts_at: string;
  @ApiProperty() class_name: string;
  @ApiProperty() section_name: string;
  @ApiProperty({ nullable: true, type: String }) subject_name_en: string | null;
  @ApiProperty({ nullable: true, type: String }) subject_name_bn: string | null;
}

export class MyRoutineTodayDto {
  @ApiProperty({ example: '2026-10-07' }) date: string;
  @ApiProperty() is_working_day: boolean;
  @ApiProperty({ type: [MyRoutinePeriodDto] }) periods: MyRoutinePeriodDto[];
  @ApiProperty({ nullable: true, type: MyRoutineNextDayDto }) next_day: MyRoutineNextDayDto | null;
}

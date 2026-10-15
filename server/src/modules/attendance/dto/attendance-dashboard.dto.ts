import { ApiProperty } from '@nestjs/swagger';

export class AttendanceTodayCountsDto {
  @ApiProperty() present!: number;
  @ApiProperty() late!: number;
  @ApiProperty() absent!: number;
  @ApiProperty() leave!: number;
  @ApiProperty() unmarked!: number;
}

export class AttendancePendingSectionDto {
  @ApiProperty({ format: 'uuid' }) section_id!: string;
  @ApiProperty() class_name!: string;
  @ApiProperty() section_name!: string;
}

export class AttendanceSeriesPointDto {
  @ApiProperty({ example: '2026-10-07' }) date!: string;
  @ApiProperty({ type: Number, nullable: true, description: 'null = no register that day' })
  percentage!: number | null;
}

export class AttendanceTodayWidgetDto {
  @ApiProperty({ example: '2026-10-07' }) date!: string;
  @ApiProperty() is_working_day!: boolean;
  @ApiProperty({ type: Number, nullable: true, example: 91.4 }) percentage!: number | null;
  @ApiProperty({ type: AttendanceTodayCountsDto }) counts!: AttendanceTodayCountsDto;
  @ApiProperty() sections_total!: number;
  @ApiProperty({ type: [AttendancePendingSectionDto] })
  pending_sections!: AttendancePendingSectionDto[];
  @ApiProperty({ type: Number, nullable: true }) week_ago_percentage!: number | null;
  @ApiProperty({ type: [AttendanceSeriesPointDto], description: '30 points ending today' })
  series!: AttendanceSeriesPointDto[];
}

export class MyPendingSectionDto {
  @ApiProperty({ format: 'uuid' }) section_id!: string;
  @ApiProperty() class_name!: string;
  @ApiProperty() section_name!: string;
  @ApiProperty() student_count!: number;
  @ApiProperty({ description: "true once today's register is finalised" }) taken!: boolean;
  @ApiProperty({ description: 'Students on the roll with no mark yet today' }) unmarked!: number;
}

export class MyPendingSectionsDto {
  @ApiProperty({ example: '2026-10-07' }) date!: string;
  @ApiProperty() is_working_day!: boolean;
  @ApiProperty() pending_count!: number;
  @ApiProperty({
    type: [MyPendingSectionDto],
    description: 'Not taken first, then class / section',
  })
  sections!: MyPendingSectionDto[];
}

export class StreakSectionDto {
  @ApiProperty({ format: 'uuid' }) section_id!: string;
  @ApiProperty() class_name!: string;
  @ApiProperty() section_name!: string;
}

export class ClassTeacherStreakItemDto {
  @ApiProperty({ format: 'uuid' }) student_id!: string;
  @ApiProperty() student_name!: string;
  @ApiProperty() roll_number!: number;
  @ApiProperty({ description: 'Consecutive absent school days' }) length!: number;
  @ApiProperty({ example: '2026-09-30' }) since_date!: string;
}

export class ClassTeacherStreaksDto {
  @ApiProperty({
    type: StreakSectionDto,
    nullable: true,
    description: 'null = no homeroom section',
  })
  section!: StreakSectionDto | null;
  @ApiProperty({ type: String, nullable: true, example: '2026-10-06' }) as_of_date!: string | null;
  @ApiProperty({ description: 'All students on an absent run, not just the first 10' })
  total!: number;
  @ApiProperty({ type: [ClassTeacherStreakItemDto], description: 'First 10, longest first' })
  items!: ClassTeacherStreakItemDto[];
}

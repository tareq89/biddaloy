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

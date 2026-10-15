import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class QueryAtRiskStudentsDto {
  @ApiPropertyOptional({ default: 5, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class AtRiskThresholdsDto {
  @ApiProperty() absentStreakDays: number;
  @ApiProperty() monthlyAttendancePct: number;
  @ApiProperty() failedSubjects: number;
  @ApiProperty() overdueDays: number;
}

export class AtRiskSubjectDto {
  @ApiProperty() name_en: string;
  @ApiProperty({ nullable: true, type: String }) name_bn: string | null;
}

export class AtRiskSignalDto {
  @ApiProperty({ enum: ['ABSENT_STREAK', 'LOW_ATTENDANCE', 'FAILED_SUBJECTS', 'OVERDUE'] })
  kind: 'ABSENT_STREAK' | 'LOW_ATTENDANCE' | 'FAILED_SUBJECTS' | 'OVERDUE';

  @ApiProperty({
    description:
      'ABSENT_STREAK: days in the run. LOW_ATTENDANCE: % over the last 30 days. FAILED_SUBJECTS: count. OVERDUE: days since the oldest overdue bill.',
  })
  value: number;

  @ApiPropertyOptional({ type: [AtRiskSubjectDto], description: 'FAILED_SUBJECTS only.' })
  subjects?: AtRiskSubjectDto[];
}

export class AtRiskStudentDto {
  @ApiProperty() student_id: string;
  @ApiProperty() full_name: string;
  @ApiProperty() class_name: string;
  @ApiProperty() section_name: string;
  @ApiProperty({ type: [AtRiskSignalDto] }) signals: AtRiskSignalDto[];
}

export class AtRiskStudentsWidgetDto {
  @ApiProperty({ enum: ['READY', 'COMPUTING'] }) state: 'READY' | 'COMPUTING';
  @ApiProperty({ nullable: true, type: String, description: 'ISO time of the last compute.' })
  computed_at: string | null;
  @ApiProperty({ description: 'True when the school thresholds changed since the last compute.' })
  stale: boolean;
  @ApiProperty({ type: AtRiskThresholdsDto }) thresholds: AtRiskThresholdsDto;
  @ApiProperty() total: number;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'null until a week-old snapshot exists.',
  })
  week_ago_total: number | null;
  @ApiProperty({ nullable: true, type: Number }) new_this_week: number | null;
  @ApiProperty({ type: [AtRiskStudentDto] }) students: AtRiskStudentDto[];
}

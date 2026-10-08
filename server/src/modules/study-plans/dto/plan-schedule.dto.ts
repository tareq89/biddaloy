import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsUUID } from 'class-validator';
import { ListStudyPlansQueryDto } from './study-plan.dto';

/** [66.2.02/#2007] Capacity: how many periods a plan still needs vs has left (D36). */
export class PlanCapacityDto {
  @ApiProperty({ description: 'Non-excluded periods still ahead (today included).' })
  periods_left: number;

  @ApiProperty({ description: 'Remaining periods of the lessons not yet done.' })
  periods_needed: number;

  @ApiProperty({ description: 'periods_needed <= periods_left.' })
  fits: boolean;
}

/** The count fields the plan list and the schedule both carry. */
export class PlanSummaryDto {
  @ApiProperty() lessons_done: number;
  @ApiProperty() lessons_total: number;
  @ApiProperty({ description: 'Owed by today minus taught; negative means ahead.' })
  periods_behind: number;
  @ApiProperty() lessons_behind: number;
  @ApiProperty() unreported_periods: number;
  @ApiProperty() unreported_school_days: number;
  @ApiProperty({ nullable: true, type: String }) oldest_unreported_date: string | null;
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Latest human-written delivery row for the section and subject (D44).',
  })
  last_reported_at: string | null;
  @ApiProperty({ type: PlanCapacityDto }) capacity: PlanCapacityDto;
  @ApiProperty({ description: 'No PUBLISHED routine for the plan year (D14 empty state).' })
  routine_missing: boolean;
}

export class SchedulePeriodDto {
  @ApiProperty() date: string;
  @ApiProperty() period_slot_id: string;
  @ApiProperty({ enum: ['ROUTINE', 'EXTRA'] }) kind: 'ROUTINE' | 'EXTRA';
  @ApiProperty({
    enum: ['TAUGHT', 'PARTLY', 'NOT_TAUGHT', 'UNREPORTED', 'FUTURE', 'EXCLUDED'],
  })
  status: 'TAUGHT' | 'PARTLY' | 'NOT_TAUGHT' | 'UNREPORTED' | 'FUTURE' | 'EXCLUDED';
  @ApiPropertyOptional() reason?: string;
  @ApiProperty({ nullable: true, type: String }) lesson_id: string | null;
  @ApiPropertyOptional() routine_slot_id?: string;
  @ApiPropertyOptional() substitute_teacher_id?: string;
}

export class ScheduleLessonDto {
  @ApiProperty() id: string;
  @ApiProperty() title: string;
  @ApiProperty() periods: number;
  @ApiProperty() taught_periods: number;
  @ApiProperty({ enum: ['DONE', 'IN_PROGRESS', 'UPCOMING'] })
  status: 'DONE' | 'IN_PROGRESS' | 'UPCOMING';
  @ApiProperty({ nullable: true, type: String }) expected_date: string | null;
  @ApiProperty({ nullable: true, type: String }) expected_end_date: string | null;
  @ApiProperty({ description: 'Does not fully fit before the range ends.' }) overflow: boolean;
  @ApiProperty() in_extra_class: boolean;
}

export class PlanRangeDto {
  @ApiProperty() from: string;
  @ApiProperty() to: string;
}

export class PlanScheduleResponseDto {
  @ApiProperty({ type: PlanRangeDto }) range: PlanRangeDto;
  @ApiProperty() today: string;
  @ApiProperty({ type: [SchedulePeriodDto] }) periods: SchedulePeriodDto[];
  @ApiProperty({ type: [ScheduleLessonDto] }) lessons: ScheduleLessonDto[];
  @ApiProperty({ type: PlanSummaryDto }) summary: PlanSummaryDto;
}

export class CarryOverLessonDto {
  @ApiProperty() id: string;
  @ApiProperty() title: string;
  @ApiProperty() periods: number;
  @ApiPropertyOptional() topic_id?: string;
  @ApiPropertyOptional() notes?: string;
}

export class CarryOverFromTermDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
}

export class CarryOverResponseDto {
  @ApiProperty({ type: [CarryOverLessonDto] }) lessons: CarryOverLessonDto[];
  @ApiProperty({ nullable: true, type: CarryOverFromTermDto })
  from_term: CarryOverFromTermDto | null;
}

export class PlanCapacityQueryDto {
  @IsUUID() section_id: string;
  @IsUUID() subject_id: string;
  @IsOptional() @IsUUID() academic_term_id?: string;
}

export class PlanCapacityResponseDto {
  @ApiProperty() periods_total: number;
  @ApiProperty() periods_left: number;
  @ApiProperty({ type: PlanRangeDto }) range: PlanRangeDto;
}

/** `GET /study-plans` query: the base filters plus the computed-field filter and sort. */
export class ListStudyPlansWithSummaryQueryDto extends ListStudyPlansQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  behind?: boolean;

  @IsOptional() @IsIn(['behind_periods', 'section', 'subject']) sort?: string;
  @IsOptional() @IsIn(['asc', 'desc']) order?: 'asc' | 'desc';
}

class PlanListSectionDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() class_id: string;
  @ApiProperty() class_name: string;
}

class PlanListSubjectDto {
  @ApiProperty() id: string;
  @ApiProperty() name_en: string;
  @ApiProperty({ nullable: true, type: String }) name_bn: string | null;
  @ApiProperty() code: string;
}

class PlanListTermDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
}

/** One row of `GET /study-plans`: the plan base fields plus its progress summary. */
export class PlanListRowDto {
  @ApiProperty() id: string;
  @ApiProperty() academic_year_id: string;
  @ApiProperty({ type: PlanListSectionDto }) section: PlanListSectionDto;
  @ApiProperty({ type: PlanListSubjectDto }) subject: PlanListSubjectDto;
  @ApiProperty({ nullable: true, type: PlanListTermDto }) term: PlanListTermDto | null;
  @ApiProperty() lesson_count: number;
  @ApiProperty({ type: PlanSummaryDto }) summary: PlanSummaryDto;
}

export class PlanListResponseDto {
  @ApiProperty({ type: [PlanListRowDto] }) data: PlanListRowDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() totalPages: number;
}

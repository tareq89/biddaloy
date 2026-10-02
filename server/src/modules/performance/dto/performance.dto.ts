import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class PerformanceQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  academicYearId!: string;

  @ApiProperty({ format: 'uuid', required: false })
  @IsOptional()
  @IsUUID()
  termId?: string;
}

export class ClassPerformanceQueryDto extends PerformanceQueryDto {
  @ApiProperty({ format: 'uuid', required: false })
  @IsOptional()
  @IsUUID()
  sectionId?: string;
}

const HOMEWORK_DESCRIPTION =
  'All-time — not filtered by academicYearId/termId; HomeworkAnalyticsService has no date filter. Section rollup counts section-wide assignments only (D24).';

export class HomeworkRollupDto {
  @ApiProperty() totalAssignments!: number;
  @ApiProperty() completed!: number;
  @ApiProperty() defaulters!: number;
  @ApiProperty() completionPercent!: number;
}

export class ClassExamOutcomeDto {
  @ApiProperty() examId!: string;
  @ApiProperty() examName!: string;
  @ApiProperty() appeared!: number;
  @ApiProperty() passRate!: number;
  @ApiProperty({ type: Number, nullable: true }) averageMarks!: number | null;
}

export class StudentExamOutcomeDto {
  @ApiProperty() examId!: string;
  @ApiProperty() examName!: string;
  @ApiProperty() totalMarks!: number;
  @ApiProperty() gpa!: number;
  @ApiProperty() grade!: string;
  @ApiProperty() isFail!: boolean;
}

export class ClassPerformanceResponseDto {
  @ApiProperty() classId!: string;
  @ApiProperty({ type: String, nullable: true }) sectionId!: string | null;
  @ApiProperty() academicYearId!: string;
  @ApiProperty({ type: String, nullable: true }) termId!: string | null;
  @ApiProperty() from!: string;
  @ApiProperty() to!: string;
  @ApiProperty({ type: Number, nullable: true }) passRate!: number | null;
  @ApiProperty({ type: Number, nullable: true }) averageMarks!: number | null;
  @ApiProperty({ type: Number, nullable: true }) attendancePercent!: number | null;
  @ApiProperty({ type: HomeworkRollupDto, description: HOMEWORK_DESCRIPTION })
  homework!: HomeworkRollupDto;
  @ApiProperty({ type: [ClassExamOutcomeDto] }) exams!: ClassExamOutcomeDto[];
}

export class StudentPerformanceResponseDto {
  @ApiProperty() studentId!: string;
  @ApiProperty() classId!: string;
  @ApiProperty({ type: String, nullable: true }) sectionId!: string | null;
  @ApiProperty() academicYearId!: string;
  @ApiProperty({ type: String, nullable: true }) termId!: string | null;
  @ApiProperty() from!: string;
  @ApiProperty() to!: string;
  @ApiProperty({ type: Number, nullable: true }) passRate!: number | null;
  @ApiProperty({ type: Number, nullable: true }) averageMarks!: number | null;
  @ApiProperty({ type: Number, nullable: true }) averageGpa!: number | null;
  @ApiProperty({ type: Number, nullable: true }) attendancePercent!: number | null;
  @ApiProperty({ type: HomeworkRollupDto, description: HOMEWORK_DESCRIPTION })
  homework!: HomeworkRollupDto;
  @ApiProperty({ type: Number, nullable: true }) noteRatingAverage!: number | null;
  @ApiProperty() noteRatingCount!: number;
  @ApiProperty({ type: [StudentExamOutcomeDto] }) exams!: StudentExamOutcomeDto[];
}

export class StaffAcrYearDto {
  @ApiProperty() academicYearId!: string;
  @ApiProperty() status!: string;
  @ApiProperty({ type: Number, nullable: true }) total!: number | null;
}

export class StaffSurveyDto {
  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'All-time (not range-scoped). Null unless a CLOSED survey met min-N (pair and per-question); questions below min-N are left out of the average.',
  })
  averageStars!: number | null;
  @ApiProperty() surveyCount!: number;
}

export class StaffPerformanceResponseDto {
  @ApiProperty() userId!: string;
  @ApiProperty({ type: [StaffAcrYearDto], description: 'All-time, year-over-year.' })
  acr!: StaffAcrYearDto[];
  @ApiProperty({ type: StaffSurveyDto }) survey!: StaffSurveyDto;
  @ApiProperty({ description: 'All-time (not range-scoped).' }) incidentCount!: number;
  @ApiProperty({
    type: [ClassPerformanceResponseDto],
    description: 'Sections whose class belongs to the requested academic year.',
  })
  classes!: ClassPerformanceResponseDto[];
}

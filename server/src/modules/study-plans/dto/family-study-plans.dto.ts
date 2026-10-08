import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

/** [66.2/#2013] Family-facing shapes: progress only, never notes or unreported counts (D20). */

export class FamilySubjectRefDto {
  @ApiProperty() id: string;
  @ApiProperty({ nullable: true, type: String }) name_en: string | null;
  @ApiProperty({ nullable: true, type: String }) name_bn: string | null;
}

export class FamilyLastTaughtDto {
  @ApiProperty({ description: '1-based position in the plan.' }) number: number;
  @ApiProperty() title: string;
  @ApiProperty() date: string;
}

export class FamilyNextLessonDto {
  @ApiProperty() number: number;
  @ApiProperty() title: string;
  @ApiProperty({ nullable: true, type: String }) expected_date: string | null;
}

export class FamilyExamSyllabusDto {
  @ApiProperty() exam_id: string;
  @ApiProperty() exam_name: string;
  @ApiProperty({ nullable: true, type: String }) exam_date: string | null;
  @ApiProperty() lessons_in_syllabus: number;
  @ApiProperty() lessons_taught: number;
}

export class FamilySubjectPlanDto {
  @ApiProperty({ type: FamilySubjectRefDto }) subject: FamilySubjectRefDto;
  @ApiProperty() plan_id: string;
  @ApiProperty({ type: [String] }) teacher_names: string[];
  @ApiProperty({ nullable: true, type: FamilyLastTaughtDto })
  last_taught: FamilyLastTaughtDto | null;
  @ApiProperty({ type: [FamilyNextLessonDto] }) next: FamilyNextLessonDto[];
  @ApiProperty({ nullable: true, type: String }) expected_finish_date: string | null;
  @ApiProperty() periods_behind: number;
  @ApiProperty() lessons_behind: number;
  @ApiProperty() lessons_done: number;
  @ApiProperty() lessons_total: number;
  @ApiProperty({ type: [FamilyExamSyllabusDto] }) exam_syllabus: FamilyExamSyllabusDto[];
}

class FamilyIdNameDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
}

class FamilySectionDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() class_name: string;
}

export class FamilyStudyPlansResponseDto {
  @ApiProperty({ type: FamilySectionDto }) section: FamilySectionDto;
  @ApiProperty({ nullable: true, type: FamilyIdNameDto }) term: FamilyIdNameDto | null;
  @ApiProperty({ type: [FamilySubjectPlanDto] }) subjects: FamilySubjectPlanDto[];
  @ApiProperty({ type: [FamilySubjectRefDto] }) subjects_without_plan: FamilySubjectRefDto[];
}

export class FamilyLessonRefDto {
  @ApiProperty() number: number;
  @ApiProperty() title: string;
  @ApiProperty({ description: 'Which period of the lesson falls on this slot (1-based).' })
  part: number;
  @ApiProperty({ description: 'Periods the lesson takes in total.' }) of: number;
}

export class FamilyDayPeriodDto {
  @ApiProperty() period_slot_id: string;
  @ApiProperty() sequence: number;
  @ApiProperty() starts_at: string;
  @ApiProperty({ type: FamilySubjectRefDto }) subject: FamilySubjectRefDto;
  @ApiProperty() cancelled: boolean;
  @ApiProperty({ nullable: true, type: FamilyLessonRefDto }) lesson: FamilyLessonRefDto | null;
  @ApiProperty({ nullable: true, enum: ['TAUGHT', 'PARTLY', 'NOT_TAUGHT'] })
  status: 'TAUGHT' | 'PARTLY' | 'NOT_TAUGHT' | null;
}

export class FamilyLessonsQueryDto {
  @ApiProperty({ example: '2026-10-15' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date: string;
}

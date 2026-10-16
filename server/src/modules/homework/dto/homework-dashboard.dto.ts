import { ApiProperty } from '@nestjs/swagger';

export class SyllabusClassProgressDto {
  @ApiProperty({ format: 'uuid' }) class_id!: string;
  @ApiProperty({ example: '8' }) class_name!: string;
  @ApiProperty({ description: 'Topics with status DONE' }) done!: number;
  @ApiProperty({ description: 'Topics with status IN_PROGRESS' }) in_progress!: number;
  @ApiProperty({ description: 'All topics of the class' }) total!: number;
  @ApiProperty({ description: 'round(done / total * 100)', example: 41 }) percentage!: number;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Share of lessons the study plan expects taught by today; null without a plan',
    example: 60,
  })
  expected_percentage!: number | null;
}

export class SyllabusOverallProgressDto {
  @ApiProperty() done!: number;
  @ApiProperty() total!: number;
  @ApiProperty({ example: 60 }) percentage!: number;
}

export class SyllabusProgressWidgetDto {
  @ApiProperty({ type: [SyllabusClassProgressDto] }) classes!: SyllabusClassProgressDto[];
  @ApiProperty({ type: SyllabusOverallProgressDto }) overall!: SyllabusOverallProgressDto;
  @ApiProperty({ description: 'Classes whose taught share is under the plan expectation' })
  behind_count!: number;
}

export class SyllabusVsPlanClassDto {
  @ApiProperty({ format: 'uuid' }) class_id!: string;
  @ApiProperty({ example: '8' }) class_name!: string;
  @ApiProperty({ example: 41 }) done_percentage!: number;
  @ApiProperty({ example: 60 }) expected_percentage!: number;
  @ApiProperty({ description: 'expected - done when positive, else 0', example: 19 })
  behind_by!: number;
  @ApiProperty({ description: 'Past routine periods with no lesson report' })
  not_updated!: number;
}

export class SyllabusVsPlanDto {
  @ApiProperty({ example: '2026-10-07', description: 'School-local date' }) as_of!: string;
  @ApiProperty() behind_count!: number;
  @ApiProperty() not_updated_count!: number;
  @ApiProperty({ type: [SyllabusVsPlanClassDto] }) classes!: SyllabusVsPlanClassDto[];
}

/** [8.10.7.3.04] One assignment with submissions waiting for the teacher. */
export class HomeworkToCheckItemDto {
  @ApiProperty({ format: 'uuid' }) assignment_id!: string;
  @ApiProperty({ format: 'uuid' }) homework_id!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ example: '7' }) class_name!: string;
  @ApiProperty({ example: 'B' }) section_name!: string;
  @ApiProperty({ example: 'Mathematics' }) subject_name_en!: string;
  @ApiProperty({ type: String, nullable: true }) subject_name_bn!: string | null;
  @ApiProperty({ example: '2026-10-06' }) due_date!: string;
  @ApiProperty({ description: 'Submissions with status SUBMITTED' }) submitted_count!: number;
}

export class HomeworkToCheckDto {
  @ApiProperty({ description: 'SUBMITTED rows across all of the caller assignments' })
  total_submitted!: number;
  @ApiProperty({ description: 'Assignments with at least one SUBMITTED row' })
  assignment_count!: number;
  @ApiProperty({ type: [HomeworkToCheckItemDto], description: 'Top 5 by submitted_count' })
  items!: HomeworkToCheckItemDto[];
}

/** [8.10.7.3.19] Submitted vs assigned. */
export class SubmissionRateCountsDto {
  @ApiProperty() assigned!: number;
  @ApiProperty() submitted!: number;
  @ApiProperty({ example: 85 }) percentage!: number;
}

export class SubmissionRateClassDto extends SubmissionRateCountsDto {
  @ApiProperty({ format: 'uuid' }) class_id!: string;
  @ApiProperty({ example: '7' }) class_name!: string;
}

export class SubmissionRateWindowDto {
  @ApiProperty({ example: '2026-10-01' }) from!: string;
  @ApiProperty({ example: '2026-10-07' }) to!: string;
}

export class HomeworkSubmissionRateDto {
  @ApiProperty({ type: SubmissionRateWindowDto }) window!: SubmissionRateWindowDto;
  @ApiProperty({ type: SubmissionRateCountsDto }) overall!: SubmissionRateCountsDto;
  @ApiProperty({ type: [SubmissionRateClassDto] }) classes!: SubmissionRateClassDto[];
}

/** [8.10.7.3.19] Teacher "my syllabus progress". */
export class MySyllabusSectionDto {
  @ApiProperty({ format: 'uuid' }) section_id!: string;
  @ApiProperty({ example: 'B' }) section_name!: string;
}

export class MySyllabusProgressItemDto {
  @ApiProperty({ format: 'uuid' }) class_id!: string;
  @ApiProperty({ example: '7' }) class_name!: string;
  @ApiProperty({ type: [MySyllabusSectionDto] }) sections!: MySyllabusSectionDto[];
  @ApiProperty({ format: 'uuid' }) subject_id!: string;
  @ApiProperty({ example: 'Mathematics' }) subject_name_en!: string;
  @ApiProperty({ type: String, nullable: true }) subject_name_bn!: string | null;
  @ApiProperty() done!: number;
  @ApiProperty() total!: number;
  @ApiProperty({ example: 37 }) percentage!: number;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Study-plan pace by today across the sections; null without a plan.',
  })
  expected_percentage!: number | null;
}

export class MySyllabusProgressDto {
  @ApiProperty({ type: [MySyllabusProgressItemDto] }) items!: MySyllabusProgressItemDto[];
  @ApiProperty({ description: 'Subjects whose done % is below the expected %.' })
  behind_count!: number;
}

/** [8.10.7.7.05] Teacher card "lessons to mark". */
export class LessonToMarkDto {
  @ApiProperty({ example: '7' }) class_name!: string;
  @ApiProperty({ example: 'B' }) section_name!: string;
  @ApiProperty({ example: 'Mathematics' }) subject_name_en!: string;
  @ApiProperty({ type: String, nullable: true }) subject_name_bn!: string | null;
  @ApiProperty({ example: '2026-10-05' }) planned_on!: string;
  @ApiProperty({ type: String, nullable: true }) lesson_title!: string | null;
}

export class LessonsToMarkDto {
  @ApiProperty({ example: 3 }) to_mark!: number;
  @ApiProperty({ type: String, nullable: true, example: '2026-10-05' })
  oldest_planned_on!: string | null;
  @ApiProperty({ type: [LessonToMarkDto], description: 'Newest 5.' }) items!: LessonToMarkDto[];
}

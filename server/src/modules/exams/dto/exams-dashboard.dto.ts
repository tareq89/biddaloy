import { ApiProperty } from '@nestjs/swagger';

export class MarkEntryFiguresDto {
  @ApiProperty({ description: 'Mark grids in state SUBMITTED' })
  submitted: number;

  @ApiProperty({ description: 'Live sections x distinct subjects of the live components' })
  total: number;

  @ApiProperty({ description: 'Rounded; 0 when total is 0' })
  percentage: number;
}

export class MarkEntryClassDto extends MarkEntryFiguresDto {
  @ApiProperty({ format: 'uuid' })
  class_id: string;

  @ApiProperty()
  class_name: string;

  @ApiProperty({ format: 'uuid' })
  exam_id: string;
}

/** `GET /dashboard/widgets/mark-entry-progress` (#1850). */
export class MarkEntryProgressWidgetDto {
  @ApiProperty({ type: String, nullable: true, description: 'null when no exam is in progress' })
  exam_name: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'YYYY-MM-DD, latest in the group' })
  mark_entry_deadline: string | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Days since the last sitting, when it is before today',
  })
  exam_ended_days_ago: number | null;

  @ApiProperty({ type: MarkEntryFiguresDto })
  overall: MarkEntryFiguresDto;

  @ApiProperty({ type: [MarkEntryClassDto] })
  classes: MarkEntryClassDto[];

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  lowest_class_id: string | null;
}

export class MyMarkDeadlineItemDto {
  @ApiProperty({ format: 'uuid' })
  exam_id: string;

  @ApiProperty()
  exam_name: string;

  @ApiProperty({ format: 'uuid' })
  section_id: string;

  @ApiProperty()
  class_name: string;

  @ApiProperty()
  section_name: string;

  @ApiProperty({ format: 'uuid' })
  subject_id: string;

  @ApiProperty()
  subject_name_en: string;

  @ApiProperty({ type: String, nullable: true })
  subject_name_bn: string | null;

  @ApiProperty({ description: 'Rostered students with every live component entered' })
  entered: number;

  @ApiProperty({ description: 'Students on the grid (ACTIVE enrollments of the section)' })
  expected: number;

  @ApiProperty({ enum: ['DRAFT', 'SUBMITTED'], description: 'No grid row means DRAFT' })
  state: 'DRAFT' | 'SUBMITTED';

  @ApiProperty({ type: String, nullable: true, description: 'YYYY-MM-DD; null when not set' })
  mark_entry_deadline: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'YYYY-MM-DD, latest sitting date of this subject, not a deadline',
  })
  last_sitting_date: string | null;
}

/** `GET /dashboard/widgets/my-mark-deadlines` (#1863). */
export class MyMarkDeadlinesDto {
  @ApiProperty({ description: 'Sum of expected - entered over DRAFT grids' })
  outstanding_students: number;

  @ApiProperty({ type: [MyMarkDeadlineItemDto] })
  items: MyMarkDeadlineItemDto[];
}

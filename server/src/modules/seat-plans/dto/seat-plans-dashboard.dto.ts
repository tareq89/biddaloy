import { ApiProperty } from '@nestjs/swagger';

export class SeatPlanStatusExamDto {
  @ApiProperty({ format: 'uuid' })
  exam_id: string;

  @ApiProperty()
  exam_name: string;

  @ApiProperty()
  class_name: string;

  @ApiProperty({ description: 'YYYY-MM-DD, first sitting of the exam' })
  first_date: string;

  @ApiProperty({ description: 'Live exam schedules' })
  schedule_count: number;

  @ApiProperty({ description: 'Schedules linked to a live seat plan' })
  planned_count: number;

  @ApiProperty({ description: 'Schedules whose live seat plan is PUBLISHED' })
  published_count: number;
}

/** `GET /dashboard/widgets/seat-plan-status` (#1892). */
export class SeatPlanStatusDto {
  @ApiProperty({
    description: 'Upcoming exams with planned_count < schedule_count (all of them, not just 10)',
  })
  exams_needing_plan: number;

  @ApiProperty({ type: [SeatPlanStatusExamDto], description: 'Next 10 by first_date' })
  exams: SeatPlanStatusExamDto[];
}

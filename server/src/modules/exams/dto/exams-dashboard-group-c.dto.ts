import { ApiProperty } from '@nestjs/swagger';

// Pass-rate DTOs are aggregate-only: no id, no person field (D19, #1891).

export class CommitteeClassPassRateDto {
  @ApiProperty()
  class_name: string;

  @ApiProperty({ type: Number, nullable: true, description: 'Used to sort; null if unset' })
  numeric_grade: number | null;

  @ApiProperty({ description: 'Results counted (every live result row of the class exam)' })
  appeared: number;

  @ApiProperty({ description: 'passed / appeared, one decimal' })
  pass_percentage: number;
}

export class CommitteeRoundPassRateDto {
  @ApiProperty()
  exam_name: string;

  @ApiProperty({ description: 'One decimal' })
  pass_percentage: number;
}

/** `GET /dashboard/widgets/committee-pass-rate` (#1891). */
export class CommitteePassRateDto {
  @ApiProperty({ type: String, nullable: true, description: 'null when nothing is published' })
  exam_name: string | null;

  @ApiProperty({ type: [CommitteeClassPassRateDto], description: 'Latest round, by numeric_grade' })
  classes: CommitteeClassPassRateDto[];

  @ApiProperty({ type: Number, nullable: true })
  overall_pass_percentage: number | null;

  @ApiProperty({ type: [CommitteeRoundPassRateDto], description: 'Oldest to newest, max 5' })
  recent_rounds: CommitteeRoundPassRateDto[];

  @ApiProperty({ type: Number, nullable: true, description: 'Second newest round, if any' })
  previous_pass_percentage: number | null;
}

export class ResultsStateRoundDto {
  @ApiProperty()
  exam_name: string;

  @ApiProperty({ description: 'Distinct classes in the round' })
  class_count: number;

  @ApiProperty()
  draft: number;

  @ApiProperty()
  processed: number;

  @ApiProperty()
  published: number;

  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  last_published_at: string | null;
}

/** `GET /dashboard/widgets/results-state` (#1891). Counts are per exam (one per class). */
export class ResultsStateDto {
  @ApiProperty()
  draft: number;

  @ApiProperty()
  processed: number;

  @ApiProperty()
  published: number;

  @ApiProperty({ type: [ResultsStateRoundDto], description: 'Current year, max 10' })
  rounds: ResultsStateRoundDto[];
}

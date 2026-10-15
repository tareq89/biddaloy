import { ApiProperty } from '@nestjs/swagger';

export class CommitteeEnrollmentYearDto {
  @ApiProperty({ example: '2026', description: 'Academic year name' })
  year_label: string;

  @ApiProperty({ example: 1248, description: 'Enrollments ACTIVE or GRADUATED in that year' })
  student_count: number;
}

export class CommitteeEnrollmentDto {
  @ApiProperty({
    type: [CommitteeEnrollmentYearDto],
    description: 'Up to 5 years, oldest first, ending at the current academic year',
  })
  years: CommitteeEnrollmentYearDto[];

  @ApiProperty({ example: 1248 })
  current_count: number;

  @ApiProperty({ type: Number, nullable: true, example: 1214, description: 'null when no earlier year' })
  previous_count: number | null;
}

import { IsOptional, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** [39.5.1] Query for `GET /admission/reports/lifecycle`. */
export class LifecycleReportQueryDto {
  @ApiProperty()
  @IsUUID()
  academic_year_id: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  class_id?: string;
}

export class LifecycleReportCountsDto {
  @ApiProperty() admitted: number;
  @ApiProperty() withdrawn: number;
  @ApiProperty() transferred_out: number;
  @ApiProperty() graduated: number;
  @ApiProperty() readmitted: number;
}

export class LifecycleReportRowDto {
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Null for ADMITTED rows (applicants are not linked to a student).',
  })
  student_id: string | null;
  @ApiProperty() name: string;
  @ApiProperty({ nullable: true, type: String }) registration_number: string | null;
  @ApiProperty({ nullable: true, type: String }) class_name: string | null;
  @ApiProperty({ enum: ['ADMITTED', 'WITHDRAWN', 'TRANSFERRED_OUT', 'GRADUATED', 'READMITTED'] })
  event_type: string;
  @ApiProperty({ description: 'YYYY-MM-DD' }) occurred_on: string;
  @ApiProperty({ nullable: true, type: String }) reason: string | null;
  @ApiProperty({ nullable: true, type: String }) destination: string | null;
}

export class LifecycleReportDto {
  @ApiProperty({ type: LifecycleReportCountsDto }) counts: LifecycleReportCountsDto;
  @ApiProperty({ type: [LifecycleReportRowDto] }) rows: LifecycleReportRowDto[];
  @ApiProperty({ description: 'True when more than 500 rows matched and the list was cut.' })
  truncated: boolean;
}

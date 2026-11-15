import { IsIn, IsOptional, IsUUID } from 'class-validator';
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

/** [Epic 71 D18] Query for the funnel report; same filters as the lifecycle report. */
export class FunnelReportQueryDto extends LifecycleReportQueryDto {}

export const ADMISSION_EXPORT_KINDS = ['applicants', 'scores', 'lists'] as const;
export type AdmissionExportKind = (typeof ADMISSION_EXPORT_KINDS)[number];

export class AdmissionExportParamsDto {
  @ApiProperty({ enum: ADMISSION_EXPORT_KINDS })
  @IsIn(ADMISSION_EXPORT_KINDS)
  kind: AdmissionExportKind;
}

export class FunnelStepDto {
  @ApiProperty({ enum: ['APPLIED', 'STAGE', 'OFFERED', 'ADMITTED'] }) step: string;
  @ApiProperty({ nullable: true, type: Number, description: 'Stage position; null otherwise.' })
  position: number | null;
  @ApiProperty({ nullable: true, type: String, description: 'Stage kind(s), e.g. WRITTEN.' })
  kind: string | null;
  @ApiProperty() count: number;
}

export class SourceSplitRowDto {
  @ApiProperty({ enum: ['ONLINE', 'CLERK'] }) source: string;
  @ApiProperty() applied: number;
  @ApiProperty() admitted: number;
}

export class QuotaCountRowDto {
  @ApiProperty() quota: string;
  @ApiProperty() applied: number;
  @ApiProperty() admitted: number;
}

export class FunnelReportDto {
  @ApiProperty({ type: [FunnelStepDto] }) funnel: FunnelStepDto[];
  @ApiProperty({ type: [SourceSplitRowDto] }) sources: SourceSplitRowDto[];
  @ApiProperty({ type: [QuotaCountRowDto] }) quotas: QuotaCountRowDto[];
}

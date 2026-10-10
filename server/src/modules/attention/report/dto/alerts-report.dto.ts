import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID, Matches } from 'class-validator';
import { ALERT_RULE_KEYS, AlertCategory, AlertSeverity } from '@biddaloy/shared';

// manual alerts are not rule breaches; they are never in this report
const REPORT_RULE_KEYS = ALERT_RULE_KEYS.filter((k) => k !== 'manual.alert');

export class AlertsReportQueryDto {
  @ApiProperty({
    example: '2026-10',
    description: 'School-local month, within the last 12 months.',
  })
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month must be YYYY-MM' })
  month: string;

  @ApiPropertyOptional({ enum: REPORT_RULE_KEYS })
  @IsOptional()
  @IsIn(REPORT_RULE_KEYS)
  ruleKey?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  sectionId?: string;

  @ApiPropertyOptional({ enum: ['json', 'csv'], default: 'json' })
  @IsOptional()
  @IsIn(['json', 'csv'])
  format: 'json' | 'csv' = 'json';
}

export class AlertsReportFactsDto {
  @ApiProperty() total: number;
  @ApiProperty() resolved: number;
  @ApiProperty({ nullable: true, type: Number }) avgResolveMinutes: number | null;
  @ApiProperty() open: number;
  @ApiProperty() openCritical: number;
  @ApiProperty() previousMonthTotal: number;
}

export class AlertsReportSectionDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() label: string;
}

export class AlertsReportCellDto {
  @ApiProperty({ format: 'uuid', nullable: true, type: String }) sectionId: string | null;
  @ApiProperty() count: number;
}

export class AlertsReportRowDto {
  @ApiProperty() ruleKey: string;
  @ApiProperty({ enum: AlertCategory, enumName: 'AlertCategory' }) category: AlertCategory;
  @ApiProperty({ enum: AlertSeverity, enumName: 'AlertSeverity' }) severity: AlertSeverity;
  @ApiProperty({
    type: [AlertsReportCellDto],
    description: 'One cell per section, then "no section".',
  })
  cells: AlertsReportCellDto[];
  @ApiProperty() total: number;
}

export class AlertsReportDto {
  @ApiProperty({ example: '2026-10' }) month: string;
  @ApiProperty({ type: AlertsReportFactsDto }) facts: AlertsReportFactsDto;
  @ApiProperty({ type: [AlertsReportSectionDto] }) sections: AlertsReportSectionDto[];
  @ApiProperty({ type: [AlertsReportRowDto] }) rows: AlertsReportRowDto[];
}

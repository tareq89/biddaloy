import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AlertCategory, AlertRecipientState, AlertSeverity, AlertSource } from '@biddaloy/shared';

export class AlertItemDto {
  @ApiProperty({ format: 'uuid' }) recipientId: string;
  @ApiProperty({ format: 'uuid' }) alertId: string;
  @ApiProperty() ruleKey: string;
  @ApiProperty({ enum: AlertSource, enumName: 'AlertSource' }) source: AlertSource;
  @ApiProperty({ enum: AlertSeverity, enumName: 'AlertSeverity' }) severity: AlertSeverity;
  @ApiProperty({ enum: AlertCategory, enumName: 'AlertCategory' }) category: AlertCategory;
  @ApiProperty({ enum: AlertRecipientState, enumName: 'AlertRecipientState' })
  state: AlertRecipientState;
  @ApiProperty() title: string;
  @ApiProperty() why: string;
  @ApiProperty({ type: [String] }) steps: string[];
  @ApiPropertyOptional() actionLabel?: string;
  @ApiPropertyOptional() actionUrl?: string;
  @ApiProperty() closable: boolean;
  @ApiProperty({ format: 'date-time' }) raisedAt: string;
  @ApiPropertyOptional({ format: 'date-time' }) expiresAt?: string;
  @ApiPropertyOptional({ format: 'date-time' }) snoozedUntil?: string;
  @ApiPropertyOptional() studentName?: string;
  @ApiPropertyOptional() sectionLabel?: string;
  @ApiPropertyOptional({ format: 'date-time' }) resolvedAt?: string;
  @ApiPropertyOptional() resolvedByName?: string;
}

export class AttentionSummaryDto {
  @ApiProperty() critical: number;
  @ApiProperty() warning: number;
  @ApiProperty() reminder: number;
  @ApiProperty({ description: 'OPEN + HIDDEN active items: bell badge / To-do count (D19).' })
  activeTotal: number;
  @ApiProperty({ type: () => AlertItemDto, nullable: true }) top: AlertItemDto | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) updatedAt: string | null;
  @ApiProperty() staleMinutes: number;
}

export class AlertItemsPageDto {
  @ApiProperty({ type: [AlertItemDto] }) items: AlertItemDto[];
  @ApiProperty() total: number;
}

export class StudentAlertDto {
  @ApiProperty({ format: 'uuid' }) alertId: string;
  @ApiProperty() ruleKey: string;
  @ApiProperty({ enum: AlertSeverity, enumName: 'AlertSeverity' }) severity: AlertSeverity;
  @ApiProperty({ enum: AlertCategory, enumName: 'AlertCategory' }) category: AlertCategory;
  @ApiProperty() title: string;
  @ApiProperty() why: string;
  @ApiProperty({ format: 'date-time' }) raisedAt: string;
  @ApiProperty() seenCount: number;
  @ApiProperty() recipientCount: number;
}

export class SeenResultDto {
  @ApiProperty() updated: number;
}

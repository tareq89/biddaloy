import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class OverviewAdminDto {
  @ApiProperty() userId: string;
  @ApiProperty() name: string;
  @ApiProperty({ nullable: true }) email: string | null;
  @ApiProperty({ nullable: true }) phone: string | null;
  @ApiProperty() membershipStatus: string;
}

export class OverviewRoleCountDto {
  @ApiProperty() role: string;
  @ApiProperty() count: number;
}

export class OverviewAlertCountDto {
  @ApiProperty() severity: string;
  @ApiProperty() count: number;
}

export class OverviewAuditRowDto {
  @ApiProperty() id: string;
  @ApiProperty() action: string;
  @ApiProperty() entityType: string;
  @ApiProperty() createdAt: string;
  @ApiProperty({ nullable: true }) actorName: string | null;
  /** True when written during a Login as session; actorName is then the owner. */
  @ApiProperty() viaLoginAs: boolean;
}

export class OverviewSmsDto {
  @ApiProperty() available: number;
  @ApiProperty() reserved: number;
}

/** Every part is `null` when its own query failed; the rest still answer. */
export class SchoolOverviewDto {
  @ApiProperty() schoolId: string;
  @ApiPropertyOptional({ type: [OverviewAdminDto], nullable: true })
  admins: OverviewAdminDto[] | null;
  @ApiPropertyOptional({ type: [OverviewRoleCountDto], nullable: true })
  peopleByRole: OverviewRoleCountDto[] | null;
  @ApiPropertyOptional({ type: OverviewSmsDto, nullable: true }) smsBalance: OverviewSmsDto | null;
  /** Notice + application attachments + live workbook files. Logos and website media are not counted. */
  @ApiPropertyOptional({ nullable: true }) filesBytes: number | null;
  @ApiPropertyOptional({ type: [OverviewAlertCountDto], nullable: true })
  openAlerts: OverviewAlertCountDto[] | null;
  @ApiPropertyOptional({ type: [OverviewAuditRowDto], nullable: true })
  recentAudit: OverviewAuditRowDto[] | null;
  @ApiPropertyOptional({ nullable: true }) lastActivityAt: string | null;
  @ApiPropertyOptional({ nullable: true }) notesCount: number | null;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TermLabel } from '@biddaloy/shared';

/**
 * `GET /calendar-settings` response — everything the calendar UI needs to
 * draw a week, in one read. Read-only: writes still go through
 * `PATCH /schools/:id/settings` (`region.country`, `region.calendar.termLabel`,
 * `attendance.weeklyOffDays`) — see [17.2.3].
 */
export class CurrentAcademicYearDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() start_date: string;
  @ApiProperty() end_date: string;
}

export class CalendarSettingsResponseDto {
  @ApiProperty({ enum: TermLabel }) termLabel: TermLabel;
  @ApiProperty({ description: 'ISO 3166-1 alpha-2 code, e.g. BD' }) country: string;
  @ApiProperty({ minimum: 0, maximum: 6 }) firstDayOfWeek: number;
  @ApiProperty({ type: Number, isArray: true }) weeklyOffDays: number[];
  @ApiProperty() timezone: string;
  @ApiPropertyOptional({ type: CurrentAcademicYearDto, nullable: true })
  currentAcademicYear: CurrentAcademicYearDto | null;
}

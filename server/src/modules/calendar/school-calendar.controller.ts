import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { SchoolCalendarService } from './school-calendar.service';
import { QueryHolidayDto, QueryWorkingDaysDto } from './dto/working-days.dto';
import { Permission } from '@biddaloy/shared';

/**
 * Read-only holiday list and the working-day read that [9.3]'s write path
 * and [9.4]'s `AttendanceSummaryService` both depend on. Every calendar
 * write goes through `CalendarEventsService` ([68.3.15.01]); the legacy
 * holiday POST/PATCH/DELETE routes skipped its guards and are gone.
 */
@ApiTags('school-calendar')
@ApiTenantAuth()
@Controller('school-calendar')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class SchoolCalendarController {
  constructor(private readonly service: SchoolCalendarService) {}

  @Get('holidays')
  // [10.4] G4 — reference-data read.
  @RequirePermissions(Permission.ACADEMIC_STRUCTURE_READ)
  @ApiOperation({ summary: 'List holidays for the current tenant, paginated.' })
  listHolidays(
    @Query() query: QueryHolidayDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.service.listHolidays(query, tenant.id);
  }

  @Get('working-days')
  // [17.2.1] D16/D19 — moved onto CALENDAR_READ; this reference-data read
  // belongs with the rest of the calendar surface, not academic structure.
  @RequirePermissions(Permission.CALENDAR_READ)
  @ApiOperation({
    summary:
      'Every working day in [from, to] for the current tenant — weekly-off days and holidays ' +
      'removed. Bounded to 400 days.',
  })
  getWorkingDays(
    @Query() query: QueryWorkingDaysDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.service.getWorkingDays({
      tenantId: tenant.id,
      from: query.from,
      to: query.to,
      academicYearId: query.academic_year_id,
    });
  }
}

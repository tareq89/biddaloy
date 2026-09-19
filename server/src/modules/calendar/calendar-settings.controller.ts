import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Permission, TermLabel, UserRole } from '@biddaloy/shared';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { SchoolsService } from '../schools/schools.service';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { CalendarSettingsResponseDto } from './dto/calendar-settings.dto';

/**
 * [17.2.3] Read-only composite the calendar UI needs to draw a week in one
 * request, instead of reading `region`/`attendance` off the raw tenant
 * settings and separately listing academic years to find the current one.
 * Writes stay on the existing `PATCH /schools/:id/settings` path — this
 * controller has no mutation route.
 *
 * `@Roles` here is exactly the set of roles `CALENDAR_READ` (Epic 17's
 * "everyone who can see the calendar" permission) grants — ADMIN,
 * EXECUTIVE, ACCOUNTANT, TEACHER, PARENT, STUDENT (`permissions.ts`).
 * SUPER_ADMIN bypasses `@Roles` entirely (`ContextGuard`), matching every
 * other route in this module.
 */
@ApiTags('calendar-settings')
@ApiTenantAuth()
@Controller('calendar-settings')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class CalendarSettingsController {
  constructor(
    private readonly schoolsService: SchoolsService,
    @InjectRepository(AcademicYear)
    private readonly academicYearRepo: Repository<AcademicYear>,
  ) {}

  @Get()
  @Roles(
    UserRole.ADMIN,
    UserRole.EXECUTIVE,
    UserRole.ACCOUNTANT,
    UserRole.TEACHER,
    UserRole.PARENT,
    UserRole.STUDENT,
  )
  @RequirePermissions(Permission.CALENDAR_READ)
  @ApiOperation({
    summary:
      'Composite calendar settings for the current tenant: term label, region, week shape, and the current academic year.',
  })
  @ApiOkResponse({ type: CalendarSettingsResponseDto })
  async getSettings(
    @CurrentTenant() tenant: { id: string; role: string },
  ): Promise<CalendarSettingsResponseDto> {
    const settings = await this.schoolsService.getResolvedSettings(tenant.id);
    const currentYear = await this.academicYearRepo.findOne({
      where: { tenant_id: tenant.id, is_current: true, deleted_at: IsNull() },
    });

    return {
      // `region.calendar` is optional on `TenantSettings` (only `country`
      // etc. are guaranteed by the resolver's defaults) — [17.1.2]'s
      // `DEFAULT_REGION_SETTINGS.calendar.termLabel` backstops it, but a
      // tenant persisted before that default shipped could still resolve
      // without one, so this falls back the same way the default does.
      termLabel: settings.region?.calendar?.termLabel ?? TermLabel.TERM,
      country: settings.region!.country,
      firstDayOfWeek: settings.region!.date.firstDayOfWeek,
      weeklyOffDays: settings.attendance!.weeklyOffDays,
      timezone: settings.region!.timezone,
      currentAcademicYear: currentYear
        ? {
            id: currentYear.id,
            name: currentYear.name,
            start_date: toDateOnly(currentYear.start_date),
            end_date: toDateOnly(currentYear.end_date),
          }
        : null,
    };
  }
}

/** `AcademicYear.start_date`/`end_date` are `date` columns — TypeORM gives
 * back a JS `Date` at UTC midnight; slicing the ISO string is cheaper and
 * more direct than round-tripping through a date library for a plain
 * `YYYY-MM-DD` the client already expects (`WorkingDaysResponseDto` does
 * the same in `working-days.dto.ts`). */
function toDateOnly(value: Date | string): string {
  return (value instanceof Date ? value.toISOString() : value).slice(0, 10);
}
